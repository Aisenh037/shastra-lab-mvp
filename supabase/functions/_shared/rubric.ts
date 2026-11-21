// Per-question rubric for UPSC Mains answers.
//
// Pure TypeScript with no runtime imports: used by the evaluate-answer edge
// function (Deno), the web app (Vite) and the tests (Vitest) alike.

export const DIRECTIVES = [
  "discuss",
  "critically_examine",
  "critically_analyse",
  "analyse",
  "examine",
  "explain",
  "evaluate",
  "comment",
  "elucidate",
  "enumerate",
  "justify",
  "describe",
  "other",
] as const;
export type Directive = (typeof DIRECTIVES)[number];

export const PAPERS = ["GS1", "GS2", "GS3", "GS4", "Essay", "Optional"] as const;
export type Paper = (typeof PAPERS)[number];

/** What each directive word asks the examiner to look for. Fed to the model verbatim. */
export const DIRECTIVE_DEMANDS: Record<Directive, string> = {
  discuss: "Cover the issue from several angles (causes, effects, stakeholders) with a balanced conclusion.",
  critically_examine:
    "Examine both merits and limitations with evidence, then give a reasoned personal judgement.",
  critically_analyse:
    "Break the issue into components, weigh the strengths and weaknesses of each, and conclude with a judgement.",
  analyse: "Break the issue into its components and show how they relate; explain causes and consequences.",
  examine: "Probe the issue in detail, establish the key facts and their implications.",
  explain: "Make the concept or process clear with reasons, mechanism and examples.",
  evaluate: "Assess worth or impact against clear criteria, with evidence on both sides, and give a verdict.",
  comment: "State a clear position on the statement and support it with reasons and evidence.",
  elucidate: "Explain and clarify with examples so the reader fully understands.",
  enumerate: "List the points concisely and specifically; breadth matters more than depth.",
  justify: "Give strong reasons and evidence supporting the stated position, addressing obvious objections.",
  describe: "Give a detailed account of the features or characteristics.",
  other: "Answer exactly what the question asks.",
};

export interface RubricPoint {
  /** Stable id, unique within the rubric, e.g. "eco-1". */
  id: string;
  /** The idea an examiner would expect, written as a checkable statement. */
  text: string;
  /** Must-have points carry double weight in the content score. */
  mustHave: boolean;
}

export interface RubricDimension {
  /** Stable id, e.g. "economic". */
  id: string;
  /** Shown to users and used to spot recurring gaps across questions, e.g. "Economic". */
  label: string;
  points: RubricPoint[];
}

export interface Rubric {
  version: 1;
  directive: Directive;
  paper: Paper;
  maxMarks: number;
  wordLimit: number | null;
  dimensions: RubricDimension[];
  /** Where the rubric came from; derived rubrics are a fallback, not a reviewed rubric. */
  source: "reviewed" | "draft" | "derived_from_key_points";
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export function validateRubric(value: unknown): ValidationResult {
  const errors: string[] = [];
  const r = value as Partial<Rubric> | null;
  if (!r || typeof r !== "object") return { ok: false, errors: ["rubric must be an object"] };

  if (r.version !== 1) errors.push("version must be 1");
  if (!DIRECTIVES.includes(r.directive as Directive)) errors.push(`directive must be one of ${DIRECTIVES.join(", ")}`);
  if (!PAPERS.includes(r.paper as Paper)) errors.push(`paper must be one of ${PAPERS.join(", ")}`);
  if (typeof r.maxMarks !== "number" || r.maxMarks <= 0 || r.maxMarks > 250) errors.push("maxMarks must be 1-250");
  if (r.wordLimit !== null && (typeof r.wordLimit !== "number" || r.wordLimit <= 0))
    errors.push("wordLimit must be a positive number or null");
  if (!["reviewed", "draft", "derived_from_key_points"].includes(r.source as string))
    errors.push("source must be reviewed, draft or derived_from_key_points");

  if (!Array.isArray(r.dimensions) || r.dimensions.length === 0) {
    errors.push("dimensions must be a non-empty array");
    return { ok: false, errors };
  }

  const seen = new Set<string>();
  let pointCount = 0;
  let mustHaveCount = 0;
  r.dimensions.forEach((d, di) => {
    if (!d || typeof d !== "object") return errors.push(`dimensions[${di}] must be an object`);
    if (!ID_RE.test(d.id ?? "")) errors.push(`dimensions[${di}].id must be lowercase letters, digits, - or _`);
    if (seen.has(d.id)) errors.push(`duplicate id "${d.id}"`);
    seen.add(d.id);
    if (typeof d.label !== "string" || !d.label.trim()) errors.push(`dimensions[${di}].label is required`);
    if (!Array.isArray(d.points) || d.points.length === 0) {
      errors.push(`dimensions[${di}].points must be a non-empty array`);
      return;
    }
    d.points.forEach((p, pi) => {
      const where = `dimensions[${di}].points[${pi}]`;
      if (!ID_RE.test(p?.id ?? "")) errors.push(`${where}.id must be lowercase letters, digits, - or _`);
      if (seen.has(p?.id)) errors.push(`duplicate id "${p?.id}"`);
      seen.add(p?.id);
      if (typeof p?.text !== "string" || p.text.trim().length < 3) errors.push(`${where}.text is required`);
      if (typeof p?.mustHave !== "boolean") errors.push(`${where}.mustHave must be true or false`);
      pointCount++;
      if (p?.mustHave) mustHaveCount++;
    });
  });

  if (pointCount > 40) errors.push("a rubric should have at most 40 points");
  if (pointCount > 0 && mustHaveCount === 0) errors.push("mark at least one point as mustHave");

  return { ok: errors.length === 0, errors };
}

export function allPoints(rubric: Rubric): Array<RubricPoint & { dimensionId: string; dimensionLabel: string }> {
  return rubric.dimensions.flatMap((d) =>
    d.points.map((p) => ({ ...p, dimensionId: d.id, dimensionLabel: d.label })),
  );
}

/** Guess the directive from the question wording; reviewed rubrics set it explicitly. */
export function detectDirective(questionText: string): Directive {
  const q = questionText.toLowerCase();
  const order: Array<[RegExp, Directive]> = [
    [/critically\s+(examine|evaluate|assess)/, "critically_examine"],
    [/critically\s+analy[sz]e/, "critically_analyse"],
    [/\banaly[sz]e\b/, "analyse"],
    [/\bexamine\b/, "examine"],
    [/\bevaluate\b|\bassess\b/, "evaluate"],
    [/\belucidate\b/, "elucidate"],
    [/\benumerate\b/, "enumerate"],
    [/\bjustify\b/, "justify"],
    [/\bcomment\b/, "comment"],
    [/\bdiscuss\b/, "discuss"],
    [/\bexplain\b/, "explain"],
    [/\bdescribe\b/, "describe"],
  ];
  for (const [re, d] of order) if (re.test(q)) return d;
  return "other";
}

/**
 * Fallback for questions without a reviewed rubric: one "Content" dimension built
 * from the question's key points. The first half are treated as must-haves.
 */
export function deriveRubricFromKeyPoints(input: {
  questionText: string;
  maxMarks: number;
  wordLimit: number | null;
  keyPoints: unknown;
}): Rubric {
  const points = (Array.isArray(input.keyPoints) ? input.keyPoints : [])
    .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    .slice(0, 20);
  const half = Math.ceil(points.length / 2);
  const rubricPoints: RubricPoint[] =
    points.length > 0
      ? points.map((text, i) => ({ id: `kp-${i + 1}`, text: text.trim(), mustHave: i < half }))
      : [{ id: "kp-1", text: "Directly addresses every part of the question", mustHave: true }];
  return {
    version: 1,
    directive: detectDirective(input.questionText),
    paper: "GS1",
    maxMarks: input.maxMarks,
    wordLimit: input.wordLimit,
    dimensions: [{ id: "content", label: "Content", points: rubricPoints }],
    source: "derived_from_key_points",
  };
}
