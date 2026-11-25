// Run: npm run test:edge
// create-order, verify-payment and razorpay-webhook against a faked Razorpay
// API and a faked database (RPC outcomes mirror fulfil_payment_order).
Deno.env.set("SUPABASE_URL", "https://proj.supabase.co");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
Deno.env.set("RAZORPAY_KEY_ID", "rzp_test_abc");
Deno.env.set("RAZORPAY_KEY_SECRET", "keysecret");
Deno.env.set("RAZORPAY_WEBHOOK_SECRET", "hooksecret");

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "33333333-3333-3333-3333-333333333333";
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const state = {
  orders: new Map<string, Row>(),
  events: new Map<string, Row>(),
  balance: 1,
  rzpBodies: [] as Row[],
  rzpAuth: "" as string | null,
  rzpFail: false,
  dbFail: false,
  failed: [] as string[],
  refunds: [] as Row[],
};
let orderSeq = 0;

const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const filters = (url: URL) =>
  Object.fromEntries([...url.searchParams.entries()].filter(([, v]) => /^(eq|gte)\./.test(v)).map(([k, v]) => [k, v.replace(/^(eq|gte)\./, "")]));

function fulfil(a: Row) {
  const o = state.orders.get(a.p_order_id);
  if (!o) return { outcome: "unknown_order" };
  if (o.status === "paid") return { outcome: "already_paid", balance: state.balance };
  if (a.p_amount_paise !== o.amount_paise) return { outcome: "amount_mismatch" };
  Object.assign(o, { status: "paid", payment_id: a.p_payment_id, paid_via: a.p_via });
  state.balance += o.credits;
  return { outcome: "paid", balance: state.balance, credits: o.credits };
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  if (url.host === "api.razorpay.com") {
    state.rzpAuth = req.headers.get("authorization");
    const body = await req.json();
    state.rzpBodies.push(body);
    if (state.rzpFail) return j({ error: { description: "down" } }, 500);
    return j({ id: `order_${++orderSeq}`, amount: body.amount, currency: "INR", status: "created" });
  }
  if (url.pathname === "/auth/v1/user") {
    const auth = req.headers.get("authorization");
    if (auth === "Bearer good") return j({ id: USER, email: "a@x.in", aud: "authenticated" });
    if (auth === "Bearer other") return j({ id: OTHER, email: "b@x.in", aud: "authenticated" });
    return j({ msg: "bad" }, 401);
  }
  const f = filters(url);
  if (url.pathname === "/rest/v1/credit_packs") {
    const packs: Row = { starter: { id: "starter", credits: 5, price_paise: 9900 }, standard: { id: "standard", credits: 10, price_paise: 19900 } };
    return packs[f.id] ? j(packs[f.id]) : j(null);
  }
  if (url.pathname === "/rest/v1/payment_orders") {
    if (req.method === "HEAD" || req.headers.get("prefer")?.includes("count")) {
      const n = [...state.orders.values()].filter((o) => o.user_id === f.user_id && o.status === "created").length;
      return new Response(null, { status: 200, headers: { "content-range": `0-0/${n}` } });
    }
    if (req.method === "POST") {
      const row = await req.json();
      state.orders.set(row.id, { status: "created", ...row });
      return new Response(null, { status: 201 });
    }
    const o = state.orders.get(f.id);
    return j(o ?? null);
  }
  if (url.pathname === "/rest/v1/payment_events") {
    if (req.method === "POST") {
      const row = await req.json();
      state.events.set(row.event_id, row);
      return new Response(null, { status: 201 });
    }
    return j(state.events.get(f.event_id) ?? null);
  }
  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    const fn = url.pathname.slice("/rest/v1/rpc/".length);
    const a = await req.json();
    if (state.dbFail) return j({ message: "db down" }, 500);
    if (fn === "fulfil_payment_order") return j(fulfil(a));
    if (fn === "fail_payment_order") {
      state.failed.push(a.p_order_id);
      return j(null);
    }
    if (fn === "refund_payment") {
      state.refunds.push(a);
      return j({ outcome: "refunded", credits_taken: 5 });
    }
  }
  return j({ error: `unmocked ${req.method} ${url}` }, 599);
}) as typeof fetch;

const { hmacSha256Hex } = await import("../../supabase/functions/_shared/razorpay.ts");
const capture = await import("./serve_capture.ts");
await import("../../supabase/functions/create-order/index.ts");
const createOrder = capture.handler!;
await import("../../supabase/functions/verify-payment/index.ts");
const verifyPayment = capture.handler!;
await import("../../supabase/functions/razorpay-webhook/index.ts");
const webhook = capture.handler!;

let ok = true;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " " + JSON.stringify(detail)}`);
  ok &&= cond;
};
const call = async (h: typeof webhook, body: unknown, token = "good") => {
  const res = await h(new Request("https://fn.example/", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json().catch(() => null) };
};
const hook = async (evt: unknown, { secret = "hooksecret", id = crypto.randomUUID() } = {}) => {
  const raw = JSON.stringify(evt);
  const res = await webhook(new Request("https://fn.example/", {
    method: "POST",
    headers: { "x-razorpay-signature": await hmacSha256Hex(secret, raw), "x-razorpay-event-id": id },
    body: raw,
  }));
  return { status: res.status, body: await res.json().catch(() => null) };
};

// --- create-order ---------------------------------------------------------
let r = await call(createOrder, { packId: "standard" }, "nope");
check("create-order needs sign-in", r.status === 401, r);

r = await call(createOrder, { packId: "standard", amount: 1 });
const o1 = state.orders.get(r.body?.orderId);
check("price comes from the pack, not the browser",
  r.status === 200 && r.body.amount === 19900 && state.rzpBodies[0].amount === 19900 && o1?.user_id === USER && o1?.credits === 10, r);
check("order notes carry user + pack, Basic auth with key id/secret",
  state.rzpBodies[0].notes.user_id === USER && state.rzpBodies[0].notes.pack_id === "standard" && state.rzpAuth === `Basic ${btoa("rzp_test_abc:keysecret")}`,
  state.rzpBodies[0]);
check("response gives Checkout what it needs, never the secret",
  r.body.keyId === "rzp_test_abc" && r.body.email === "a@x.in" && !JSON.stringify(r.body).includes("keysecret"), r.body);

r = await call(createOrder, { packId: "platinum" });
check("unknown pack refused", r.status === 404 && r.body.code === "UNKNOWN_PACK", r);

state.rzpFail = true;
r = await call(createOrder, { packId: "starter" });
check("gateway error → 502, nothing saved", r.status === 502 && state.orders.size === 1, r);
state.rzpFail = false;

// --- verify-payment ---------------------------------------------------------
const orderId = o1!.id;
const sig = await hmacSha256Hex("keysecret", `${orderId}|pay_1`);

r = await call(verifyPayment, { orderId, paymentId: "pay_1", signature: "00".repeat(32) });
check("forged checkout signature rejected", r.status === 400 && r.body.code === "BAD_SIGNATURE" && state.balance === 1, r);

r = await call(verifyPayment, { orderId, paymentId: "pay_1", signature: sig }, "other");
check("another user can't claim the order", r.status === 404 && state.balance === 1, r);

r = await call(verifyPayment, { orderId, paymentId: "pay_1", signature: sig });
check("valid payment credits 10 at once", r.status === 200 && r.body.status === "paid" && r.body.creditsRemaining === 11 && r.body.creditsAdded === 10, r);

r = await call(verifyPayment, { orderId, paymentId: "pay_1", signature: sig });
check("verifying twice doesn't double-credit", r.body.status === "already_paid" && state.balance === 11, r);

// --- webhook --------------------------------------------------------------
r = await hook({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", order_id: orderId, amount: 19900 } } } }, { secret: "wrong" });
check("webhook with bad signature → 401", r.status === 401, r);

r = await hook({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", order_id: orderId, amount: 19900 } } } });
check("webhook after checkout: already paid, no double credit", r.status === 200 && r.body.outcome === "already_paid" && state.balance === 11, r);

// Tab closed before verify-payment: the webhook alone credits the order.
r = await call(createOrder, { packId: "starter" });
const o2 = r.body.orderId;
r = await hook({ event: "order.paid", payload: { order: { entity: { id: o2, amount_paid: 9900 } }, payment: { entity: { id: "pay_2", order_id: o2, amount: 9900 } } } },
  { id: "evt_paid_2" });
check("webhook alone credits an order (tab closed)", r.body.outcome === "paid" && state.balance === 16 && state.orders.get(o2)?.paid_via === "webhook", r);

r = await hook({ event: "order.paid", payload: {} }, { id: "evt_paid_2" });
check("redelivered event skipped by event id", r.status === 200 && r.body.duplicate === true && state.balance === 16, r);

r = await call(createOrder, { packId: "starter" });
const o3 = r.body.orderId;
r = await hook({ event: "payment.captured", payload: { payment: { entity: { id: "pay_3", order_id: o3, amount: 100 } } } });
check("tampered amount not credited", r.status === 200 && r.body.outcome === "amount_mismatch" && state.balance === 16, r);

r = await hook({ event: "payment.failed", payload: { payment: { entity: { id: "pay_4", order_id: o3 } } } });
check("payment.failed marks the order", r.body.outcome === "failed" && state.failed.includes(o3), r);

r = await hook({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_1", amount: 9950 } } } });
check("refund.processed reaches refund_payment", r.body.outcome === "refunded" && state.refunds[0]?.p_refund_id === "rfnd_1" && state.refunds[0]?.p_amount_paise === 9950, r);

state.dbFail = true;
r = await hook({ event: "payment.captured", payload: { payment: { entity: { id: "pay_5", order_id: o3, amount: 9900 } } } }, { id: "evt_retry" });
check("database error → 500 so Razorpay retries, event not recorded", r.status === 500 && !state.events.has("evt_retry"), r);
state.dbFail = false;

r = await hook({ event: "subscription.charged", payload: {} });
check("unrelated events acknowledged and ignored", r.status === 200 && r.body.outcome === "ignored", r);

Deno.exit(ok ? 0 : 1);
