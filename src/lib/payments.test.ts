import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
import { buyPack, PaymentError } from "./payments";

// deno-lint-ignore no-explicit-any
let opts: any;
let failHandler: ((r: unknown) => void) | null = null;
class FakeRazorpay {
  // deno-lint-ignore no-explicit-any
  constructor(o: any) {
    opts = o;
  }
  on(_e: string, cb: (r: unknown) => void) {
    failHandler = cb;
  }
  open() {}
}

const order = { orderId: "order_1", amount: 19900, currency: "INR", keyId: "rzp_test", credits: 10, email: "a@x.in" };

beforeEach(() => {
  invoke.mockReset();
  opts = null;
  failHandler = null;
  (window as unknown as { Razorpay: unknown }).Razorpay = FakeRazorpay;
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("buyPack", () => {
  it("opens Checkout with the server's order and verifies the result", async () => {
    invoke
      .mockResolvedValueOnce({ data: order, error: null })
      .mockResolvedValueOnce({ data: { status: "paid", creditsRemaining: 11, creditsAdded: 10 }, error: null });
    const p = buyPack("standard");
    await tick();
    expect(opts).toMatchObject({ key: "rzp_test", order_id: "order_1", amount: 19900, prefill: { email: "a@x.in" } });
    opts.handler({ razorpay_order_id: "order_1", razorpay_payment_id: "pay_1", razorpay_signature: "sig" });
    await expect(p).resolves.toEqual({ creditsRemaining: 11, creditsAdded: 10 });
    expect(invoke.mock.calls[1]).toEqual(["verify-payment", { body: { orderId: "order_1", paymentId: "pay_1", signature: "sig" } }]);
  });

  it("closing the window is a cancel, not an error", async () => {
    invoke.mockResolvedValueOnce({ data: order, error: null });
    const p = buyPack("standard");
    await tick();
    opts.modal.ondismiss();
    await expect(p).rejects.toMatchObject({ code: "CANCELLED" });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("a failed payment shows Razorpay's reason", async () => {
    invoke.mockResolvedValueOnce({ data: order, error: null });
    const p = buyPack("standard");
    await tick();
    failHandler!({ error: { description: "Card declined" } });
    await expect(p).rejects.toEqual(new PaymentError("Card declined", "FAILED"));
  });

  it("if verification can't confirm, says payment received (webhook will credit)", async () => {
    invoke
      .mockResolvedValueOnce({ data: order, error: null })
      .mockResolvedValueOnce({ data: { code: "PENDING" }, error: null });
    const p = buyPack("standard");
    await tick();
    opts.handler({ razorpay_order_id: "order_1", razorpay_payment_id: "pay_1", razorpay_signature: "sig" });
    await expect(p).rejects.toMatchObject({ code: "PENDING" });
  });
});
