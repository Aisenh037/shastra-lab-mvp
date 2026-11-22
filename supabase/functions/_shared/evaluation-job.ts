// Scoring one queued answer, shared by evaluate-answer (runs a new job straight
// away in the background) and evaluation-worker (retries, recovers stuck jobs).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { chat } from "./llm.ts";
import type { Rubric } from "./rubric.ts";
import { buildPrompts, computeScore, extractJson, parseJudgement, type ModelJudgement, type ScoreBreakdown } from "./scoring.ts";

export const MAX_ATTEMPTS = 3;
export const LOCK_SECONDS = 180;
const BACKOFF_SECONDS = [30, 120, 300];

/** Everything needed to score the answer later, frozen at submit time. */
export interface JobPayload {
  questionText: string;
  subject: string | null;
  modelAnswer: string | null;
  rubric: Rubric;
}

export interface ScoredAnswer {
  breakdown: ScoreBreakdown;
  feedback: ModelJudgement["feedback"];
  provider: string;
  model: string;
  latencyMs: number;
}

export async function scoreAnswer(payload: JobPayload, answer: string): Promise<ScoredAnswer> {
  const prompts = buildPrompts({
    questionText: payload.questionText,
    rubric: payload.rubric,
    answer,
    modelAnswer: payload.modelAnswer,
    subject: payload.subject,
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
  const judgement = parseJudgement(extractJson(llm.content), payload.rubric);
  const breakdown = { ...computeScore(payload.rubric, judgement, answer), provider: llm.provider, model: llm.model };
  return { breakdown, feedback: judgement.feedback, provider: llm.provider, model: llm.model, latencyMs: Date.now() - started };
}

export interface JobRow {
  id: string;
  user_id: string;
  answer_text: string | null;
  attempts: number;
  job_payload: JobPayload | null;
}

export type JobOutcome = "evaluated" | "retry" | "failed" | "skipped";

/** Process one claimed job (status 'processing'). Never throws. */
export async function processJob(admin: SupabaseClient, row: JobRow): Promise<JobOutcome> {
  const finish = async (fields: Record<string, unknown>) => {
    // Only the worker that holds the job may finish it.
    const { data, error } = await admin
      .from("answer_submissions")
      .update({ ...fields, locked_until: null })
      .eq("id", row.id)
      .eq("status", "processing")
      .select("id");
    if (error) throw new Error(`updating job failed: ${error.message}`);
    return (data ?? []).length > 0;
  };

  const fail = async (message: string): Promise<JobOutcome> => {
    if (row.attempts >= MAX_ATTEMPTS) {
      const finished = await finish({ status: "failed", last_error: message.slice(0, 1000) });
      if (finished) {
        await admin.rpc("refund_evaluation_credit", { p_user: row.user_id, p_reference: row.id });
        console.log(JSON.stringify({ event: "evaluation_failed", submissionId: row.id, attempts: row.attempts, error: message.slice(0, 300) }));
      }
      return "failed";
    }
    const delay = BACKOFF_SECONDS[Math.min(row.attempts - 1, BACKOFF_SECONDS.length - 1)] ?? 300;
    await finish({
      status: "queued",
      last_error: message.slice(0, 1000),
      next_attempt_at: new Date(Date.now() + delay * 1000).toISOString(),
    });
    console.log(JSON.stringify({ event: "evaluation_retry", submissionId: row.id, attempts: row.attempts, inSeconds: delay }));
    return "retry";
  };

  try {
    if (row.attempts > MAX_ATTEMPTS) return await fail("gave up after repeated worker crashes");
    if (!row.job_payload || !row.answer_text) return await fail("job has no payload");

    const scored = await scoreAnswer(row.job_payload, row.answer_text);
    const done = await finish({
      status: "evaluated",
      score: scored.breakdown.score,
      overall_feedback: scored.feedback.overallFeedback,
      strengths: scored.feedback.strengths,
      improvements: scored.feedback.improvements,
      paragraph_analysis: scored.feedback.paragraphAnalysis,
      format_suggestions: scored.feedback.formatSuggestions,
      model_comparison: scored.feedback.modelComparison,
      score_breakdown: scored.breakdown,
      engine_version: scored.breakdown.engineVersion,
      evaluated_at: new Date().toISOString(),
      last_error: null,
    });
    console.log(JSON.stringify({
      event: done ? "evaluated" : "evaluated_but_lost_lock",
      submissionId: row.id,
      score: scored.breakdown.score,
      model: scored.model,
      unverified: scored.breakdown.unverifiedClaims,
      latencyMs: scored.latencyMs,
      attempt: row.attempts,
    }));
    return done ? "evaluated" : "skipped";
  } catch (error) {
    try {
      return await fail(error instanceof Error ? error.message : String(error));
    } catch (inner) {
      console.error("could not record job failure", row.id, inner);
      return "retry"; // the lock expires and the worker picks it up again
    }
  }
}

/** Claim one specific job and process it. Used right after submit. */
export async function runJobNow(admin: SupabaseClient, id: string): Promise<JobOutcome> {
  const { data, error } = await admin.rpc("claim_evaluation_jobs", { p_limit: 1, p_lock_seconds: LOCK_SECONDS, p_id: id });
  if (error) {
    console.error("claim failed", id, error.message);
    return "skipped";
  }
  const row = (data as JobRow[] | null)?.[0];
  return row ? processJob(admin, row) : "skipped";
}

/** Keep a background promise alive after the response is sent (Supabase Edge Runtime). */
export function inBackground(promise: Promise<unknown>): void {
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(promise);
}
