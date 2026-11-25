// Evaluate one UPSC Mains answer.
//
// Flow: auth → evidence gate (free) → load question + rubric → take one credit →
// model reports coverage + ratings → engine verifies quotes and computes marks →
// submission saved with the service role → result. A failure after the credit is
// taken refunds it.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, json, requireUser } from "../_shared/auth.ts";
import { chat } from "../_shared/llm.ts";
import { deriveRubricFromKeyPoints, validateRubric, type Rubric } from "../_shared/rubric.ts";
import {
  buildPrompts,
  checkEvidence,
  computeScore,
  ENGINE_VERSION,
  extractJson,
  parseJudgement,
} from "../_shared/scoring.ts";

const MAX_ANSWER_CHARS = 20000;

interface Body {
  questionId?: string;
  answerText?: string;
  submissionType?: "typed" | "handwritten";
  imagePaths?: string[];
  /** Admin only: evaluate without charging or saving (calibration runs). */
  dryRun?: boolean;
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

  let dryRun = false;
  if (body.dryRun) {
    const { data: isAdmin } = await adminClient.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) return json(req, { error: "dryRun is for admins" }, 403);
    dryRun = true;
  }

  const submissionId = crypto.randomUUID();
  let creditsRemaining: number | null = null;
  if (!dryRun) {
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
    creditsRemaining = remaining;
  }

  try {
    const prompts = buildPrompts({
      questionText: question.question_text,
      rubric,
      answer,
      modelAnswer: question.model_answer,
      subject: question.subject,
    });
    const started = Date.now();
    const llm = await chat({
      json: true,
      maxTokens: 4000,
      messages: [
        { role: "system", content: prompts.system },
        { role: "user", content: prompts.user },
      ],
    });
    const judgement = parseJudgement(extractJson(llm.content), rubric);
    const breakdown = computeScore(rubric, judgement, answer);
    const latencyMs = Date.now() - started;

    const evaluation = {
      submissionId: dryRun ? null : submissionId,
      score: breakdown.score,
      percentage: breakdown.percentage,
      ...judgement.feedback,
      breakdown,
      creditsRemaining,
      provenance: { engine: ENGINE_VERSION, rubric: rubric.source, provider: llm.provider, model: llm.model, latencyMs },
    };

    if (!dryRun) {
      const { error: insertError } = await adminClient.from("answer_submissions").insert({
        id: submissionId,
        user_id: user.id,
        question_id: question.id,
        answer_text: answer,
        answer_image_paths: imagePaths.length ? imagePaths : null,
        submission_type: body.submissionType === "handwritten" ? "handwritten" : "typed",
        status: "evaluated",
        score: breakdown.score,
        max_score: question.max_marks,
        overall_feedback: judgement.feedback.overallFeedback,
        strengths: judgement.feedback.strengths,
        improvements: judgement.feedback.improvements,
        paragraph_analysis: judgement.feedback.paragraphAnalysis,
        format_suggestions: judgement.feedback.formatSuggestions,
        model_comparison: judgement.feedback.modelComparison,
        score_breakdown: breakdown,
        engine_version: ENGINE_VERSION,
        evaluated_at: new Date().toISOString(),
      });
      if (insertError) throw new Error(`saving submission failed: ${insertError.message}`);
    }

    console.log(JSON.stringify({ event: "evaluated", submissionId, score: breakdown.score, rubric: rubric.source, model: llm.model, unverified: breakdown.unverifiedClaims, latencyMs }));
    return json(req, evaluation);
  } catch (error) {
    console.error("evaluation failed", submissionId, error);
    if (!dryRun) {
      const { data: refunded } = await adminClient.rpc("refund_evaluation_credit", { p_user: user.id, p_reference: submissionId });
      creditsRemaining = typeof refunded === "number" ? refunded : creditsRemaining;
    }
    return json(req, { error: "Evaluation failed. Your credit was not used; please try again.", code: "EVALUATION_FAILED", creditsRemaining }, 502);
  }
});
