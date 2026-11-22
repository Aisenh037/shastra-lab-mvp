// Submit one UPSC Mains answer for evaluation.
//
// Flow: auth → evidence gate (free) → load question + rubric → take one credit →
// save the submission as a queued job → respond 202 straight away → score it in
// the background. The browser watches its row for the result. If scoring keeps
// failing, the job is retried (evaluation-worker) and the credit is refunded
// after the last attempt.
//
// Admins can pass dryRun: true to score synchronously without charging or saving
// (calibration runs).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, json, requireUser } from "../_shared/auth.ts";
import { inBackground, runJobNow, scoreAnswer, type JobPayload } from "../_shared/evaluation-job.ts";
import { deriveRubricFromKeyPoints, validateRubric, type Rubric } from "../_shared/rubric.ts";
import { checkEvidence, ENGINE_VERSION } from "../_shared/scoring.ts";

const MAX_ANSWER_CHARS = 20000;

interface Body {
  questionId?: string;
  answerText?: string;
  submissionType?: "typed" | "handwritten";
  imagePaths?: string[];
  dryRun?: boolean;
  /** New clients: respond 202 as soon as the job is queued. Older clients wait for the result. */
  async?: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const ctx = await requireUser(req);
  if (ctx instanceof Response) return ctx;
  const { user, userClient, adminClient } = ctx;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }

  const answer = (body.answerText ?? "").trim();
  if (!body.questionId) return json(req, { error: "questionId is required" }, 400);
  if (answer.length > MAX_ANSWER_CHARS) return json(req, { error: "Answer is too long." }, 413);

  const imagePaths = Array.isArray(body.imagePaths) ? body.imagePaths.slice(0, 10) : [];
  if (imagePaths.some((p) => typeof p !== "string" || !p.startsWith(`${user.id}/`))) {
    return json(req, { error: "Invalid image path" }, 400);
  }

  // Free: refuse non-answers before spending a credit or a model call.
  const gate = checkEvidence(answer);
  if (!gate.ok) {
    return json(req, { error: gate.message, code: "INSUFFICIENT_EVIDENCE", reason: gate.reason, wordCount: gate.wordCount }, 422);
  }

  // RLS on the user's client decides which questions they may answer.
  const { data: question, error: qError } = await userClient
    .from("practice_questions")
    .select("id, question_text, max_marks, word_limit, model_answer, key_points, subject")
    .eq("id", body.questionId)
    .maybeSingle();
  if (qError || !question) return json(req, { error: "Question not found" }, 404);

  let rubric: Rubric;
  const { data: stored } = await adminClient
    .from("question_rubrics")
    .select("rubric, status")
    .eq("question_id", question.id)
    .maybeSingle();
  if (stored?.status === "reviewed" && validateRubric(stored.rubric).ok) {
    rubric = { ...(stored.rubric as Rubric), maxMarks: question.max_marks, wordLimit: question.word_limit };
  } else {
    rubric = deriveRubricFromKeyPoints({
      questionText: question.question_text,
      maxMarks: question.max_marks,
      wordLimit: question.word_limit,
      keyPoints: question.key_points,
    });
  }

  const payload: JobPayload = {
    questionText: question.question_text,
    subject: question.subject,
    modelAnswer: question.model_answer,
    rubric,
  };

  if (body.dryRun) {
    const { data: isAdmin } = await adminClient.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) return json(req, { error: "dryRun is for admins" }, 403);
    try {
      const scored = await scoreAnswer(payload, answer);
      return json(req, {
        submissionId: null,
        status: "evaluated",
        score: scored.breakdown.score,
        percentage: scored.breakdown.percentage,
        ...scored.feedback,
        breakdown: scored.breakdown,
        creditsRemaining: null,
      });
    } catch (error) {
      console.error("dry run failed", error);
      return json(req, { error: "Evaluation failed.", code: "EVALUATION_FAILED" }, 502);
    }
  }

  const submissionId = crypto.randomUUID();
  const { data: remaining, error: creditError } = await adminClient.rpc("consume_evaluation_credit", {
    p_user: user.id,
    p_reference: submissionId,
  });
  if (creditError) {
    console.error("credit error", creditError);
    return json(req, { error: "Could not check your credits. Try again." }, 500);
  }
  if (remaining === -1) {
    return json(req, { error: "You have no evaluations left.", code: "NO_CREDITS" }, 402);
  }

  const { error: insertError } = await adminClient.from("answer_submissions").insert({
    id: submissionId,
    user_id: user.id,
    question_id: question.id,
    answer_text: answer,
    answer_image_paths: imagePaths.length ? imagePaths : null,
    submission_type: body.submissionType === "handwritten" ? "handwritten" : "typed",
    status: "queued",
    max_score: question.max_marks,
    engine_version: ENGINE_VERSION,
    job_payload: payload,
  });
  if (insertError) {
    console.error("enqueue failed", submissionId, insertError.message);
    const { data: refunded } = await adminClient.rpc("refund_evaluation_credit", { p_user: user.id, p_reference: submissionId });
    return json(req, {
      error: "Could not submit your answer. Your credit was not used; please try again.",
      code: "EVALUATION_FAILED",
      creditsRemaining: typeof refunded === "number" ? refunded : null,
    }, 500);
  }

  console.log(JSON.stringify({ event: "queued", submissionId, rubric: rubric.source }));

  if (body.async) {
    // Start scoring now; the worker retries if this attempt fails or is cut short.
    inBackground(runJobNow(adminClient, submissionId).catch((e) => console.error("background run failed", submissionId, e)));
    return json(req, { submissionId, status: "queued", creditsRemaining: remaining }, 202);
  }

  // Older clients expect the result in this response: run the job inline.
  const outcome = await runJobNow(adminClient, submissionId);
  const { data: row } = await adminClient
    .from("answer_submissions")
    .select("status, score, overall_feedback, strengths, improvements, paragraph_analysis, format_suggestions, model_comparison, score_breakdown")
    .eq("id", submissionId)
    .maybeSingle();
  if (outcome === "evaluated" && row?.score_breakdown) {
    return json(req, {
      submissionId,
      status: "evaluated",
      score: row.score,
      percentage: row.score_breakdown.percentage,
      overallFeedback: row.overall_feedback,
      strengths: row.strengths,
      improvements: row.improvements,
      paragraphAnalysis: row.paragraph_analysis,
      formatSuggestions: row.format_suggestions,
      modelComparison: row.model_comparison,
      breakdown: row.score_breakdown,
      creditsRemaining: remaining,
    });
  }
  return json(req, {
    error: "Evaluation is taking longer than usual. Your answer is saved and the result will appear in your history.",
    code: "EVALUATION_FAILED",
    submissionId,
    creditsRemaining: remaining,
  }, 502);
});
