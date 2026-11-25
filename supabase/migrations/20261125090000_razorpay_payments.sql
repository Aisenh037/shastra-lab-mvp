-- Razorpay Orders: credits land automatically after payment.
--
-- Flow: create-order (server picks price from credit_packs, creates a Razorpay
-- order tied to the user) -> Razorpay Checkout -> verify-payment (browser
-- returns the signed result) and razorpay-webhook (Razorpay calls us). Both
-- paths call fulfil_payment_order, which credits each order exactly once.

CREATE TABLE public.credit_packs (
  id TEXT PRIMARY KEY,
  credits INTEGER NOT NULL CHECK (credits > 0),
  price_paise INTEGER NOT NULL CHECK (price_paise >= 100),
  active BOOLEAN NOT NULL DEFAULT true,
  sort INTEGER NOT NULL DEFAULT 0
);
INSERT INTO public.credit_packs (id, credits, price_paise, sort) VALUES
  ('starter', 5, 9900, 1),
  ('standard', 10, 19900, 2),
  ('serious', 30, 49900, 3);

ALTER TABLE public.credit_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone sees active packs" ON public.credit_packs FOR SELECT TO anon, authenticated USING (active);

CREATE TABLE public.payment_orders (
  id TEXT PRIMARY KEY,                       -- Razorpay order id (order_...)
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL REFERENCES public.credit_packs(id),
  credits INTEGER NOT NULL CHECK (credits > 0),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed', 'refunded')),
  payment_id TEXT UNIQUE,
  paid_via TEXT CHECK (paid_via IN ('checkout', 'webhook')),
  refunded_credits INTEGER NOT NULL DEFAULT 0,
  refunded_paise INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);
CREATE INDEX payment_orders_user ON public.payment_orders (user_id, created_at DESC);

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own orders" ON public.payment_orders FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Every verified webhook, for audit and to skip redeliveries.
CREATE TABLE public.payment_events (
  event_id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  order_id TEXT,
  payment_id TEXT,
  outcome TEXT,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;  -- no policies: service role only

-- Credit a paid order once. Outcomes: paid | already_paid | unknown_order | amount_mismatch.
CREATE OR REPLACE FUNCTION public.fulfil_payment_order(p_order_id TEXT, p_payment_id TEXT, p_amount_paise INTEGER, p_via TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o payment_orders%ROWTYPE; bal INTEGER;
BEGIN
  SELECT * INTO o FROM payment_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'unknown_order'); END IF;
  IF o.status IN ('paid', 'refunded') THEN
    SELECT balance INTO bal FROM evaluation_credits WHERE user_id = o.user_id;
    RETURN jsonb_build_object('outcome', 'already_paid', 'balance', bal, 'user_id', o.user_id);
  END IF;
  IF p_amount_paise IS DISTINCT FROM o.amount_paise THEN
    RETURN jsonb_build_object('outcome', 'amount_mismatch', 'expected', o.amount_paise, 'got', p_amount_paise);
  END IF;

  UPDATE payment_orders SET status = 'paid', payment_id = p_payment_id, paid_via = p_via, paid_at = now() WHERE id = o.id;
  PERFORM ensure_credit_account(o.user_id);
  INSERT INTO credit_ledger (user_id, delta, reason, reference, note)
    VALUES (o.user_id, o.credits, 'purchase', p_payment_id, format('%s pack via %s (%s)', o.pack_id, p_via, o.id))
    ON CONFLICT (reference) WHERE reason = 'purchase' DO NOTHING;
  IF FOUND THEN
    UPDATE evaluation_credits SET balance = balance + o.credits, updated_at = now()
     WHERE user_id = o.user_id RETURNING balance INTO bal;
  ELSE
    SELECT balance INTO bal FROM evaluation_credits WHERE user_id = o.user_id;
  END IF;
  RETURN jsonb_build_object('outcome', 'paid', 'balance', bal, 'credits', o.credits, 'user_id', o.user_id);
END $$;

-- Payment failed at Razorpay: only an unpaid order changes.
CREATE OR REPLACE FUNCTION public.fail_payment_order(p_order_id TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE payment_orders SET status = 'failed' WHERE id = p_order_id AND status = 'created'
$$;

-- A refund was processed: take back the matching share of the pack's credits
-- (all of them for a full refund), never below zero. Idempotent per refund id.
-- Outcomes: refunded | duplicate | unknown_payment.
CREATE OR REPLACE FUNCTION public.refund_payment(p_payment_id TEXT, p_refund_id TEXT, p_amount_paise INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o payment_orders%ROWTYPE; take INTEGER; bal INTEGER; ref TEXT := 'refund:' || p_refund_id;
BEGIN
  SELECT * INTO o FROM payment_orders WHERE payment_id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'unknown_payment'); END IF;
  IF EXISTS (SELECT 1 FROM credit_ledger WHERE reason = 'adjustment' AND reference = ref) THEN
    RETURN jsonb_build_object('outcome', 'duplicate');
  END IF;

  take := LEAST(o.credits - o.refunded_credits,
                CASE WHEN p_amount_paise >= o.amount_paise THEN o.credits
                     ELSE floor(o.credits::numeric * p_amount_paise / o.amount_paise)::int END);
  take := GREATEST(take, 0);
  SELECT balance INTO bal FROM evaluation_credits WHERE user_id = o.user_id FOR UPDATE;
  take := LEAST(take, COALESCE(bal, 0));   -- already-used credits can't be taken back

  UPDATE evaluation_credits SET balance = balance - take, updated_at = now() WHERE user_id = o.user_id RETURNING balance INTO bal;
  INSERT INTO credit_ledger (user_id, delta, reason, reference, note)
    VALUES (o.user_id, -take, 'adjustment', ref, format('Razorpay refund of %s paise on %s', p_amount_paise, p_payment_id));
  UPDATE payment_orders SET refunded_credits = refunded_credits + take,
         refunded_paise = refunded_paise + p_amount_paise,
         status = CASE WHEN refunded_paise + p_amount_paise >= amount_paise THEN 'refunded' ELSE status END
   WHERE id = o.id;
  RETURN jsonb_build_object('outcome', 'refunded', 'credits_taken', take, 'balance', bal);
END $$;

REVOKE ALL ON FUNCTION public.fulfil_payment_order(TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_payment_order(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_payment(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfil_payment_order(TEXT, TEXT, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_payment_order(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_payment(TEXT, TEXT, INTEGER) TO service_role;
