import { describe, expect, it } from "vitest";
import {
  checkEvidence,
  computeScore,
  extractJson,
  parseJudgement,
  quoteIsInAnswer,
  buildPrompts,
} from "../../supabase/functions/_shared/scoring.ts";
import { answer, judgement, rubric } from "./fixtures.ts";

describe("checkEvidence", () => {
  it("accepts a real answer", () => {
    expect(checkEvidence(answer).ok).toBe(true);
  });

  it("rejects short answers", () => {
    const r = checkEvidence("MSMEs need credit.");
    expect(r).toMatchObject({ ok: false, reason: "TOO_SHORT" });
  });

  it("rejects keyboard mashing", () => {
    const mash = Array.from({ length: 40 }, (_, i) => `qwrtzxcvbn${i % 7}sdfghjkl`).join(" ");
    expect(checkEvidence(mash)).toMatchObject({ ok: false, reason: "NOT_LANGUAGE" });
  });

  it("rejects copy-paste repetition", () => {
    expect(checkEvidence("growth ".repeat(80))).toMatchObject({ ok: false, reason: "REPETITIVE" });
  });

  it("accepts Hindi answers", () => {
    const hindi = "भारत में सूक्ष्म लघु और मध्यम उद्यम अर्थव्यवस्था की रीढ़ हैं ".repeat(4);
    expect(checkEvidence(hindi).ok).toBe(true);
  });
});

describe("quoteIsInAnswer", () => {
  it("matches exact quotes regardless of case and punctuation", () => {
    expect(quoteIsInAnswer("Large buyers often DELAY payments, for months", answer)).toBe(true);
  });

  it("tolerates a small OCR slip", () => {
    expect(quoteIsInAnswer("they face limted access to formal credit because banks demand collateral", answer)).toBe(true);
  });

  it("rejects invented quotes", () => {
    expect(quoteIsInAnswer("the MUDRA scheme gave loans to 40 crore beneficiaries", answer)).toBe(false);
  });

  it("rejects scattered words stitched together", () => {
    expect(quoteIsInAnswer("backbone payments pandemic platform enforcement units", answer)).toBe(false);
  });

  it("rejects quotes that are too short to verify", () => {
    expect(quoteIsInAnswer("MSMEs", answer)).toBe(false);
  });
});

describe("computeScore", () => {
  it("computes marks from verified coverage and ratings", () => {
    const b = computeScore(rubric, judgement(), answer);
    // weights: eco-1 2, eco-2 1, pol-1 2, pol-2 1 = 6; covered 2 + 1 + 1 = 4 → 0.667
    expect(b.content.coverage).toBeCloseTo(0.67, 2);
    expect(b.content.outOf).toBe(6);
    // all ratings 3 → 0.5 of 4 presentation marks
    expect(b.presentation.marks).toBe(2);
    expect(b.score).toBe(6); // 4 + 2
    expect(b.percentage).toBe(60);
    expect(b.mustHaveMissed).toEqual([]);
    expect(b.unverifiedClaims).toBe(0);
  });

  it("discards coverage the model cannot quote", () => {
    const j = judgement();
    j.points[0] = { id: "eco-1", coverage: "full", evidence: "credit guarantee trust disbursed two lakh crore" };
    const b = computeScore(rubric, j, answer);
    const eco1 = b.points.find((p) => p.id === "eco-1")!;
    expect(eco1).toMatchObject({ claimed: "full", coverage: "none", unverified: true });
    expect(b.unverifiedClaims).toBe(1);
    expect(b.mustHaveMissed).toContain("MSMEs face limited access to formal credit");
    expect(b.score).toBeLessThan(computeScore(rubric, judgement(), answer).score);
  });

  it("caps presentation marks when content is thin", () => {
    const j = judgement({
      points: rubric.dimensions.flatMap((d) => d.points.map((p) => ({ id: p.id, coverage: "none" as const, evidence: "" }))),
    });
    for (const c of Object.keys(j.criteria) as Array<keyof typeof j.criteria>) j.criteria[c].rating = 5;
    const b = computeScore(rubric, j, answer);
    expect(b.content.marks).toBe(0);
    expect(b.presentation.marks).toBe(1); // 0.25 cap × 4
    expect(b.score).toBe(1);
  });

  it("penalises answers well over the word limit", () => {
    const long = `${answer} ${answer} ${answer}`;
    const b = computeScore(rubric, judgement(), long);
    expect(b.wordLimitPenalty).toBe(1);
    expect(b.score).toBe(5);
  });

  it("rounds to half marks and stays within 0..max", () => {
    const j = judgement();
    for (const c of Object.keys(j.criteria) as Array<keyof typeof j.criteria>) j.criteria[c].rating = 5;
    j.points = j.points.map((p) => (p.id === "pol-2" ? p : { ...p, coverage: "full" }));
    const b = computeScore(rubric, j, answer);
    expect(b.score * 2).toBe(Math.round(b.score * 2));
    expect(b.score).toBeLessThanOrEqual(10);
  });

  it("reports coverage per dimension", () => {
    const b = computeScore(rubric, judgement(), answer);
    expect(b.dimensions).toEqual([
      { id: "economic", label: "Economic", coverage: 1 },
      { id: "policy", label: "Policy", coverage: 0.33 },
    ]);
  });
});

describe("parseJudgement", () => {
  it("drops unknown ids, fills missing points and clamps ratings", () => {
    const j = parseJudgement(
      {
        points: [
          { id: "eco-1", coverage: "full", evidence: "x" },
          { id: "made-up", coverage: "full", evidence: "y" },
          { id: "eco-2", coverage: "excellent", evidence: "z" },
        ],
        criteria: { introduction: { rating: 9 }, structure: { rating: "2" }, directive: { rating: -1 } },
        feedback: { strengths: ["a", 3, ""], paragraphAnalysis: [{ rating: "great" }] },
      },
      rubric,
    );
    expect(j.points.map((p) => p.id)).toEqual(["eco-1", "eco-2", "pol-1", "pol-2"]);
    expect(j.points[1].coverage).toBe("none");
    expect(j.points[2]).toEqual({ id: "pol-1", coverage: "none", evidence: "" });
    expect(j.criteria.introduction.rating).toBe(5);
    expect(j.criteria.structure.rating).toBe(2);
    expect(j.criteria.directive.rating).toBe(1);
    expect(j.criteria.language.rating).toBe(1);
    expect(j.feedback.strengths).toEqual(["a"]);
    expect(j.feedback.paragraphAnalysis[0].rating).toBe("average");
  });

  it("survives garbage", () => {
    expect(() => parseJudgement(null, rubric)).not.toThrow();
    expect(() => parseJudgement("nonsense", rubric)).not.toThrow();
  });
});

describe("extractJson / buildPrompts", () => {
  it("pulls JSON out of fenced output", () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(() => extractJson("no json here")).toThrow();
  });

  it("puts every rubric point and the directive demand into the prompt", () => {
    const { user, system } = buildPrompts({ questionText: "Q?", rubric, answer: "A" });
    for (const id of ["eco-1", "eco-2", "pol-1", "pol-2"]) expect(user).toContain(`[${id}]`);
    expect(user).toContain("critically examine");
    expect(user).toContain("<student_answer>\nA\n</student_answer>");
    expect(system).toContain("do NOT award marks");
  });
});
