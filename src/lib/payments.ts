// Buy a credit pack with Razorpay Checkout (UPI, cards, netbanking).
//
// create-order (server sets the price) -> Checkout popup -> verify-payment.
// If verify-payment never runs (tab closed, network drop), the Razorpay
// webhook credits the order anyway.
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

export interface Pack {
  id: string;
  credits: number;
  pricePaise: number;
}

export type PaymentErrorCode =
  | "PAYMENTS_NOT_CONFIGURED"
  | "TOO_MANY_ORDERS"
  | "CANCELLED"
  | "FAILED"
  | "PENDING"
  | "UNKNOWN";

export class PaymentError extends Error {
  constructor(
    message: string,
    public code: PaymentErrorCode,
  ) {
    super(message);
  }
}

export interface PurchaseResult {
  creditsRemaining: number | null;
  creditsAdded: number | null;
}

export async function loadPacks(): Promise<Pack[]> {
  const { data, error } = await supabase.from("credit_packs").select("id, credits, price_paise").eq("active", true).order("sort");
  if (error || !data) return [];
  return data.map((p) => ({ id: p.id, credits: p.credits, pricePaise: p.price_paise }));
}

async function errorFrom(error: unknown): Promise<PaymentError> {
  if (error instanceof FunctionsHttpError) {
    let body: { error?: string; code?: string } = {};
    try {
      body = await (error.context as Response).clone().json();
    } catch {
      /* not JSON */
    }
    const code = (["PAYMENTS_NOT_CONFIGURED", "TOO_MANY_ORDERS", "PENDING"].includes(body.code ?? "") ? body.code : "FAILED") as PaymentErrorCode;
    return new PaymentError(body.error ?? "Payment failed. You were not charged twice; try again.", code);
  }
  return new PaymentError("Payment failed. Check your connection and try again.", "UNKNOWN");
}

// deno-lint-ignore no-explicit-any
type RazorpayCtor = new (opts: any) => { open(): void; on(event: string, cb: (r: any) => void): void };

let scriptPromise: Promise<RazorpayCtor> | null = null;
function loadCheckout(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = CHECKOUT_SRC;
    s.async = true;
    s.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error("Razorpay did not load")));
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Could not load Razorpay"));
    };
    document.body.appendChild(s);
  });
  return scriptPromise;
}

export async function buyPack(packId: string): Promise<PurchaseResult> {
  const created = await supabase.functions.invoke("create-order", { body: { packId } });
  if (created.error) throw await errorFrom(created.error);
  const order = created.data as { orderId: string; amount: number; currency: string; keyId: string; credits: number; email: string | null };

  let Razorpay: RazorpayCtor;
  try {
    Razorpay = await loadCheckout();
  } catch {
    throw new PaymentError("Couldn't open the payment window. Check your connection or ad blocker.", "UNKNOWN");
  }

  const paid = await new Promise<{ razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }>(
    (resolve, reject) => {
      const rzp = new Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: "ShastraLab",
        description: `${order.credits} answer evaluations`,
        prefill: order.email ? { email: order.email } : undefined,
        theme: { color: "#4f46e5" },
        handler: resolve,
        modal: { ondismiss: () => reject(new PaymentError("Payment cancelled.", "CANCELLED")) },
      });
      rzp.on("payment.failed", (r) =>
        reject(new PaymentError(r?.error?.description ?? "Payment failed. You weren't charged.", "FAILED")),
      );
      rzp.open();
    },
  );

  const verified = await supabase.functions.invoke("verify-payment", {
    body: { orderId: paid.razorpay_order_id, paymentId: paid.razorpay_payment_id, signature: paid.razorpay_signature },
  });
  if (verified.error) {
    const e = await errorFrom(verified.error);
    // Money moved; the webhook will credit it. Don't tell the user it failed.
    throw new PaymentError("Payment received. Your evaluations will appear within a minute.", e.code === "FAILED" ? "PENDING" : e.code);
  }
  if (verified.data?.code === "PENDING") {
    throw new PaymentError("Payment received. Your evaluations will appear within a minute.", "PENDING");
  }
  return { creditsRemaining: verified.data?.creditsRemaining ?? null, creditsAdded: verified.data?.creditsAdded ?? null };
}
