// Razorpay -> ShastraLab. Deployed with verify_jwt = false: Razorpay can't send
// a Supabase JWT, so every request is authenticated by its HMAC signature.
//
// Dashboard -> Webhooks: URL https://<project>.supabase.co/functions/v1/razorpay-webhook,
// secret = RAZORPAY_WEBHOOK_SECRET, events: payment.captured, order.paid,
// payment.failed, refund.processed.
//
// Replies 200 once handled (or for events we ignore) so Razorpay stops retrying;
// 500 on a database error so Razorpay retries later.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { serviceClient } from "../_shared/auth.ts";
import { verifyWebhookSignature } from "../_shared/razorpay.ts";

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  if (!secret) return reply({ error: "webhook not configured" }, 503);

  const raw = await req.text();
  if (!(await verifyWebhookSignature(raw, req.headers.get("x-razorpay-signature"), secret))) {
    console.warn("webhook: bad signature");
    return reply({ error: "invalid signature" }, 401);
  }

  // deno-lint-ignore no-explicit-any
  let evt: any;
  try {
    evt = JSON.parse(raw);
  } catch {
    return reply({ error: "invalid JSON" }, 400);
  }
  const db = serviceClient();
  const eventId = req.headers.get("x-razorpay-event-id") ?? `${evt.event}:${evt.created_at}:${evt.payload?.payment?.entity?.id ?? ""}`;

  const { data: seen } = await db.from("payment_events").select("event_id").eq("event_id", eventId).maybeSingle();
  if (seen) return reply({ ok: true, duplicate: true });

  const payment = evt.payload?.payment?.entity;
  const order = evt.payload?.order?.entity;
  const refund = evt.payload?.refund?.entity;
  let outcome = "ignored";
  let orderId: string | null = payment?.order_id ?? order?.id ?? null;
  const paymentId: string | null = payment?.id ?? refund?.payment_id ?? null;

  try {
    if ((evt.event === "payment.captured" || evt.event === "order.paid") && orderId && payment?.id) {
      const amount = evt.event === "order.paid" ? order?.amount_paid ?? payment.amount : payment.amount;
      const { data, error } = await db.rpc("fulfil_payment_order", {
        p_order_id: orderId, p_payment_id: payment.id, p_amount_paise: amount, p_via: "webhook",
      });
      if (error) throw error;
      outcome = data?.outcome ?? "unknown";
      if (outcome === "amount_mismatch" || outcome === "unknown_order") console.error("webhook: not credited", evt.event, orderId, data);
    } else if (evt.event === "payment.failed" && orderId) {
      const { error } = await db.rpc("fail_payment_order", { p_order_id: orderId });
      if (error) throw error;
      outcome = "failed";
    } else if (evt.event === "refund.processed" && refund?.id && refund?.payment_id) {
      const { data, error } = await db.rpc("refund_payment", {
        p_payment_id: refund.payment_id, p_refund_id: refund.id, p_amount_paise: refund.amount,
      });
      if (error) throw error;
      outcome = data?.outcome ?? "unknown";
    }
  } catch (e) {
    console.error("webhook: database error, Razorpay will retry", e);
    return reply({ error: "temporary failure" }, 500);
  }

  await db.from("payment_events").insert({
    event_id: eventId, event: evt.event, order_id: orderId, payment_id: paymentId, outcome, payload: evt,
  });
  console.log(`webhook ${evt.event} ${orderId ?? paymentId ?? ""}: ${outcome}`);
  return reply({ ok: true, outcome });
});
