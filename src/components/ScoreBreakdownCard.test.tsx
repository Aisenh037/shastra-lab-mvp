import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScoreBreakdownCard } from "./ScoreBreakdownCard";
import { computeScore } from "../../supabase/functions/_shared/scoring.ts";
import { answer, judgement, rubric } from "../../tests/engine/fixtures.ts";

describe("ScoreBreakdownCard", () => {
  it("shows each rubric point with its quote, missing core points and the marks split", () => {
    const j = judgement();
    j.points[2] = { id: "pol-1", coverage: "none", evidence: "" };
    const { container } = render(<ScoreBreakdownCard breakdown={computeScore(rubric, j, answer)} />);

    // coverage 3/6 weighted → 3 of 6 content marks; all criteria 3/5 → 2 of 4 presentation marks
    expect(container.textContent).toMatch(/Content 3\/6 · Presentation 2\/4/);
    expect(screen.getByText("Economic")).toBeInTheDocument();
    expect(screen.getByText(/they face limited access to formal credit/)).toBeInTheDocument();
    expect(screen.getAllByText("core point missing")).toHaveLength(1);
    expect(screen.getByText("Answers the directive")).toBeInTheDocument();
    expect(screen.queryByText(/doesn't have a mentor-reviewed rubric/)).not.toBeInTheDocument();
  });

  it("says when the rubric is only derived from key points", () => {
    const b = { ...computeScore(rubric, judgement(), answer), rubricSource: "derived_from_key_points" as const };
    render(<ScoreBreakdownCard breakdown={b} />);
    expect(screen.getByText(/doesn't have a mentor-reviewed rubric/)).toBeInTheDocument();
  });
});
