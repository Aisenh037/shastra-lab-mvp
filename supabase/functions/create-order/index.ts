// Start a credit-pack purchase: price comes from credit_packs (never from the
// browser); the Razorpay order is tied to the signed-in user.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, json, requireUser } from "../_shared/auth.ts";
import { createRazorpayOrder, razorpayKeys } from "../_shared/razorpay.ts";

/** Unpaid orders a user may open per hour (stops order spam). */
const MAX_OPEN_ORDERS_PER_HOUR = 10;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const ctx = await requireUser(req);
  if (ctx instanceof Response) return ctx;

  const keys = razorpayKeys();
  if (!keys) return json(req, { error: "Online payments aren't set up yet.", code: "PAYMENTS_NOT_CONFIGURED" }, 503);

  let packId: unknown;
  try {
    ({ packId } = await req.json());
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  if (typeof packId !== "string") return json(req, { error: "packId is required" }, 400);

  const { data: pack } = await ctx.adminClient
    .from("credit_packs").select("id, credits, price_paise").eq("id", packId).eq("active", true).maybeSingle();
  if (!pack) return json(req, { error: "That pack isn't available.", code: "UNKNOWN_PACK" }, 404);

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await ctx.adminClient
    .from("payment_orders").select("id", { count: "exact", head: true })
    .eq("user_id", ctx.user.id).eq("status", "created").gte("created_at", since);
  if ((count ?? 0) >= MAX_OPEN_ORDERS_PER_HOUR) {
    return json(req, { error: "Too many checkout attempts. Try again in an hour.", code: "TOO_MANY_ORDERS" }, 429);
  }

  let order;
  try {
    order = await createRazorpayOrder(keys, pack.price_paise, `sl_${crypto.randomUUID().slice(0, 30)}`, {
      user_id: ctx.user.id,
      pack_id: pack.id,
    });
  } catch (e) {
    console.error(e);
    return json(req, { error: "Couldn't start the payment. Try again.", code: "GATEWAY_ERROR" }, 502);
  }

  const { error } = await ctx.adminClient.from("payment_orders").insert({
    id: order.id,
    user_id: ctx.user.id,
    pack_id: pack.id,
    credits: pack.credits,
    amount_paise: pack.price_paise,
  });
  if (error) {
    console.error("saving order failed", error);
    return json(req, { error: "Couldn't start the payment. Try again.", code: "GATEWAY_ERROR" }, 500);
  }

  return json(req, {
    orderId: order.id,
    amount: pack.price_paise,
    currency: "INR",
    keyId: keys.keyId,
    credits: pack.credits,
    email: ctx.user.email ?? null,
  });
});
