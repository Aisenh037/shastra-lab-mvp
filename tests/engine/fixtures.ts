import type { Rubric } from "../../supabase/functions/_shared/rubric.ts";
import type { ModelJudgement } from "../../supabase/functions/_shared/scoring.ts";

export const rubric: Rubric = {
  version: 1,
  directive: "critically_examine",
  paper: "GS3",
  maxMarks: 10,
  wordLimit: 150,
  source: "reviewed",
  dimensions: [
    {
      id: "economic",
      label: "Economic",
      points: [
        { id: "eco-1", text: "MSMEs face limited access to formal credit", mustHave: true },
        { id: "eco-2", text: "Delayed payments strain MSME working capital", mustHave: false },
      ],
    },
    {
      id: "policy",
      label: "Policy",
      points: [
        { id: "pol-1", text: "Emergency Credit Line Guarantee Scheme supported MSMEs", mustHave: true },
        { id: "pol-2", text: "Udyam registration formalised MSMEs", mustHave: false },
      ],
    },
  ],
};

export const answer = `MSMEs are the backbone of the Indian economy, but they face limited access to formal credit because banks demand collateral that small firms do not have.
Large buyers often delay payments for months, which strains the working capital of small units.
The government launched the Emergency Credit Line Guarantee Scheme during the pandemic to provide collateral free loans.
However implementation gaps remain and many units are still outside the formal system. A way forward is faster payment enforcement through the TReDS platform.`;

export function judgement(overrides: Partial<ModelJudgement> = {}): ModelJudgement {
  return {
    points: [
      { id: "eco-1", coverage: "full", evidence: "they face limited access to formal credit because banks demand collateral" },
      { id: "eco-2", coverage: "full", evidence: "Large buyers often delay payments for months, which strains the working capital" },
      { id: "pol-1", coverage: "partial", evidence: "launched the Emergency Credit Line Guarantee Scheme during the pandemic" },
      { id: "pol-2", coverage: "none", evidence: "" },
    ],
    criteria: {
      introduction: { rating: 3, reason: "" },
      structure: { rating: 3, reason: "" },
      directive: { rating: 3, reason: "" },
      conclusion: { rating: 3, reason: "" },
      examples: { rating: 3, reason: "" },
      language: { rating: 3, reason: "" },
    },
    feedback: {
      overallFeedback: "",
      strengths: [],
      improvements: [],
      paragraphAnalysis: [],
      formatSuggestions: "",
      modelComparison: "",
    },
    ...overrides,
  };
}
