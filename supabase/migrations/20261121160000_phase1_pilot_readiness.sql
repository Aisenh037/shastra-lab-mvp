-- Phase 1: pilot readiness
--   1. Per-question rubrics (reviewed by mentors, read-only for users)
--   2. Evaluation credits with an append-only ledger
--   3. Scores are written only by the evaluate-answer function (service role)
--   4. Answer photos are private

-- ---------------------------------------------------------------------------
-- 1. Rubrics
-- ---------------------------------------------------------------------------
CREATE TABLE public.question_rubrics (
  question_id UUID PRIMARY KEY REFERENCES public.practice_questions(id) ON DELETE CASCADE,
  rubric JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed')),
  reviewed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.question_rubrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reviewed rubrics are readable by signed-in users" ON public.question_rubrics
  FOR SELECT TO authenticated
  USING (status = 'reviewed' OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage rubrics" ON public.question_rubrics
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- 2. Credits
-- ---------------------------------------------------------------------------
CREATE TABLE public.evaluation_credits (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('free_trial', 'purchase', 'evaluation', 'refund', 'adjustment')),
  reference TEXT,
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One grant per payment reference: re-running a grant for the same Razorpay
-- payment id is a no-op instead of a double credit.
CREATE UNIQUE INDEX credit_ledger_purchase_ref ON public.credit_ledger (reference) WHERE reason = 'purchase';
CREATE INDEX credit_ledger_user ON public.credit_ledger (user_id, created_at DESC);

ALTER TABLE public.evaluation_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;

-- Read-only for the owner; all writes go through the functions below.
CREATE POLICY "Users see own credits" ON public.evaluation_credits FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users see own ledger" ON public.credit_ledger FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Free evaluations every new account gets.
CREATE OR REPLACE FUNCTION public.free_trial_credits() RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$ SELECT 1 $$;

CREATE OR REPLACE FUNCTION public.ensure_credit_account(p_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO evaluation_credits (user_id, balance) VALUES (p_user, free_trial_credits())
  ON CONFLICT (user_id) DO NOTHING;
  IF FOUND THEN
    INSERT INTO credit_ledger (user_id, delta, reason, note) VALUES (p_user, free_trial_credits(), 'free_trial', 'first evaluation free');
  END IF;
END $$;

-- Atomically take one credit. Returns the remaining balance, or -1 if none left.
CREATE OR REPLACE FUNCTION public.consume_evaluation_credit(p_user UUID, p_reference TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE remaining INTEGER;
BEGIN
  PERFORM ensure_credit_account(p_user);
  UPDATE evaluation_credits SET balance = balance - 1, updated_at = now()
    WHERE user_id = p_user AND balance > 0
    RETURNING balance INTO remaining;
  IF remaining IS NULL THEN RETURN -1; END IF;
  INSERT INTO credit_ledger (user_id, delta, reason, reference) VALUES (p_user, -1, 'evaluation', p_reference);
  RETURN remaining;
END $$;

-- Give the credit back when an evaluation fails after it was charged.
CREATE OR REPLACE FUNCTION public.refund_evaluation_credit(p_user UUID, p_reference TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE remaining INTEGER;
BEGIN
  UPDATE evaluation_credits SET balance = balance + 1, updated_at = now()
    WHERE user_id = p_user RETURNING balance INTO remaining;
  INSERT INTO credit_ledger (user_id, delta, reason, reference) VALUES (p_user, 1, 'refund', p_reference);
  RETURN remaining;
END $$;

REVOKE ALL ON FUNCTION public.ensure_credit_account(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_evaluation_credit(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_evaluation_credit(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_credit_account(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_evaluation_credit(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_evaluation_credit(UUID, TEXT) TO service_role;

-- Current user's balance (counts the free trial before the account row exists).
CREATE OR REPLACE FUNCTION public.my_credit_balance()
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT balance FROM evaluation_credits WHERE user_id = auth.uid()), free_trial_credits())
$$;
REVOKE ALL ON FUNCTION public.my_credit_balance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_credit_balance() TO authenticated;

-- Admin: add credits after a Razorpay payment. Idempotent per payment id.
--   select grant_credits('aspirant@example.com', 10, 'pay_ABC123', '₹199 pack');
CREATE OR REPLACE FUNCTION public.grant_credits(p_email TEXT, p_amount INTEGER, p_payment_id TEXT, p_note TEXT DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target UUID; remaining INTEGER;
BEGIN
  -- auth.uid() is NULL in the SQL editor (runs as postgres); otherwise the caller must be an admin.
  IF auth.uid() IS NOT NULL AND NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'only admins can grant credits';
  END IF;
  IF p_amount <= 0 OR p_amount > 500 THEN RAISE EXCEPTION 'amount must be 1-500'; END IF;
  IF COALESCE(trim(p_payment_id), '') = '' THEN RAISE EXCEPTION 'payment id is required'; END IF;

  SELECT id INTO target FROM auth.users WHERE lower(email) = lower(trim(p_email));
  IF target IS NULL THEN RAISE EXCEPTION 'no user with email %', p_email; END IF;

  PERFORM ensure_credit_account(target);
  INSERT INTO credit_ledger (user_id, delta, reason, reference, note, created_by)
    VALUES (target, p_amount, 'purchase', trim(p_payment_id), p_note, auth.uid())
    ON CONFLICT (reference) WHERE reason = 'purchase' DO NOTHING;
  IF NOT FOUND THEN
    RAISE NOTICE 'payment % already granted; nothing changed', p_payment_id;
    SELECT balance INTO remaining FROM evaluation_credits WHERE user_id = target;
    RETURN remaining;
  END IF;
  UPDATE evaluation_credits SET balance = balance + p_amount, updated_at = now()
    WHERE user_id = target RETURNING balance INTO remaining;
  RETURN remaining;
END $$;
REVOKE ALL ON FUNCTION public.grant_credits(TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_credits(TEXT, INTEGER, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Submissions: engine output, and no client-side score writes
-- ---------------------------------------------------------------------------
ALTER TABLE public.answer_submissions
  ADD COLUMN IF NOT EXISTS score_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS engine_version TEXT,
  ADD COLUMN IF NOT EXISTS answer_image_paths TEXT[];

-- Users could previously insert or edit their own scores (and the leaderboard reads them).
DROP POLICY IF EXISTS "Users can create own submissions" ON public.answer_submissions;
DROP POLICY IF EXISTS "Users can update own submissions" ON public.answer_submissions;

CREATE INDEX IF NOT EXISTS answer_submissions_user_recent ON public.answer_submissions (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 4. Answer photos are private (served through signed URLs)
-- ---------------------------------------------------------------------------
UPDATE storage.buckets SET public = false WHERE id = 'answer-uploads';
