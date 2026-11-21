// Run: npm run test:edge   (needs Deno 2; the import map swaps deno.land/esm.sh for npm packages and captures serve())
// End-to-end run of the evaluate-answer handler with Supabase + Azure faked at the fetch layer.
Deno.env.set("SUPABASE_URL", "https://proj.supabase.co");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
Deno.env.set("AZURE_OPENAI_ENDPOINT", "https://az.example/");
Deno.env.set("AZURE_OPENAI_API_KEY", "k");

const USER = "11111111-1111-1111-1111-111111111111";
const state = { credits: 1, inserted: [] as any[], refunds: 0, azureMode: "ok" as "ok" | "fail", rubric: null as any, calls: [] as string[] };
const answer = `MSMEs are the backbone of the Indian economy, but they face limited access to formal credit because banks demand collateral that small firms do not have.
Large buyers often delay payments for months, which strains the working capital of small units.
The government launched the Emergency Credit Line Guarantee Scheme during the pandemic to provide collateral free loans. A way forward is TReDS enforcement.`;

const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  state.calls.push(`${req.method} ${url.pathname}`);
  if (url.pathname === "/auth/v1/user") return req.headers.get("authorization") === "Bearer good" ? j({ id: USER, email: "a@x.in", aud: "authenticated" }) : j({ msg: "bad jwt" }, 401);
  if (url.pathname === "/rest/v1/practice_questions") return j({ id: "q1", question_text: "Discuss the challenges faced by MSMEs.", max_marks: 10, word_limit: 150, model_answer: null, key_points: ["Credit access issues", "Delayed payments challenge"], subject: "Economy" });
  if (url.pathname === "/rest/v1/question_rubrics") return state.rubric ? j(state.rubric) : new Response("", { status: 406 });
  if (url.pathname === "/rest/v1/rpc/consume_evaluation_credit") { if (state.credits <= 0) return j(-1); state.credits--; return j(state.credits); }
  if (url.pathname === "/rest/v1/rpc/refund_evaluation_credit") { state.refunds++; state.credits++; return j(state.credits); }
  if (url.pathname === "/rest/v1/rpc/has_role") return j(false);
  if (url.pathname === "/rest/v1/answer_submissions") { state.inserted.push(await req.json()); return new Response(null, { status: 201 }); }
  if (url.host === "az.example") {
    if (state.azureMode === "fail") return new Response("boom", { status: 500 });
    const content = JSON.stringify({
      points: [
        { id: "kp-1", coverage: "full", evidence: "they face limited access to formal credit because banks demand collateral" },
        { id: "kp-2", coverage: "full", evidence: "the model invented this sentence about payments" },
      ],
      criteria: Object.fromEntries(["introduction", "structure", "directive", "conclusion", "examples", "language"].map((c) => [c, { rating: 3, reason: "ok" }])),
      feedback: { overallFeedback: "Decent.", strengths: ["credit"], improvements: ["data"], paragraphAnalysis: [], formatSuggestions: "", modelComparison: "" },
    });
    return j({ choices: [{ message: { content: "```json\n" + content + "\n```" } }] });
  }
  return j({ error: `unmocked ${url}` }, 599);
};

const mod = await import("./serve_capture.ts");
await import("../../supabase/functions/evaluate-answer/index.ts");
const call = (body: unknown, token = "good") =>
  mod.handler!(new Request("https://fn/evaluate-answer", { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));

let ok = true;
const check = (name: string, cond: boolean, extra?: unknown) => { console.log(`${cond ? "PASS" : "FAIL"} ${name}`, cond ? "" : JSON.stringify(extra)); ok &&= cond; };

let r = await call({ questionId: "q1", answerText: answer }, "anon-key-pretending");
check("rejects non-user tokens (401)", r.status === 401);

r = await call({ questionId: "q1", answerText: "too short" });
check("evidence gate (422) without charging", r.status === 422 && state.credits === 1, await r.json());

r = await call({ questionId: "q1", answerText: answer, imagePaths: ["someone-else/x.jpg"] });
check("rejects other users' image paths (400)", r.status === 400);

r = await call({ questionId: "q1", answerText: answer, imagePaths: [`${USER}/p1.jpg`] });
const body = await r.json();
check("evaluates (200)", r.status === 200, body);
check("charged one credit", state.credits === 0 && body.creditsRemaining === 0);
check("invented quote discarded by engine", body.breakdown.unverifiedClaims === 1 && body.breakdown.points[1].coverage === "none");
check("fallback rubric from key points", body.breakdown.rubricSource === "derived_from_key_points");
check("saved server-side with breakdown", state.inserted.length === 1 && state.inserted[0].user_id === USER && state.inserted[0].score === body.score && state.inserted[0].score_breakdown.engineVersion === "v2.0" && state.inserted[0].answer_image_paths[0] === `${USER}/p1.jpg`);
console.log("   score:", body.score, "/", body.breakdown.maxMarks, " content", body.breakdown.content, " presentation", body.breakdown.presentation);

r = await call({ questionId: "q1", answerText: answer });
check("no credits → 402 NO_CREDITS", r.status === 402 && (await r.json()).code === "NO_CREDITS");

state.credits = 1; state.azureMode = "fail";
r = await call({ questionId: "q1", answerText: answer });
const fb = await r.json();
check("model failure → 502 and credit refunded", r.status === 502 && state.refunds === 1 && state.credits === 1 && fb.creditsRemaining === 1, fb);

state.azureMode = "ok";
r = await call({ questionId: "q1", answerText: answer, dryRun: true });
check("dryRun refused for non-admins (403)", r.status === 403);

state.rubric = { status: "reviewed", rubric: { version: 1, directive: "discuss", paper: "GS3", maxMarks: 99, wordLimit: 999, source: "reviewed", dimensions: [{ id: "economic", label: "Economic", points: [{ id: "kp-1", text: "Credit", mustHave: true }, { id: "kp-2", text: "Payments", mustHave: false }] }] } };
r = await call({ questionId: "q1", answerText: answer });
const rb = await r.json();
check("uses reviewed rubric, with question's own marks", r.status === 200 && rb.breakdown.rubricSource === "reviewed" && rb.breakdown.maxMarks === 10 && rb.breakdown.dimensions[0].label === "Economic", rb.breakdown);

Deno.exit(ok ? 0 : 1);
