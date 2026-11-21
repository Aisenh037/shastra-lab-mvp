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
  provenance: { engine: string; rubric: string; model: string; latencyMs: number };
}

export type EvaluationErrorCode = "NO_CREDITS" | "INSUFFICIENT_EVIDENCE" | "EVALUATION_FAILED" | "UNAUTHORIZED" | "UNKNOWN";

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

export async function evaluateAnswer(req: EvaluateRequest): Promise<EvaluationResult> {
  const { data, error } = await supabase.functions.invoke("evaluate-answer", { body: req });
  if (!error) return data as EvaluationResult;

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
    throw new EvaluationError(body.error ?? "Evaluation failed. Please try again.", code, res.status);
  }
  throw new EvaluationError("Could not reach the evaluator. Check your connection and try again.", "UNKNOWN");
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

