// Run: npm run test:edge
// export-my-data and delete-account against faked Supabase APIs; plus the
// OpenRouter no-training routing flag in the AI client.
Deno.env.set("SUPABASE_URL", "https://proj.supabase.co");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");

const USER = "11111111-1111-1111-1111-111111111111";
const ADMIN = "22222222-2222-2222-2222-222222222222";
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const state = {
  files: Array.from({ length: 130 }, (_, i) => `p${i}.jpg`),
  removed: [] as string[],
  deletedUsers: [] as string[],
  tablesRead: [] as string[],
  llmBodies: [] as Row[],
};
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  const p = url.pathname;
  if (url.host === "openrouter.ai" || url.host === "groq.example") {
    state.llmBodies.push({ host: url.host, ...(await req.json()) });
    return j({ choices: [{ message: { content: "ok" } }] });
  }
  if (p === "/auth/v1/user") {
    const auth = req.headers.get("authorization");
    if (auth === "Bearer good") return j({ id: USER, email: "Aspirant@Gmail.com", aud: "authenticated", created_at: "2026-11-01", identities: [{ provider: "email" }], user_metadata: { full_name: "A" } });
    if (auth === "Bearer admin") return j({ id: ADMIN, email: "admin@x.in", aud: "authenticated" });
    return j({ msg: "bad" }, 401);
  }
  if (p.startsWith("/rest/v1/rpc/has_role")) {
    const a = await req.json();
    return j(a._user_id === ADMIN);
  }
  if (p.startsWith("/rest/v1/")) {
    const table = p.slice("/rest/v1/".length);
    state.tablesRead.push(table);
    if (table === "answer_submissions") return j([{ id: "s1", answer_text: "my answer", job_payload: { secret: 1 }, locked_until: null }]);
    return j([]);
  }
  if (p === "/storage/v1/object/list/answer-uploads") {
    const { prefix, limit } = await req.json();
    if (prefix !== USER) return j([]);
    return j(state.files.slice(0, limit).map((name) => ({ name, created_at: "2026-11-20" })));
  }
  if (p === "/storage/v1/object/answer-uploads" && req.method === "DELETE") {
    const { prefixes } = await req.json();
    state.removed.push(...prefixes);
    state.files = state.files.filter((f) => !prefixes.includes(`${USER}/${f}`));
    return j(prefixes.map((name: string) => ({ name })));
  }
  if (p.startsWith("/auth/v1/admin/users/") && req.method === "DELETE") {
    state.deletedUsers.push(p.split("/").pop()!);
    return j({});
  }
  return j({ error: `unmocked ${req.method} ${url}` }, 599);
}) as typeof fetch;

const capture = await import("./serve_capture.ts");
await import("../../supabase/functions/export-my-data/index.ts");
const exportFn = capture.handler!;
await import("../../supabase/functions/delete-account/index.ts");
const deleteFn = capture.handler!;
const { USER_TABLES } = await import("../../supabase/functions/export-my-data/index.ts");

let ok = true;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " " + JSON.stringify(detail)}`);
  ok &&= cond;
};
const call = async (h: typeof exportFn, body: unknown, token = "good") => {
  const res = await h(new Request("https://fn.example/", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json().catch(() => null) };
};

let r = await call(exportFn, {}, "nope");
check("export needs sign-in", r.status === 401, r);

r = await call(exportFn, {});
check("export covers every user table", r.status === 200 && USER_TABLES.every(([t]) => t in r.body.data) && state.tablesRead.length === USER_TABLES.length, Object.keys(r.body?.data ?? {}));
check("export includes account + photo list, strips internal job fields",
  r.body.account.email === "Aspirant@Gmail.com" && r.body.uploaded_answer_photos.length === 130 &&
    r.body.data.answer_submissions[0].answer_text === "my answer" && !("job_payload" in r.body.data.answer_submissions[0]), r.body.data.answer_submissions);

r = await call(deleteFn, { confirmEmail: "someone@else.in" });
check("delete refuses without the exact email", r.status === 400 && r.body.code === "CONFIRMATION_MISMATCH" && state.deletedUsers.length === 0, r);

r = await call(deleteFn, { confirmEmail: "admin@x.in" }, "admin");
check("admin accounts aren't self-deleted", r.status === 403 && state.deletedUsers.length === 0, r);

r = await call(deleteFn, { confirmEmail: "  aspirant@gmail.com " });
check("delete removes all photos (paged) then the account",
  r.status === 200 && r.body.deleted === true && state.removed.length === 130 && state.files.length === 0 && state.deletedUsers[0] === USER, { r, removed: state.removed.length });

// --- OpenRouter: never route students' answers to providers that train -----
const { chat } = await import("../../supabase/functions/_shared/llm.ts");
await chat({ messages: [{ role: "user", content: "hi" }], providers: [{ name: "or", url: "https://openrouter.ai/api/v1/chat/completions", headers: {}, model: "m" }] });
await chat({ messages: [{ role: "user", content: "hi" }], providers: [{ name: "groq", url: "https://groq.example/v1/chat/completions", headers: {}, model: "m" }] });
check("OpenRouter requests deny data collection; others untouched",
  state.llmBodies[0].provider?.data_collection === "deny" && state.llmBodies[1].provider === undefined, state.llmBodies);

Deno.exit(ok ? 0 : 1);
