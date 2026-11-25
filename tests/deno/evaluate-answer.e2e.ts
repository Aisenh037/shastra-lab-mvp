// Run: npm run test:edge   (needs Deno 2; the import map swaps deno.land/esm.sh for npm packages and captures serve())
//
// End-to-end run of the evaluation queue: evaluate-answer (submit + background run),
// evaluation-worker (retries, stuck jobs), the AI provider client and vision OCR.
// Supabase (auth, PostgREST, RPCs) and the AI providers are faked at the fetch layer.
Deno.env.set("SUPABASE_URL", "https://proj.supabase.co");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
Deno.env.set("LLM_BASE_URL", "https://groq.example/openai/v1/");
Deno.env.set("LLM_API_KEY", "gk");
Deno.env.set("LLM_MODEL", "openai/gpt-oss-120b");
Deno.env.set("LLM_REASONING_EFFORT", "low");
Deno.env.set("LLM_FALLBACK_BASE_URL", "https://or.example/api/v1");
Deno.env.set("LLM_FALLBACK_API_KEY", "ok");
Deno.env.set("LLM_FALLBACK_MODEL", "qwen/qwen3.8-27b:free");

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const USER = "11111111-1111-1111-1111-111111111111";
const ADMIN = "22222222-2222-2222-2222-222222222222";
const WORKER_SECRET = "s3cret";

const state = {
  credits: 1,
  refunds: [] as string[],
  submissions: new Map<string, Row>(),
  rubric: null as Row | null,
  primary: "ok" as "ok" | "ratelimit" | "nojson" | "fail",
  fallback: "ok" as "ok" | "fail",
  llmBodies: [] as Row[],
};
const background: Promise<unknown>[] = [];
(globalThis as unknown as { EdgeRuntime: unknown }).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => background.push(p) };
const drain = async () => {
  while (background.length) await background.shift();
};

const answer = `MSMEs are the backbone of the Indian economy, but they face limited access to formal credit because banks demand collateral that small firms do not have.
Large buyers often delay payments for months, which strains the working capital of small units.
The government launched the Emergency Credit Line Guarantee Scheme during the pandemic to provide collateral free loans. A way forward is TReDS enforcement.`;

const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const nowIso = () => new Date().toISOString();
const eqFilters = (url: URL) =>
  [...url.searchParams.entries()].filter(([k, v]) => k !== "select" && v.startsWith("eq.")).map(([k, v]) => [k, v.slice(3)] as const);

function claim(limit: number, lockSeconds: number, id: string | null): Row[] {
  const now = Date.now();
  const due = [...state.submissions.values()]
    .filter((r) => !id || r.id === id)
    .filter((r) =>
      (r.status === "queued" && (!r.next_attempt_at || Date.parse(r.next_attempt_at) <= now)) ||
      (r.status === "processing" && r.locked_until && Date.parse(r.locked_until) < now)
    )
    .slice(0, limit);
  for (const r of due) {
    r.status = "processing";
    r.attempts = (r.attempts ?? 0) + 1;
    r.locked_until = new Date(now + lockSeconds * 1000).toISOString();
  }
  return due.map((r) => ({ ...r }));
}

const llmReply = () => {
  const content = JSON.stringify({
    points: [
      { id: "kp-1", coverage: "full", evidence: "they face limited access to formal credit because banks demand collateral" },
      { id: "kp-2", coverage: "full", evidence: "the model invented this sentence about payments" },
    ],
    criteria: Object.fromEntries(["introduction", "structure", "directive", "conclusion", "examples", "language"].map((c) => [c, { rating: 3, reason: "ok" }])),
    feedback: { overallFeedback: "Decent.", strengths: ["credit"], improvements: ["data"], paragraphAnalysis: [], formatSuggestions: "", modelComparison: "" },
  });
  return j({ choices: [{ message: { content: "```json\n" + content + "\n```" } }] });
};

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  const path = url.pathname;

  if (url.host === "groq.example" || url.host === "or.example") {
    const body = await req.json();
    state.llmBodies.push({ host: url.host, path, auth: req.headers.get("authorization"), ...body });
    const mode = url.host === "groq.example" ? state.primary : state.fallback;
    if (mode === "fail") return new Response("boom", { status: 500 });
    if (mode === "ratelimit") return new Response("rate limit", { status: 429 });
    if (mode === "nojson" && body.response_format) return new Response("response_format not supported", { status: 400 });
    return llmReply();
  }

  if (path === "/auth/v1/user") {
    const auth = req.headers.get("authorization");
    if (auth === "Bearer good") return j({ id: USER, email: "a@x.in", aud: "authenticated" });
    if (auth === "Bearer admin") return j({ id: ADMIN, email: "admin@x.in", aud: "authenticated" });
    return j({ msg: "bad jwt" }, 401);
  }
  if (path === "/rest/v1/practice_questions") {
    return j({ id: "q1", question_text: "Discuss the challenges faced by MSMEs.", max_marks: 10, word_limit: 150, model_answer: null, key_points: ["Credit access issues", "Delayed payments challenge"], subject: "Economy" });
  }
  if (path === "/rest/v1/question_rubrics") return state.rubric ? j(state.rubric) : new Response("", { status: 406 });

  if (path.startsWith("/rest/v1/rpc/")) {
    const fn = path.slice("/rest/v1/rpc/".length);
    const args = await req.json().catch(() => ({}));
    if (fn === "consume_evaluation_credit") {
      if (state.credits <= 0) return j(-1);
      state.credits--;
      return j(state.credits);
    }
    if (fn === "refund_evaluation_credit") {
      state.refunds.push(args.p_reference);
      state.credits++;
      return j(state.credits);
    }
    if (fn === "has_role") return j(args._user_id === ADMIN);
    if (fn === "claim_evaluation_jobs") return j(claim(args.p_limit, args.p_lock_seconds, args.p_id ?? null));
    if (fn === "check_worker_secret") return j(args.p_secret === WORKER_SECRET);
  }

  if (path === "/rest/v1/answer_submissions") {
    if (req.method === "POST") {
      const row = await req.json();
      state.submissions.set(row.id, { attempts: 0, created_at: nowIso(), ...row });
      return new Response(null, { status: 201 });
    }
    if (req.method === "GET") {
      const filters = eqFilters(url);
      const hit = [...state.submissions.values()].find((r) => filters.every(([k, v]) => String(r[k]) === v));
      return hit ? j(hit) : new Response("", { status: 406 });
    }
    if (req.method === "PATCH") {
      const patch = await req.json();
      const filters = eqFilters(url);
      const hit = [...state.submissions.values()].filter((r) => filters.every(([k, v]) => String(r[k]) === v));
      for (const r of hit) Object.assign(r, patch);
      return j(hit.map((r) => ({ id: r.id })));
    }
  }
  return j({ error: `unmocked ${req.method} ${url}` }, 599);
};

const capture = await import("./serve_capture.ts");
await import("../../supabase/functions/evaluate-answer/index.ts");
const submitHandler = capture.handler!;
await import("../../supabase/functions/evaluation-worker/index.ts");
const workerHandler = capture.handler!;

const submit = (body: Record<string, unknown>, token = "good", async = true) =>
  submitHandler(new Request("https://fn/evaluate-answer", { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ async, ...body }) }));
const runWorker = (secret = WORKER_SECRET) =>
  workerHandler(new Request("https://fn/evaluation-worker", { method: "POST", headers: { "x-worker-secret": secret, Authorization: "Bearer anon" }, body: "{}" }));
const makeDue = (id: string) => {
  state.submissions.get(id)!.next_attempt_at = new Date(Date.now() - 1000).toISOString();
};

let ok = true;
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`, cond ? "" : JSON.stringify(extra));
  ok &&= cond;
};

// --- submit: validation --------------------------------------------------
let r = await submit({ questionId: "q1", answerText: answer }, "anon-key-pretending");
check("rejects non-user tokens (401)", r.status === 401);

r = await submit({ questionId: "q1", answerText: "too short" });
check("evidence gate (422) without charging", r.status === 422 && state.credits === 1, await r.json());

r = await submit({ questionId: "q1", answerText: answer, imagePaths: ["someone-else/x.jpg"] });
check("rejects other users' image paths (400)", r.status === 400);

// --- submit: happy path --------------------------------------------------
r = await submit({ questionId: "q1", answerText: answer, imagePaths: [`${USER}/p1.jpg`] });
let body = await r.json();
const firstId = body.submissionId;
let row = state.submissions.get(firstId)!;
check("submit returns 202 queued and charges one credit", r.status === 202 && body.status === "queued" && body.creditsRemaining === 0 && state.credits === 0, body);
check("job saved with frozen payload, owner and photo paths", row.user_id === USER && row.job_payload?.rubric?.source === "derived_from_key_points" && row.answer_image_paths[0] === `${USER}/p1.jpg`, row);

await drain();
row = state.submissions.get(firstId)!;
check("background run scores the job", row.status === "evaluated" && row.attempts === 1 && row.locked_until === null && typeof row.score === "number", row);
check("invented quote discarded by engine", row.score_breakdown.unverifiedClaims === 1 && row.score_breakdown.points[1].coverage === "none");
check("provider and model recorded on the result", row.score_breakdown.provider === "primary" && row.score_breakdown.model === "openai/gpt-oss-120b");
console.log("   score:", row.score, "/", row.max_score, " content", row.score_breakdown.content, " presentation", row.score_breakdown.presentation);

const first = state.llmBodies.find((b) => b.host === "groq.example")!;
check("primary called OpenAI-style with model, key, JSON mode and reasoning effort",
  first.path === "/openai/v1/chat/completions" && first.auth === "Bearer gk" && first.model === "openai/gpt-oss-120b" &&
  first.reasoning_effort === "low" && first.response_format?.type === "json_object", first);

r = await submit({ questionId: "q1", answerText: answer });
check("no credits → 402 NO_CREDITS", r.status === 402 && (await r.json()).code === "NO_CREDITS");

// --- retries and final failure ------------------------------------------
state.credits = 1;
state.primary = "fail";
state.fallback = "fail";
r = await submit({ questionId: "q1", answerText: answer });
const failingId = (await r.json()).submissionId;
await drain();
row = state.submissions.get(failingId)!;
const waitS = (Date.parse(row.next_attempt_at) - Date.now()) / 1000;
check("model down → job back in queue with ~30s backoff, no refund yet",
  row.status === "queued" && row.attempts === 1 && waitS > 20 && waitS <= 30 && /All AI providers failed/.test(row.last_error) && state.refunds.length === 0, row);

r = await runWorker("wrong");
check("worker rejects a wrong secret (401)", r.status === 401);

r = await runWorker();
body = await r.json();
check("worker leaves jobs that aren't due yet", body.retry === 0 && state.submissions.get(failingId)!.attempts === 1, body);

makeDue(failingId);
body = await (await runWorker()).json();
row = state.submissions.get(failingId)!;
check("worker retries a due job (attempt 2, longer backoff)", body.retry === 1 && row.attempts === 2 && row.status === "queued", { body, row });

makeDue(failingId);
body = await (await runWorker()).json();
row = state.submissions.get(failingId)!;
check("third failure → failed and credit refunded once",
  body.failed === 1 && row.status === "failed" && state.refunds.filter((x) => x === failingId).length === 1 && state.credits === 1, { body, row, refunds: state.refunds });

body = await (await runWorker()).json();
check("failed jobs are not picked up again", body.failed === 0 && body.retry === 0 && state.refunds.length === 1, body);

// --- stuck job recovery -------------------------------------------------
state.primary = "ok";
state.fallback = "ok";
const stuckId = crypto.randomUUID();
state.submissions.set(stuckId, {
  ...state.submissions.get(firstId)!,
  id: stuckId,
  status: "processing",
  attempts: 1,
  locked_until: new Date(Date.now() - 1000).toISOString(),
  score: null,
  score_breakdown: null,
});
body = await (await runWorker()).json();
check("worker recovers a job whose worker died (lock expired)", body.evaluated === 1 && state.submissions.get(stuckId)!.status === "evaluated", body);

// --- lost lock: another worker finished first ---------------------------
const { processJob } = await import("../../supabase/functions/_shared/evaluation-job.ts");
const { serviceClient } = await import("../../supabase/functions/_shared/auth.ts");
const raceId = crypto.randomUUID();
state.submissions.set(raceId, { ...state.submissions.get(firstId)!, id: raceId, status: "evaluated", attempts: 3 });
const outcome = await processJob(serviceClient(), { ...state.submissions.get(raceId)!, attempts: 3 } as never);
check("a worker that lost its lock changes nothing", outcome === "skipped" && state.refunds.length === 1, outcome);

// --- dry run ------------------------------------------------------------
r = await submit({ questionId: "q1", answerText: answer, dryRun: true });
check("dryRun refused for non-admins (403)", r.status === 403);

const before = { credits: state.credits, rows: state.submissions.size };
r = await submit({ questionId: "q1", answerText: answer, dryRun: true }, "admin");
body = await r.json();
check("admin dryRun scores synchronously without charging or saving",
  r.status === 200 && body.status === "evaluated" && typeof body.score === "number" && state.credits === before.credits && state.submissions.size === before.rows, body);

// --- reviewed rubric ----------------------------------------------------
state.credits = 1;
state.rubric = { status: "reviewed", rubric: { version: 1, directive: "discuss", paper: "GS3", maxMarks: 99, wordLimit: 999, source: "reviewed", dimensions: [{ id: "economic", label: "Economic", points: [{ id: "kp-1", text: "Credit", mustHave: true }, { id: "kp-2", text: "Payments", mustHave: false }] }] } };
r = await submit({ questionId: "q1", answerText: answer });
const reviewedId = (await r.json()).submissionId;
await drain();
row = state.submissions.get(reviewedId)!;
check("uses reviewed rubric, with the question's own marks",
  row.status === "evaluated" && row.score_breakdown.rubricSource === "reviewed" && row.score_breakdown.maxMarks === 10 && row.score_breakdown.dimensions[0].label === "Economic", row.score_breakdown);
state.rubric = null;

// --- provider fallback and JSON-mode retry ------------------------------
state.credits = 1;
state.llmBodies = [];
state.primary = "ratelimit";
r = await submit({ questionId: "q1", answerText: answer });
let id = (await r.json()).submissionId;
await drain();
row = state.submissions.get(id)!;
check("primary rate-limited → fallback answers", row.status === "evaluated" && row.score_breakdown.provider === "fallback" && row.score_breakdown.model === "qwen/qwen3.8-27b:free", row.score_breakdown);

state.credits = 1;
state.llmBodies = [];
state.primary = "nojson";
r = await submit({ questionId: "q1", answerText: answer });
id = (await r.json()).submissionId;
await drain();
row = state.submissions.get(id)!;
const groqCalls = state.llmBodies.filter((b) => b.host === "groq.example");
check("JSON mode rejected → retried on same provider without it",
  row.status === "evaluated" && row.score_breakdown.provider === "primary" && groqCalls.length === 2 && !groqCalls[1].response_format, groqCalls.map((b) => !!b.response_format));
state.primary = "ok";

// --- older clients still get the result in one response -----------------
state.credits = 1;
r = await submit({ questionId: "q1", answerText: answer }, "good", false);
body = await r.json();
row = state.submissions.get(body.submissionId)!;
check("legacy (sync) client gets the full result inline",
  r.status === 200 && body.status === "evaluated" && body.score === row.score && body.breakdown?.engineVersion === "v2.0" && body.creditsRemaining === 0 && background.length === 0, body);

// --- OCR goes to the vision model ---------------------------------------
Deno.env.set("VISION_BASE_URL", "https://or.example/api/v1");
Deno.env.set("VISION_API_KEY", "vk");
Deno.env.set("VISION_MODEL", "qwen/qwen3.8-27b:free");
const ocr = await import("../../supabase/functions/_shared/ocr.ts");
state.llmBodies = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  state.llmBodies.push({ host: new URL(req.url).host, auth: req.headers.get("authorization"), ...(await req.json()) });
  return j({ choices: [{ message: { content: "  MSMEs face limited access to credit.\n\nWay forward: TReDS.  " } }] });
}) as typeof fetch;
const text = await ocr.transcribeImage("iVBORw0KGgo=");
const ob = state.llmBodies[0];
check("OCR uses the vision model with the image as a data URL",
  ocr.ocrMode() === "vision" && text === "MSMEs face limited access to credit.\n\nWay forward: TReDS." && ob.host === "or.example" &&
  ob.auth === "Bearer vk" && ob.model === "qwen/qwen3.8-27b:free" && ob.messages[0].content[1].image_url.url === "data:image/jpeg;base64,iVBORw0KGgo=", ob);

Deno.exit(ok ? 0 : 1);
