import { describe, expect, it } from "vitest";
import { deriveRubricFromKeyPoints, detectDirective, validateRubric } from "../../supabase/functions/_shared/rubric.ts";
import { computeScore } from "../../supabase/functions/_shared/scoring.ts";
import { findWeaknesses } from "../../supabase/functions/_shared/weakness.ts";
import { calibrate, parseCsv, pearson, spearman, toleranceFor } from "../../supabase/functions/_shared/calibration.ts";
import { answer, judgement, rubric } from "./fixtures.ts";

describe("validateRubric", () => {
  it("accepts a well-formed rubric", () => {
    expect(validateRubric(rubric)).toEqual({ ok: true, errors: [] });
  });

  it("reports every problem", () => {
    const bad = {
      ...rubric,
      directive: "ponder",
      dimensions: [{ id: "Eco", label: "", points: [{ id: "eco-1", text: "x", mustHave: "yes" }] }, { id: "eco-1", label: "dup", points: [] }],
    };
    const { ok, errors } = validateRubric(bad);
    expect(ok).toBe(false);
    expect(errors.join("\n")).toMatch(/directive/);
    expect(errors.join("\n")).toMatch(/dimensions\[0\]\.id/);
    expect(errors.join("\n")).toMatch(/label is required/);
    expect(errors.join("\n")).toMatch(/mustHave must be true or false/);
    expect(errors.join("\n")).toMatch(/duplicate id "eco-1"/);
    expect(errors.join("\n")).toMatch(/points must be a non-empty array/);
  });

  it("requires at least one must-have", () => {
    const r = structuredClone(rubric);
    r.dimensions.forEach((d) => d.points.forEach((p) => (p.mustHave = false)));
    expect(validateRubric(r).errors).toContain("mark at least one point as mustHave");
  });
});

describe("detectDirective / deriveRubricFromKeyPoints", () => {
  it.each([
    ["Critically examine the role of MSMEs.", "critically_examine"],
    ["Critically analyse the farm laws.", "critically_analyse"],
    ["Discuss the role of the Arya Samaj.", "discuss"],
    ["Explain the formation of the Himalayas.", "explain"],
    ["What are the challenges?", "other"],
  ])("%s → %s", (q, d) => {
    expect(detectDirective(q)).toBe(d);
  });

  it("builds a valid fallback rubric from key points", () => {
    const r = deriveRubricFromKeyPoints({ questionText: "Discuss X", maxMarks: 15, wordLimit: 250, keyPoints: ["Founded in 1875", "Back to the Vedas", "DAV schools", 4] });
    expect(validateRubric(r).ok).toBe(true);
    expect(r.source).toBe("derived_from_key_points");
    expect(r.dimensions[0].points.map((p) => p.mustHave)).toEqual([true, true, false]);
  });

  it("still works with no key points", () => {
    const r = deriveRubricFromKeyPoints({ questionText: "Q", maxMarks: 10, wordLimit: null, keyPoints: null });
    expect(validateRubric(r).ok).toBe(true);
  });
});

describe("findWeaknesses", () => {
  const weakConclusion = () => {
    const j = judgement();
    j.criteria.conclusion.rating = 1;
    return computeScore(rubric, j, answer);
  };

  it("needs at least three answers", () => {
    expect(findWeaknesses([weakConclusion(), weakConclusion()])).toEqual([]);
  });

  it("flags a criterion that is weak in most answers", () => {
    const fine = computeScore(rubric, judgement(), answer);
    const w = findWeaknesses([weakConclusion(), weakConclusion(), weakConclusion(), fine]);
    expect(w.map((x) => x.key)).toContain("criterion:conclusion");
    const c = w.find((x) => x.key === "criterion:conclusion")!;
    expect(c).toMatchObject({ occurrences: 3, outOf: 4, severity: "medium" });
  });

  it("does not flag a one-off", () => {
    const fine = computeScore(rubric, judgement(), answer);
    expect(findWeaknesses([weakConclusion(), fine, fine, fine]).map((x) => x.key)).not.toContain("criterion:conclusion");
  });

  it("flags a dimension missed across different questions", () => {
    // policy coverage is 0.33 in the fixture → below 0.4 every time
    const b = computeScore(rubric, judgement(), answer);
    const w = findWeaknesses([b, b, b]);
    const policy = w.find((x) => x.key === "dimension:policy")!;
    expect(policy).toMatchObject({ occurrences: 3, outOf: 3, severity: "high" });
    expect(w.map((x) => x.key)).not.toContain("dimension:economic");
  });
});

describe("calibration", () => {
  it("scales tolerance with max marks", () => {
    expect(toleranceFor(10)).toBe(1.5);
    expect(toleranceFor(15)).toBe(2.3);
  });

  it("computes correlations", () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 1000])).toBeCloseTo(1);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
  });

  it("compares AI with the human average and with human-human agreement", () => {
    const humans = [
      { itemId: "a", rater: "r1", score: 6, maxMarks: 10 },
      { itemId: "a", rater: "r2", score: 7, maxMarks: 10 },
      { itemId: "b", rater: "r1", score: 4, maxMarks: 10 },
      { itemId: "b", rater: "r2", score: 4, maxMarks: 10 },
      { itemId: "c", rater: "r1", score: 8, maxMarks: 10 },
      { itemId: "c", rater: "r2", score: 7, maxMarks: 10 },
      { itemId: "d", rater: "r1", score: 3, maxMarks: 10 },
    ];
    const ai = [
      { itemId: "a", score: 6.5 },
      { itemId: "b", score: 7 },
      { itemId: "c", score: 7.5 },
      { itemId: "d", score: 3.5 },
      { itemId: "no-humans", score: 9 },
    ];
    const r = calibrate(humans, ai);
    expect(r.items).toBe(4);
    expect(r.ai.withinTolerance).toBe(0.75); // b is 3 marks off
    expect(r.ai.meanAbsError).toBe(0.875);
    expect(r.humanVsHuman).toEqual({ pairs: 3, meanAbsError: 0.667, withinTolerance: 1 });
    expect(r.worst[0]).toMatchObject({ itemId: "b", diff: 3 });
    expect(r.verdict).toMatch(/^PASS: 75%/);
    expect(r.perRater.map((p) => p.rater)).toEqual(["r1", "r2"]);
  });

  it("parses CSV with quotes, commas and newlines inside fields", () => {
    const rows = parseCsv('item_id,answer_text,score\r\na1,"MSMEs, credit and ""TReDS""\nline two",6\n\nb2,plain,4\n');
    expect(rows).toEqual([
      { item_id: "a1", answer_text: 'MSMEs, credit and "TReDS"\nline two', score: "6" },
      { item_id: "b2", answer_text: "plain", score: "4" },
    ]);
  });
});
