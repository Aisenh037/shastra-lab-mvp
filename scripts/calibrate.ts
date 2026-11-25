// Calibration: how closely does ShastraLab score like mains-qualified evaluators?
//
// 1. Collect answers (answers.csv) and have 2-3 evaluators score each one (human.csv).
// 2. Score the same answers with the deployed evaluator (no credits used, nothing saved):
//      SUPABASE_URL=... SUPABASE_ANON_KEY=... ADMIN_ACCESS_TOKEN=<an admin user's JWT> \
//      node scripts/calibrate.ts run --answers answers.csv --out ai.csv
// 3. Compare:
//      node scripts/calibrate.ts report --human human.csv --ai ai.csv [--json report.json]
//
// answers.csv: item_id,question_id,answer_text
// human.csv:   item_id,rater,score,max_marks
// ai.csv:      item_id,score              (written by "run")

import { readFileSync, writeFileSync } from "node:fs";
import { calibrate, parseCsv, type HumanScore } from "../supabase/functions/_shared/calibration.ts";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const need = (name: string) => {
  const v = opt(name);
  if (!v) {
    console.error(`missing --${name}`);
    process.exit(2);
  }
  return v;
};
const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

async function run() {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const token = process.env.ADMIN_ACCESS_TOKEN;
  if (!url || !anon || !token) {
    console.error("set SUPABASE_URL, SUPABASE_ANON_KEY and ADMIN_ACCESS_TOKEN");
    process.exit(2);
  }
  const rows = parseCsv(readFileSync(need("answers"), "utf8"));
  const out = ["item_id,score,content_coverage,unverified_claims,rubric_source"];
  for (const [i, r] of rows.entries()) {
    const res = await fetch(`${url}/functions/v1/evaluate-answer`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: r.question_id, answerText: r.answer_text, submissionType: "typed", dryRun: true }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`${r.item_id}: ${res.status} ${body.error ?? ""}`);
      continue;
    }
    out.push([r.item_id, body.score, body.breakdown.content.coverage, body.breakdown.unverifiedClaims, body.breakdown.rubricSource].map((v) => csvCell(String(v))).join(","));
    console.error(`${i + 1}/${rows.length} ${r.item_id}: ${body.score}`);
  }
  writeFileSync(need("out"), out.join("\n") + "\n");
  console.error(`wrote ${out.length - 1} scores to ${opt("out")}`);
}

function report() {
  const humans: HumanScore[] = parseCsv(readFileSync(need("human"), "utf8")).map((r) => ({
    itemId: r.item_id,
    rater: r.rater,
    score: Number(r.score),
    maxMarks: Number(r.max_marks),
  }));
  const bad = humans.filter((h) => !h.itemId || !h.rater || !Number.isFinite(h.score) || !(h.maxMarks > 0));
  if (bad.length) {
    console.error(`${bad.length} human rows are missing item_id, rater, score or max_marks`);
    process.exit(1);
  }
  const ai = parseCsv(readFileSync(need("ai"), "utf8")).map((r) => ({ itemId: r.item_id, score: Number(r.score) }));
  const rep = calibrate(humans, ai.filter((a) => Number.isFinite(a.score)));

  const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
  console.log(`Items scored by both: ${rep.items}   Raters: ${rep.raters.join(", ")}`);
  console.log(`Tolerance: ${Object.entries(rep.tolerance).map(([m, t]) => `±${t} on ${m}-markers`).join(", ")}\n`);
  console.log(`AI vs human average   within tolerance ${pct(rep.ai.withinTolerance)}   MAE ${rep.ai.meanAbsError}   bias ${rep.ai.bias > 0 ? "+" : ""}${rep.ai.bias}   Spearman ${rep.ai.spearman ?? "n/a"}`);
  console.log(`Human vs human        within tolerance ${pct(rep.humanVsHuman.withinTolerance)}   MAE ${rep.humanVsHuman.meanAbsError ?? "n/a"}   (${rep.humanVsHuman.pairs} pairs)\n`);
  for (const r of rep.perRater) console.log(`  AI vs ${r.rater}: MAE ${r.aiMeanAbsError} over ${r.items} items`);
  console.log(`\nLargest disagreements (fix these rubrics first):`);
  for (const w of rep.worst) console.log(`  ${w.itemId}: AI ${w.ai} vs human ${w.human} (${w.diff > 0 ? "+" : ""}${w.diff})`);
  console.log(`\n${rep.verdict}`);
  const json = opt("json");
  if (json) writeFileSync(json, JSON.stringify(rep, null, 2));
}

if (cmd === "run") await run();
else if (cmd === "report") report();
else {
  console.error("usage: node scripts/calibrate.ts run --answers answers.csv --out ai.csv\n       node scripts/calibrate.ts report --human human.csv --ai ai.csv [--json report.json]");
  process.exit(2);
}
