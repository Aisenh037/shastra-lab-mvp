import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A minimal fake of the bits of supabase-js that evaluation.ts uses.
const fake = vi.hoisted(() => {
  const state = {
    row: null as Record<string, unknown> | null,
    realtime: null as ((p: { new: unknown }) => void) | null,
    removed: 0,
    invoke: { data: null as unknown, error: null as unknown },
  };
  const channel = {
    on: (_t: string, _f: unknown, cb: (p: { new: unknown }) => void) => {
      state.realtime = cb;
      return channel;
    },
    subscribe: () => channel,
  };
  const supabase = {
    channel: () => channel,
    removeChannel: () => {
      state.removed++;
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.row }) }) }),
    }),
    functions: { invoke: async () => state.invoke },
  };
  return { state, supabase };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: fake.supabase }));

import { EvaluationError, evaluateAnswer, rowToResult, waitForEvaluation, type SubmissionRow } from "./evaluation";

const evaluatedRow: SubmissionRow = {
  id: "s1",
  status: "evaluated",
  score: 6,
  max_score: 10,
  overall_feedback: "Decent.",
  strengths: ["credit", 3],
  improvements: ["data"],
  paragraph_analysis: [{ paragraphNumber: 1, content: "x", feedback: "y", rating: "good" }],
  format_suggestions: null,
  model_comparison: "add data",
  score_breakdown: { score: 6, maxMarks: 10, points: [] },
};

beforeEach(() => {
  vi.useFakeTimers();
  fake.state.row = { id: "s1", status: "queued" };
  fake.state.realtime = null;
  fake.state.removed = 0;
});
afterEach(() => vi.useRealTimers());

describe("rowToResult", () => {
  it("maps a stored submission to the result screen's shape", () => {
    const r = rowToResult(evaluatedRow, 4);
    expect(r).toMatchObject({
      submissionId: "s1",
      score: 6,
      percentage: 60,
      overallFeedback: "Decent.",
      strengths: ["credit"],
      improvements: ["data"],
      formatSuggestions: "",
      modelComparison: "add data",
      creditsRemaining: 4,
    });
    expect(r.paragraphAnalysis).toHaveLength(1);
  });
});

describe("waitForEvaluation", () => {
  it("resolves from a Realtime update and reports status changes", async () => {
    const statuses: string[] = [];
    const p = waitForEvaluation("s1", { onStatus: (s) => statuses.push(s) });
    fake.state.realtime!({ new: { id: "s1", status: "processing" } });
    fake.state.realtime!({ new: evaluatedRow });
    await expect(p).resolves.toMatchObject({ score: 6, percentage: 60 });
    expect(statuses).toEqual(["processing", "evaluated"]);
    expect(fake.state.removed).toBe(1);
  });

  it("falls back to polling when Realtime is silent", async () => {
    const p = waitForEvaluation("s1", { pollMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    fake.state.row = evaluatedRow;
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toMatchObject({ score: 6 });
  });

  it("rejects with EVALUATION_FAILED when the job gives up", async () => {
    const p = waitForEvaluation("s1");
    fake.state.realtime!({ new: { id: "s1", status: "failed" } });
    await expect(p).rejects.toMatchObject({ code: "EVALUATION_FAILED" });
  });

  it("rejects with STILL_PROCESSING after the timeout, and stops polling", async () => {
    const p = waitForEvaluation("s1", { timeoutMs: 5000, pollMs: 1000 });
    const assertion = expect(p).rejects.toBeInstanceOf(EvaluationError);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    await expect(p).rejects.toMatchObject({ code: "STILL_PROCESSING" });
    expect(fake.state.removed).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("evaluateAnswer", () => {
  it("submits, then returns the evaluated result with the remaining credits", async () => {
    fake.state.invoke = { data: { submissionId: "s1", status: "queued", creditsRemaining: 2 }, error: null };
    const p = evaluateAnswer({ questionId: "q1", answerText: "a", submissionType: "typed" });
    await vi.advanceTimersByTimeAsync(0);
    fake.state.realtime!({ new: evaluatedRow });
    await expect(p).resolves.toMatchObject({ submissionId: "s1", score: 6, creditsRemaining: 2 });
  });
});
