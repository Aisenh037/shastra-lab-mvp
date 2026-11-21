import { useEffect, useState } from "react";
import { Target } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { ScoreBreakdown } from "@/lib/evaluation";
import { findWeaknesses, MIN_ANSWERS, WINDOW, type Weakness } from "../../supabase/functions/_shared/weakness.ts";

/** Patterns that recur across the learner's recent answers (needs at least 3 evaluated answers). */
export function WeaknessPanel() {
  const { user } = useAuth();
  const [weaknesses, setWeaknesses] = useState<Weakness[] | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("answer_submissions")
        .select("score_breakdown, created_at")
        .eq("user_id", user.id)
        .not("score_breakdown", "is", null)
        .order("created_at", { ascending: false })
        .limit(WINDOW);
      const breakdowns = (data ?? []).map((r) => r.score_breakdown as unknown as ScoreBreakdown);
      setCount(breakdowns.length);
      setWeaknesses(findWeaknesses(breakdowns));
    })();
  }, [user]);

  if (weaknesses === null) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" /> Your recurring gaps
        </CardTitle>
        <CardDescription>
          {count < MIN_ANSWERS
            ? `Submit ${MIN_ANSWERS - count} more answer${MIN_ANSWERS - count === 1 ? "" : "s"} and we'll show the patterns across them.`
            : `From your last ${count} evaluated answers.`}
        </CardDescription>
      </CardHeader>
      {count >= MIN_ANSWERS && (
        <CardContent className="space-y-4">
          {weaknesses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recurring gap so far. Keep going.</p>
          ) : (
            weaknesses.slice(0, 4).map((w) => (
              <div key={w.key} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{w.label}</span>
                  <Badge variant={w.severity === "high" ? "destructive" : "secondary"}>
                    {w.occurrences} of {w.outOf} answers
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{w.advice}</p>
              </div>
            ))
          )}
        </CardContent>
      )}
    </Card>
  );
}
