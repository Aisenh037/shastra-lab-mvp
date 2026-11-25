import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { ScoreBreakdown } from "../../supabase/functions/_shared/scoring.ts";

export type { ScoreBreakdown };

export interface EvaluationResult {
  submissionId: string | null;
  score: number;
  percentage: number;
  overallFeedback: string;
  strengths: string[];
  improvements: string[];
  paragraphAnalysis: Array<{ paragraphNumber: number; content: string; feedback: string; rating: string }>;
  formatSuggestions: string;
  modelComparison: string;
  breakdown: ScoreBreakdown;
  creditsRemaining: number | null;
}

export type EvaluationErrorCode =
  | "NO_CREDITS"
  | "INSUFFICIENT_EVIDENCE"
  | "EVALUATION_FAILED"
  | "STILL_PROCESSING"
  | "UNAUTHORIZED"
  | "UNKNOWN";

export class EvaluationError extends Error {
  constructor(
    message: string,
    public code: EvaluationErrorCode,
    public status?: number,
  ) {
    super(message);
  }
}

export interface EvaluateRequest {
  questionId: string;
  answerText: string;
  submissionType: "typed" | "handwritten";
  imagePaths?: string[];
}

export interface Submitted {
  submissionId: string;
  creditsRemaining: number | null;
}

/** The columns of answer_submissions the result screen needs. */
export interface SubmissionRow {
  id: string;
  status: string;
  score: number | null;
  max_score: number | null;
  overall_feedback: string | null;
  strengths: unknown;
  improvements: unknown;
  paragraph_analysis: unknown;
  format_suggestions: string | null;
  model_comparison: string | null;
  score_breakdown: unknown;
  last_error?: string | null;
}

const RESULT_COLUMNS =
  "id, status, score, max_score, overall_feedback, strengths, improvements, paragraph_analysis, format_suggestions, model_comparison, score_breakdown, last_error";

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function rowToResult(row: SubmissionRow, creditsRemaining: number | null = null): EvaluationResult {
  const breakdown = row.score_breakdown as ScoreBreakdown;
  const score = Number(row.score ?? breakdown?.score ?? 0);
  const max = Number(row.max_score ?? breakdown?.maxMarks ?? 0);
  return {
    submissionId: row.id,
    score,
    percentage: max > 0 ? Math.round((score / max) * 100) : 0,
    overallFeedback: row.overall_feedback ?? "",
    strengths: list(row.strengths),
    improvements: list(row.improvements),
    paragraphAnalysis: Array.isArray(row.paragraph_analysis) ? (row.paragraph_analysis as EvaluationResult["paragraphAnalysis"]) : [],
    formatSuggestions: row.format_suggestions ?? "",
    modelComparison: row.model_comparison ?? "",
    breakdown,
    creditsRemaining,
  };
}

async function errorFromInvoke(error: unknown): Promise<EvaluationError> {
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    let body: { error?: string; code?: string } = {};
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    const code: EvaluationErrorCode =
      res.status === 401
        ? "UNAUTHORIZED"
        : (["NO_CREDITS", "INSUFFICIENT_EVIDENCE", "EVALUATION_FAILED"].includes(body.code ?? "")
            ? (body.code as EvaluationErrorCode)
            : "UNKNOWN");
    return new EvaluationError(body.error ?? "Evaluation failed. Please try again.", code, res.status);
  }
  return new EvaluationError("Could not reach the evaluator. Check your connection and try again.", "UNKNOWN");
}

/** Queue an answer for evaluation. Charges one credit; returns as soon as it is queued. */
export async function submitAnswer(req: EvaluateRequest): Promise<Submitted> {
  const { data, error } = await supabase.functions.invoke("evaluate-answer", { body: { ...req, async: true } });
  if (error) throw await errorFromInvoke(error);
  return { submissionId: data.submissionId, creditsRemaining: data.creditsRemaining ?? null };
}

export interface WaitOptions {
  timeoutMs?: number;
  pollMs?: number;
  /** Called when the job moves to processing (e.g. to update a status line). */
  onStatus?: (status: string) => void;
}

/**
 * Resolve when the submission is evaluated: listens to the row over Realtime and
 * polls as a fallback (Realtime can be blocked by networks or drop silently).
 */
export function waitForEvaluation(submissionId: string, opts: WaitOptions = {}): Promise<EvaluationResult> {
  const { timeoutMs = 4 * 60_000, pollMs = 4000, onStatus } = opts;

  return new Promise((resolve, reject) => {
    let settled = false;
    let lastStatus = "";
    const timers: ReturnType<typeof setTimeout>[] = [];

    const channel = supabase
      .channel(`submission-${submissionId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "answer_submissions", filter: `id=eq.${submissionId}` },
        (payload) => handle(payload.new as SubmissionRow),
      )
      .subscribe();

    const cleanup = () => {
      settled = true;
      timers.forEach(clearTimeout);
      supabase.removeChannel(channel);
    };

    function handle(row: SubmissionRow | null) {
      if (settled || !row) return;
      if (row.status !== lastStatus) {
        lastStatus = row.status;
        onStatus?.(row.status);
      }
      if (row.status === "evaluated" && row.score_breakdown) {
        cleanup();
        resolve(rowToResult(row));
      } else if (row.status === "failed") {
        cleanup();
        reject(new EvaluationError("We couldn't evaluate this answer after several tries. Your credit has been refunded.", "EVALUATION_FAILED"));
      }
    }

    const poll = async () => {
      if (settled) return;
      const { data } = await supabase.from("answer_submissions").select(RESULT_COLUMNS).eq("id", submissionId).maybeSingle();
      handle(data as SubmissionRow | null);
      if (!settled) timers.push(setTimeout(poll, pollMs));
    };
    timers.push(setTimeout(poll, pollMs));

    timers.push(
      setTimeout(() => {
        if (settled) return;
        cleanup();
        reject(
          new EvaluationError(
            "This is taking longer than usual. Your answer is saved and the result will appear in your submission history.",
            "STILL_PROCESSING",
          ),
        );
      }, timeoutMs),
    );
  });
}

/** Submit and wait for the result. */
export async function evaluateAnswer(req: EvaluateRequest, opts: WaitOptions = {}): Promise<EvaluationResult> {
  const { submissionId, creditsRemaining } = await submitAnswer(req);
  const result = await waitForEvaluation(submissionId, opts);
  return { ...result, creditsRemaining };
}

/** Upload answer photos to the private bucket; returns storage paths (not URLs). */
export async function uploadAnswerImages(userId: string, files: File[]): Promise<string[]> {
  const paths: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const safe = files[i].name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
    const path = `${userId}/${Date.now()}_page${i + 1}_${safe}`;
    const { error } = await supabase.storage.from("answer-uploads").upload(path, files[i]);
    if (error) throw error;
    paths.push(path);
  }
  return paths;
}

