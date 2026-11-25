import { CheckCircle2, CircleDashed, XCircle, ShieldCheck, Info } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { ScoreBreakdown } from "@/lib/evaluation";
import { CRITERIA, CRITERION_LABELS } from "../../supabase/functions/_shared/scoring.ts";

const coverageIcon = {
  full: <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" aria-label="Covered" />,
  partial: <CircleDashed className="h-4 w-4 text-amber-500 shrink-0" aria-label="Partly covered" />,
  none: <XCircle className="h-4 w-4 text-muted-foreground shrink-0" aria-label="Not covered" />,
};

/** Shows how the score was built: which examiner points were found (with the quote) and the rated criteria. */
export function ScoreBreakdownCard({ breakdown }: { breakdown: ScoreBreakdown }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldCheck className="h-5 w-5" /> How this score was built
        </CardTitle>
        <CardDescription>
          Content {breakdown.content.marks}/{breakdown.content.outOf} · Presentation {breakdown.presentation.marks}/
          {breakdown.presentation.outOf}
          {breakdown.wordLimitPenalty > 0 && ` · −${breakdown.wordLimitPenalty} over word limit (${breakdown.wordCount}/${breakdown.wordLimit} words)`}
        </CardDescription>
        {breakdown.rubricSource === "derived_from_key_points" && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            This question doesn't have a mentor-reviewed rubric yet, so points come from its key points.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {breakdown.dimensions.map((d) => (
          <div key={d.id} className="space-y-2">
            <div className="flex items-center justify-between text-sm font-medium">
              <span>{d.label}</span>
              <span className="text-muted-foreground">{Math.round(d.coverage * 100)}% covered</span>
            </div>
            <ul className="space-y-2">
              {breakdown.points
                .filter((p) => p.dimensionId === d.id)
                .map((p) => (
                  <li key={p.id} className="flex gap-2 text-sm">
                    {coverageIcon[p.coverage]}
                    <div>
                      <span className={p.coverage === "none" ? "text-muted-foreground" : ""}>{p.text}</span>
                      {p.mustHave && p.coverage === "none" && (
                        <Badge variant="destructive" className="ml-2 text-[10px]">core point missing</Badge>
                      )}
                      {p.evidence && <p className="mt-1 border-l-2 pl-2 text-xs italic text-muted-foreground">“{p.evidence}”</p>}
                    </div>
                  </li>
                ))}
            </ul>
          </div>
        ))}

        <div className="space-y-3">
          <div className="text-sm font-medium">Presentation</div>
          {CRITERIA.map((c) => {
            const v = breakdown.criteria[c];
            return (
              <div key={c} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{CRITERION_LABELS[c]}</span>
                  <span className="text-muted-foreground">{v.rating}/5</span>
                </div>
                <Progress value={v.rating * 20} className="h-1.5" />
                {v.reason && <p className="text-xs text-muted-foreground">{v.reason}</p>}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
