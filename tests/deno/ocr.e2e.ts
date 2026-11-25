// Run: npm run test:edge
// ocr-handwriting and ocr-pdf: sign-in required, size and page caps, daily quota
// (admins exempt), and pages given back when a read fails.
Deno.env.set("SUPABASE_URL", "https://proj.supabase.co");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
Deno.env.set("VISION_BASE_URL", "https://vision.example/v1");
Deno.env.set("VISION_API_KEY", "vk");
Deno.env.set("VISION_MODEL", "qwen/qwen3.8-27b:free");
Deno.env.set("OCR_DAILY_PAGE_LIMIT", "3");

const USER = "11111111-1111-1111-1111-111111111111";
const ADMIN = "22222222-2222-2222-2222-222222222222";
const state = { used: 0, vision: "ok" as "ok" | "fail", visionCalls: 0, releases: 0 };

const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  if (url.host === "vision.example") {
    state.visionCalls++;
    if (state.vision === "fail") return new Response("boom", { status: 500 });
    return j({ choices: [{ message: { content: `page text ${state.visionCalls}` } }] });
  }
  if (url.pathname === "/auth/v1/user") {
    const auth = req.headers.get("authorization");
    if (auth === "Bearer good") return j({ id: USER, aud: "authenticated" });
    if (auth === "Bearer admin") return j({ id: ADMIN, aud: "authenticated" });
    return j({ msg: "bad jwt" }, 401);
  }
  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    const fn = url.pathname.slice("/rest/v1/rpc/".length);
    const a = await req.json();
    if (fn === "has_role") return j(a._user_id === ADMIN);
    if (fn === "reserve_ocr_pages") {
      if (state.used + a.p_pages > a.p_limit) return j(-1);
      state.used += a.p_pages;
      return j(a.p_limit - state.used);
    }
    if (fn === "release_ocr_pages") {
      state.releases++;
      state.used = Math.max(0, state.used - a.p_pages);
      return j(null);
    }
  }
  return j({ error: `unmocked ${req.method} ${url}` }, 599);
}) as typeof fetch;

const capture = await import("./serve_capture.ts");
await import("../../supabase/functions/ocr-handwriting/index.ts");
const handwriting = capture.handler!;
await import("../../supabase/functions/ocr-pdf/index.ts");
const pdf = capture.handler!;

let ok = true;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " " + JSON.stringify(detail)}`);
  ok &&= cond;
};
const post = async (h: typeof pdf, body: unknown, token = "good") => {
  const res = await h(new Request("https://fn.example/", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", origin: "https://app.example" },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json().catch(() => null) };
};
const IMG = "data:image/jpeg;base64,iVBORw0KGgo=";

let r = await post(handwriting, { imageData: IMG }, "bad");
check("signed-out request rejected", r.status === 401 && state.visionCalls === 0, r);

r = await post(handwriting, { imageData: IMG });
check("handwriting read counts one page", r.status === 200 && r.body.text === "page text 1" && r.body.pagesLeftToday === 2 && state.used === 1, r);

r = await post(handwriting, { imageData: "x".repeat(8_000_001) });
check("oversized photo refused before any quota or AI call", r.status === 413 && r.body.code === "IMAGE_TOO_LARGE" && state.used === 1 && state.visionCalls === 1, r);

r = await post(pdf, { images: [IMG, IMG, IMG] });
check("more than 2 pages per request refused", r.status === 400 && r.body.code === "TOO_MANY_PAGES" && state.used === 1, r);

state.vision = "fail";
r = await post(handwriting, { imageData: IMG });
check("failed read gives the page back", r.status === 502 && r.body.code === "OCR_FAILED" && state.used === 1 && state.releases === 1, r);

r = await post(pdf, { images: [IMG, IMG] });
check("pdf: all pages failed → pages given back", r.status === 502 && state.used === 1 && state.releases === 2, r);
state.vision = "ok";

r = await post(pdf, { images: [IMG, IMG] });
check("pdf reads 2 pages, counts 2", r.status === 200 && r.body.pages.length === 2 && r.body.pagesLeftToday === 0 && state.used === 3, r);

const callsBefore = state.visionCalls;
r = await post(handwriting, { imageData: IMG });
check("over quota → 429 OCR_QUOTA, AI not called", r.status === 429 && r.body.code === "OCR_QUOTA" && r.body.limit === 3 && state.visionCalls === callsBefore, r);

r = await post(pdf, { images: [IMG] }, "admin");
check("admins are exempt from the quota", r.status === 200 && r.body.pagesLeftToday === null && state.used === 3, r);

Deno.exit(ok ? 0 : 1);
