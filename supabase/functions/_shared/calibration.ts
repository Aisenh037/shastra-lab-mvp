// AI-vs-human agreement statistics for the calibration set.
// Pure TypeScript; used by scripts/calibrate.ts and its tests.

export interface HumanScore {
  itemId: string;
  rater: string;
  score: number;
  maxMarks: number;
}

export interface AiScore {
  itemId: string;
  score: number;
}

export interface CalibrationReport {
  items: number;
  raters: string[];
  /** ± marks counted as agreement, scaled to max marks (1.5 on a 10-marker). */
  tolerance: Record<number, number>;
  ai: {
    meanAbsError: number;
    withinTolerance: number;
    bias: number;
    pearson: number | null;
    spearman: number | null;
  };
  /** How much humans agree with each other: the ceiling the AI is judged against. */
  humanVsHuman: { pairs: number; meanAbsError: number | null; withinTolerance: number | null };
  perRater: Array<{ rater: string; items: number; aiMeanAbsError: number }>;
  worst: Array<{ itemId: string; ai: number; human: number; diff: number }>;
  verdict: string;
}

export const toleranceFor = (maxMarks: number) => Math.round(maxMarks * 0.15 * 10) / 10;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? null : num / Math.sqrt(dx * dy);
}

function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k][1]] = avg;
    i = j + 1;
  }
  return out;
}

export const spearman = (xs: number[], ys: number[]) => pearson(ranks(xs), ranks(ys));

export function calibrate(humans: HumanScore[], ais: AiScore[]): CalibrationReport {
  const byItem = new Map<string, HumanScore[]>();
  for (const h of humans) byItem.set(h.itemId, [...(byItem.get(h.itemId) ?? []), h]);
  const aiByItem = new Map(ais.map((a) => [a.itemId, a.score]));

  const ids = [...byItem.keys()].filter((id) => aiByItem.has(id));
  if (ids.length === 0) throw new Error("no items have both human and AI scores");

  const tolerance: Record<number, number> = {};
  const aiVals: number[] = [];
  const humanVals: number[] = [];
  const errors: Array<{ itemId: string; ai: number; human: number; diff: number; tol: number }> = [];

  for (const id of ids) {
    const hs = byItem.get(id)!;
    const max = hs[0].maxMarks;
    tolerance[max] = toleranceFor(max);
    const human = mean(hs.map((h) => h.score));
    const ai = aiByItem.get(id)!;
    aiVals.push(ai);
    humanVals.push(human);
    errors.push({ itemId: id, ai, human: r3(human), diff: r3(ai - human), tol: toleranceFor(max) });
  }

  // Human-human agreement over every pair of raters on the same item.
  const hhDiffs: Array<{ d: number; tol: number }> = [];
  for (const id of ids) {
    const hs = byItem.get(id)!;
    for (let i = 0; i < hs.length; i++)
      for (let j = i + 1; j < hs.length; j++)
        hhDiffs.push({ d: Math.abs(hs[i].score - hs[j].score), tol: toleranceFor(hs[i].maxMarks) });
  }

  const raters = [...new Set(humans.map((h) => h.rater))].sort();
  const perRater = raters.map((rater) => {
    const mine = humans.filter((h) => h.rater === rater && aiByItem.has(h.itemId));
    return {
      rater,
      items: mine.length,
      aiMeanAbsError: mine.length ? r3(mean(mine.map((h) => Math.abs(aiByItem.get(h.itemId)! - h.score)))) : 0,
    };
  });

  const mae = mean(errors.map((e) => Math.abs(e.diff)));
  const within = errors.filter((e) => Math.abs(e.diff) <= e.tol).length / errors.length;
  const hhMae = hhDiffs.length ? mean(hhDiffs.map((x) => x.d)) : null;
  const hhWithin = hhDiffs.length ? hhDiffs.filter((x) => x.d <= x.tol).length / hhDiffs.length : null;

  const pct = (x: number) => `${Math.round(x * 100)}%`;
  let verdict =
    within >= 0.7
      ? `PASS: ${pct(within)} of AI scores fall within tolerance of the human average (target 70%).`
      : `NOT YET: ${pct(within)} of AI scores fall within tolerance of the human average (target 70%).`;
  if (hhWithin !== null) verdict += ` Humans agree with each other ${pct(hhWithin)} of the time.`;
  const bias = mean(errors.map((e) => e.diff));
  if (Math.abs(bias) >= 0.5) verdict += ` The AI scores ${bias > 0 ? "higher" : "lower"} than humans by ${r3(Math.abs(bias))} marks on average.`;

  return {
    items: ids.length,
    raters,
    tolerance,
    ai: {
      meanAbsError: r3(mae),
      withinTolerance: r3(within),
      bias: r3(bias),
      pearson: (() => { const p = pearson(aiVals, humanVals); return p === null ? null : r3(p); })(),
      spearman: (() => { const s = spearman(aiVals, humanVals); return s === null ? null : r3(s); })(),
    },
    humanVsHuman: {
      pairs: hhDiffs.length,
      meanAbsError: hhMae === null ? null : r3(hhMae),
      withinTolerance: hhWithin === null ? null : r3(hhWithin),
    },
    perRater,
    worst: errors
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .slice(0, 10)
      .map(({ tol: _tol, ...e }) => e),
    verdict,
  };
}

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF). Returns objects keyed by header. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}
