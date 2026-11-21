// Recurring-weakness detection across a learner's evaluated answers.
//
// Deterministic: reads the score breakdowns the engine stored and reports a
// pattern only when it shows up in enough answers. One bad answer is not a pattern.

import { CRITERIA, CRITERION_LABELS, type Criterion, type ScoreBreakdown } from "./scoring.ts";

export const MIN_ANSWERS = 3;
export const WINDOW = 10;
const RATE_THRESHOLD = 0.6;

export interface Weakness {
  key: string;
  label: string;
  advice: string;
  /** Answers showing the gap / answers where it could show. */
  occurrences: number;
  outOf: number;
  severity: "high" | "medium";
}

const CRITERION_ADVICE: Record<Criterion, string> = {
  introduction: "Open with a definition, a data point or the context the question is about, in 1-2 lines.",
  structure: "Use clear sub-headings or numbered points so the examiner can follow your argument.",
  directive:
    "Answer what the directive word asks: 'critically examine' needs both sides and your judgement; 'enumerate' needs a crisp list.",
  conclusion: "End with a balanced conclusion or a concrete way forward, not a summary.",
  examples: "Back points with specifics: a scheme, a committee report, a judgement, a statistic or a case.",
  language: "Shorter sentences and fewer repetitions; proofread for errors.",
};

type Breakdown = Pick<ScoreBreakdown, "criteria" | "dimensions" | "points" | "wordCount" | "wordLimit">;

/**
 * @param breakdowns newest first; only the most recent WINDOW are used.
 */
export function findWeaknesses(breakdowns: Breakdown[]): Weakness[] {
  const recent = breakdowns.filter(Boolean).slice(0, WINDOW);
  const n = recent.length;
  if (n < MIN_ANSWERS) return [];

  const out: Weakness[] = [];
  const push = (key: string, label: string, advice: string, hits: number, outOf: number) => {
    if (outOf >= MIN_ANSWERS && hits / outOf >= RATE_THRESHOLD) {
      out.push({ key, label, advice, occurrences: hits, outOf, severity: hits / outOf >= 0.8 ? "high" : "medium" });
    }
  };

  for (const c of CRITERIA) {
    const hits = recent.filter((b) => (b.criteria?.[c]?.rating ?? 5) <= 2).length;
    push(`criterion:${c}`, `Weak ${CRITERION_LABELS[c].toLowerCase()}`, CRITERION_ADVICE[c], hits, n);
  }

  // Dimensions recur across questions by label ("Economic", "Ethical").
  const byLabel = new Map<string, { label: string; hits: number; outOf: number }>();
  for (const b of recent) {
    for (const d of b.dimensions ?? []) {
      const key = d.label.trim().toLowerCase();
      if (!key || key === "content") continue;
      const e = byLabel.get(key) ?? { label: d.label.trim(), hits: 0, outOf: 0 };
      e.outOf++;
      if (d.coverage < 0.4) e.hits++;
      byLabel.set(key, e);
    }
  }
  for (const [key, e] of byLabel) {
    push(
      `dimension:${key}`,
      `You often miss the ${e.label.toLowerCase()} dimension`,
      `When a question has a ${e.label.toLowerCase()} angle, give it its own paragraph.`,
      e.hits,
      e.outOf,
    );
  }

  const mustHaveMisses = recent.filter((b) => {
    const must = (b.points ?? []).filter((p) => p.mustHave);
    return must.length > 0 && must.filter((p) => p.coverage === "none").length / must.length >= 0.5;
  }).length;
  push(
    "must-have",
    "Core points missing",
    "Before writing, list the 3-4 points any examiner would expect; make sure each appears.",
    mustHaveMisses,
    n,
  );

  const limited = recent.filter((b) => b.wordLimit);
  push(
    "word-limit",
    "Going over the word limit",
    "Plan for the limit: about 15% for the introduction, 70% body, 15% conclusion.",
    limited.filter((b) => b.wordCount > (b.wordLimit as number) * 1.2).length,
    limited.length,
  );

  return out.sort((a, b) => b.occurrences / b.outOf - a.occurrences / a.outOf);
}
