// Called by the browser when Razorpay Checkout succeeds. Checks the signature
// and credits the order at once; the webhook does the same if this never runs.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, json, requireUser } from "../_shared/auth.ts";
import { razorpayKeys, verifyCheckoutSignature } from "../_shared/razorpay.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const ctx = await requireUser(req);
  if (ctx instanceof Response) return ctx;
  const keys = razorpayKeys();
  if (!keys) return json(req, { error: "Online payments aren't set up yet.", code: "PAYMENTS_NOT_CONFIGURED" }, 503);

  let body: { orderId?: unknown; paymentId?: unknown; signature?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const { orderId, paymentId, signature } = body;
  if (typeof orderId !== "string" || typeof paymentId !== "string" || typeof signature !== "string") {
    return json(req, { error: "orderId, paymentId and signature are required" }, 400);
  }

  if (!(await verifyCheckoutSignature(orderId, paymentId, signature, keys.keySecret))) {
    console.warn("bad checkout signature", { user: ctx.user.id, orderId });
    return json(req, { error: "Payment could not be verified.", code: "BAD_SIGNATURE" }, 400);
  }

  const { data: order } = await ctx.adminClient
    .from("payment_orders").select("user_id, amount_paise").eq("id", orderId).maybeSingle();
  if (!order || order.user_id !== ctx.user.id) {
    return json(req, { error: "Order not found.", code: "UNKNOWN_ORDER" }, 404);
  }

  // The signature binds this payment to our order, and the order's amount was fixed by us.
  const { data, error } = await ctx.adminClient.rpc("fulfil_payment_order", {
    p_order_id: orderId,
    p_payment_id: paymentId,
    p_amount_paise: order.amount_paise,
    p_via: "checkout",
  });
  if (error) {
    console.error("fulfil failed", error);
    return json(req, { error: "Payment received; credits will appear shortly.", code: "PENDING" }, 202);
  }
  const outcome = (data as { outcome: string; balance?: number; credits?: number }) ?? { outcome: "unknown" };
  if (outcome.outcome !== "paid" && outcome.outcome !== "already_paid") {
    console.error("unexpected fulfil outcome", outcome);
    return json(req, { error: "Payment received; credits will appear shortly.", code: "PENDING" }, 202);
  }
  return json(req, { status: outcome.outcome, creditsRemaining: outcome.balance ?? null, creditsAdded: outcome.credits ?? null });
});
