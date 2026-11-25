-- Privacy (DPDP Act 2023 / DPDP Rules 2025): erasure that actually erases,
-- payment records kept for tax law, and a record of each user's consent.

-- 1. Deleting a user must delete their data. Five tables had a user_id with no
--    foreign key, so their rows would have been orphaned.
--    Seeded templates carry user ids from the old project; make them shared.
UPDATE public.mock_tests SET user_id = NULL
 WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM auth.users);
UPDATE public.practice_questions SET user_id = NULL
 WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM auth.users);
DELETE FROM public.answer_submissions WHERE user_id NOT IN (SELECT id FROM auth.users);
DELETE FROM public.daily_practice_streaks WHERE user_id NOT IN (SELECT id FROM auth.users);
DELETE FROM public.email_report_preferences WHERE user_id NOT IN (SELECT id FROM auth.users);

ALTER TABLE public.answer_submissions
  ADD CONSTRAINT answer_submissions_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.daily_practice_streaks
  ADD CONSTRAINT daily_practice_streaks_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.email_report_preferences
  ADD CONSTRAINT email_report_preferences_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.mock_tests
  ADD CONSTRAINT mock_tests_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.practice_questions
  ADD CONSTRAINT practice_questions_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Payment records outlive the account (tax/accounting law), detached from the person.
ALTER TABLE public.payment_orders ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.payment_orders DROP CONSTRAINT payment_orders_user_id_fkey;
ALTER TABLE public.payment_orders
  ADD CONSTRAINT payment_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- A payment that arrives after the account was deleted: record it, credit nobody.
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
  IF o.user_id IS NULL THEN
    UPDATE payment_orders SET status = 'paid', payment_id = p_payment_id, paid_via = p_via, paid_at = now() WHERE id = o.id;
    RETURN jsonb_build_object('outcome', 'user_deleted');
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

-- 3. Consent: which version of the Terms and Privacy Policy each user accepted, and when.
CREATE TABLE public.user_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  terms_version TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  age_confirmed BOOLEAN NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('signup', 'in_app')),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX user_consents_user ON public.user_consents (user_id, accepted_at DESC);
ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own consents" ON public.user_consents FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Email sign-up stores the accepted versions in user metadata (the user has no
-- session until they confirm); copy them into the record when the account is created.
CREATE OR REPLACE FUNCTION public.record_signup_consent() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.raw_user_meta_data ? 'terms_version' AND (NEW.raw_user_meta_data ->> 'age_confirmed')::boolean IS TRUE THEN
    INSERT INTO user_consents (user_id, terms_version, privacy_version, age_confirmed, source)
    VALUES (NEW.id, NEW.raw_user_meta_data ->> 'terms_version',
            COALESCE(NEW.raw_user_meta_data ->> 'privacy_version', NEW.raw_user_meta_data ->> 'terms_version'), true, 'signup');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created_consent AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.record_signup_consent();

-- Google sign-in, or a new policy version: the app asks, then records it here.
CREATE OR REPLACE FUNCTION public.record_consent(p_terms_version TEXT, p_privacy_version TEXT, p_age_confirmed BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in first'; END IF;
  IF p_age_confirmed IS NOT TRUE THEN RAISE EXCEPTION 'ShastraLab is for users aged 18 and over'; END IF;
  IF length(coalesce(p_terms_version, '')) NOT BETWEEN 1 AND 20 OR length(coalesce(p_privacy_version, '')) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'invalid version';
  END IF;
  INSERT INTO user_consents (user_id, terms_version, privacy_version, age_confirmed, source)
  VALUES (auth.uid(), p_terms_version, p_privacy_version, true, 'in_app');
END $$;
REVOKE ALL ON FUNCTION public.record_consent(TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_consent(TEXT, TEXT, BOOLEAN) TO authenticated;
REVOKE ALL ON FUNCTION public.record_signup_consent() FROM PUBLIC, anon, authenticated;

-- 4. Pro-rata refunds round to the nearest credit, matching the Refund Policy
--    (6 of 10 credits unused on ₹199 refunds ₹119 and takes back 6 credits, not 5).
CREATE OR REPLACE FUNCTION public.refund_payment(p_payment_id TEXT, p_refund_id TEXT, p_amount_paise INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o payment_orders%ROWTYPE; take INTEGER; bal INTEGER; ref TEXT := 'refund:' || p_refund_id;
BEGIN
  SELECT * INTO o FROM payment_orders WHERE payment_id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'unknown_payment'); END IF;
  IF EXISTS (SELECT 1 FROM credit_ledger WHERE reason = 'adjustment' AND reference = ref) THEN
    RETURN jsonb_build_object('outcome', 'duplicate');
  END IF;
  IF o.user_id IS NULL THEN
    UPDATE payment_orders SET refunded_paise = refunded_paise + p_amount_paise,
           status = CASE WHEN refunded_paise + p_amount_paise >= amount_paise THEN 'refunded' ELSE status END
     WHERE id = o.id;
    RETURN jsonb_build_object('outcome', 'refunded', 'credits_taken', 0);
  END IF;

  take := LEAST(o.credits - o.refunded_credits,
                CASE WHEN p_amount_paise >= o.amount_paise THEN o.credits
                     ELSE round(o.credits::numeric * p_amount_paise / o.amount_paise)::int END);
  take := GREATEST(take, 0);
  SELECT balance INTO bal FROM evaluation_credits WHERE user_id = o.user_id FOR UPDATE;
  take := LEAST(take, COALESCE(bal, 0));

  UPDATE evaluation_credits SET balance = balance - take, updated_at = now() WHERE user_id = o.user_id RETURNING balance INTO bal;
  INSERT INTO credit_ledger (user_id, delta, reason, reference, note)
    VALUES (o.user_id, -take, 'adjustment', ref, format('Razorpay refund of %s paise on %s', p_amount_paise, p_payment_id));
  UPDATE payment_orders SET refunded_credits = refunded_credits + take,
         refunded_paise = refunded_paise + p_amount_paise,
         status = CASE WHEN refunded_paise + p_amount_paise >= amount_paise THEN 'refunded' ELSE status END
   WHERE id = o.id;
  RETURN jsonb_build_object('outcome', 'refunded', 'credits_taken', take, 'balance', bal);
END $$;
REVOKE ALL ON FUNCTION public.refund_payment(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_payment(TEXT, TEXT, INTEGER) TO service_role;
