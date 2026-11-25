// Razorpay API + signature checks (Deno, Web Crypto).
//
// Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET (Dashboard -> API Keys),
//          RAZORPAY_WEBHOOK_SECRET (Dashboard -> Webhooks, the secret you typed).

export const RAZORPAY_API = "https://api.razorpay.com/v1";

export interface RazorpayKeys {
  keyId: string;
  keySecret: string;
}

export function razorpayKeys(): RazorpayKeys | null {
  const keyId = Deno.env.get("RAZORPAY_KEY_ID");
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  return keyId && keySecret ? { keyId, keySecret } : null;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two hex strings. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Checkout success handler signature: HMAC(order_id + "|" + payment_id, key secret). */
export async function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string, keySecret: string): Promise<boolean> {
  if (!orderId || !paymentId || !signature) return false;
  return safeEqual(await hmacSha256Hex(keySecret, `${orderId}|${paymentId}`), signature.toLowerCase());
}

/** Webhook signature: HMAC(raw request body, webhook secret). */
export async function verifyWebhookSignature(rawBody: string, signature: string | null, webhookSecret: string): Promise<boolean> {
  if (!signature) return false;
  return safeEqual(await hmacSha256Hex(webhookSecret, rawBody), signature.toLowerCase());
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export async function createRazorpayOrder(
  keys: RazorpayKeys,
  amountPaise: number,
  receipt: string,
  notes: Record<string, string>,
): Promise<RazorpayOrder> {
  const res = await fetch(`${RAZORPAY_API}/orders`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${keys.keyId}:${keys.keySecret}`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt, notes }),
  });
  if (!res.ok) throw new Error(`Razorpay order failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}
