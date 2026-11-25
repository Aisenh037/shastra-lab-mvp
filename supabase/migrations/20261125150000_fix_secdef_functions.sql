-- P1 #2 — Fix SECURITY DEFINER functions that accept p_user_id
--
-- Three classes of change:
--
--  A. Functions that accepted an arbitrary p_user_id and operated on that
--     user's data are rewritten to derive the user from auth.uid() instead.
--     This prevents any authenticated caller from reading or mutating another
--     user's streak, achievements, or rank.
--
--  B. Functions that already derive the user from auth.uid() and have no other
--     privilege requirement are switched from SECURITY DEFINER to SECURITY
--     INVOKER.  They no longer need elevated privileges, so removing DEFINER
--     reduces the blast radius if a future bug is introduced.
--
--  C. has_role() is a service-side helper used only by other SECURITY DEFINER
--     functions and by edge functions via the service-role key.  Authenticated
--     users have no legitimate reason to call it directly, so we revoke EXECUTE
--     from the authenticated role.

-- ─────────────────────────────────────────────────────────────────────────────
-- A1. get_user_streak  — no longer accepts p_user_id
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_user_streak()
  RETURNS TABLE(
    current_streak     integer,
    longest_streak     integer,
    last_practice_date date,
    practiced_today    boolean,
    freeze_count       integer,
    streak_at_risk     boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY INVOKER
  SET search_path = 'public'
AS $$
DECLARE
  v_uid      UUID   := auth.uid();
  v_yesterday DATE  := CURRENT_DATE - INTERVAL '1 day';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sign in first'; END IF;

  RETURN QUERY
  SELECT
    COALESCE(ds.current_streak, 0),
    COALESCE(ds.longest_streak, 0),
    ds.last_practice_date,
    COALESCE(ds.last_practice_date = CURRENT_DATE, FALSE),
    COALESCE(ds.freeze_count, 0),
    COALESCE(ds.last_practice_date < v_yesterday AND ds.last_practice_date IS NOT NULL, FALSE)
  FROM daily_practice_streaks ds
  WHERE ds.user_id = v_uid;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0, NULL::DATE, FALSE, 0, FALSE;
  END IF;
END;
$$;

-- Drop the old p_user_id variant so the old signature no longer exists
DROP FUNCTION IF EXISTS public.get_user_streak(uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- A2. update_practice_streak  — no longer accepts p_user_id
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_practice_streak()
  RETURNS TABLE(
    current_streak  integer,
    longest_streak  integer,
    streak_extended boolean
  )
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = 'public'
AS $$
DECLARE
  v_uid            UUID := auth.uid();
  v_current_streak INTEGER;
  v_longest_streak INTEGER;
  v_last_practice  DATE;
  v_today          DATE := CURRENT_DATE;
  v_streak_extended BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sign in first'; END IF;

  SELECT ds.current_streak, ds.longest_streak, ds.last_practice_date
  INTO v_current_streak, v_longest_streak, v_last_practice
  FROM daily_practice_streaks ds
  WHERE ds.user_id = v_uid;

  IF NOT FOUND THEN
    INSERT INTO daily_practice_streaks (user_id, current_streak, longest_streak, last_practice_date)
    VALUES (v_uid, 1, 1, v_today);
    RETURN QUERY SELECT 1, 1, TRUE;
    RETURN;
  END IF;

  IF v_last_practice = v_today THEN
    RETURN QUERY SELECT v_current_streak, v_longest_streak, FALSE;
    RETURN;
  END IF;

  IF v_last_practice = v_today - INTERVAL '1 day' THEN
    v_current_streak  := v_current_streak + 1;
    v_streak_extended := TRUE;
    IF v_current_streak > v_longest_streak THEN
      v_longest_streak := v_current_streak;
    END IF;
  ELSE
    v_current_streak  := 1;
    v_streak_extended := TRUE;
  END IF;

  UPDATE daily_practice_streaks
  SET current_streak     = v_current_streak,
      longest_streak     = v_longest_streak,
      last_practice_date = v_today
  WHERE user_id = v_uid;

  RETURN QUERY SELECT v_current_streak, v_longest_streak, v_streak_extended;
END;
$$;

DROP FUNCTION IF EXISTS public.update_practice_streak(uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- A3. recover_streak  — no longer accepts p_user_id
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recover_streak(p_days_to_recover integer DEFAULT 1)
  RETURNS TABLE(
    success          boolean,
    new_streak       integer,
    freezes_used     integer,
    freezes_remaining integer,
    message          text
  )
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = 'public'
AS $$
DECLARE
  v_uid            UUID := auth.uid();
  v_freeze_count   INTEGER;
  v_last_practice  DATE;
  v_current_streak INTEGER;
  v_longest_streak INTEGER;
  v_days_missed    INTEGER;
  v_freezes_needed INTEGER;
  v_today          DATE := CURRENT_DATE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sign in first'; END IF;

  SELECT ds.freeze_count, ds.last_practice_date, ds.current_streak, ds.longest_streak
  INTO v_freeze_count, v_last_practice, v_current_streak, v_longest_streak
  FROM daily_practice_streaks ds
  WHERE ds.user_id = v_uid;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0, 'No streak history found'::text;
    RETURN;
  END IF;

  v_days_missed := v_today - v_last_practice - 1;

  IF v_days_missed <= 0 THEN
    RETURN QUERY SELECT FALSE, v_current_streak, 0, v_freeze_count,
      'Streak is not lost - no recovery needed'::text;
    RETURN;
  END IF;

  v_freezes_needed := LEAST(p_days_to_recover, v_days_missed) * 2;

  IF v_freeze_count < v_freezes_needed THEN
    RETURN QUERY SELECT FALSE, 0, 0, v_freeze_count,
      format('Not enough freezes. Need %s freezes to recover %s day(s), but only have %s',
        v_freezes_needed, LEAST(p_days_to_recover, v_days_missed), v_freeze_count)::text;
    RETURN;
  END IF;

  UPDATE daily_practice_streaks
  SET freeze_count       = freeze_count - v_freezes_needed,
      current_streak     = v_current_streak,
      last_practice_date = v_today - INTERVAL '1 day',
      updated_at         = now()
  WHERE user_id = v_uid;

  RETURN QUERY SELECT
    TRUE,
    v_current_streak,
    v_freezes_needed,
    v_freeze_count - v_freezes_needed,
    format('Successfully recovered streak! Used %s freezes.', v_freezes_needed)::text;
END;
$$;

DROP FUNCTION IF EXISTS public.recover_streak(uuid, integer);

-- ─────────────────────────────────────────────────────────────────────────────
-- A4. check_achievements  — no longer accepts p_user_id
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_achievements()
  RETURNS TABLE(achievement_key text, newly_unlocked boolean)
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = 'public'
AS $$
DECLARE
  v_uid             UUID := auth.uid();
  v_tests_completed integer;
  v_high_scores     integer;
  v_user_rank       bigint;
  v_current_streak  integer;
  v_longest_streak  integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sign in first'; END IF;

  SELECT
    COUNT(DISTINCT id),
    COUNT(DISTINCT CASE WHEN max_score > 0 AND (score::numeric / max_score) >= 0.9 THEN id END)
  INTO v_tests_completed, v_high_scores
  FROM answer_submissions
  WHERE user_id = v_uid AND status = 'evaluated';

  SELECT rank INTO v_user_rank
  FROM (
    SELECT
      a.user_id,
      RANK() OVER (ORDER BY SUM(a.score) / NULLIF(SUM(a.max_score), 0) DESC) AS rank
    FROM answer_submissions a
    WHERE a.status = 'evaluated'
    GROUP BY a.user_id
  ) ranked
  WHERE ranked.user_id = v_uid;

  SELECT ds.current_streak, ds.longest_streak
  INTO v_current_streak, v_longest_streak
  FROM daily_practice_streaks ds
  WHERE ds.user_id = v_uid;

  v_current_streak := COALESCE(v_current_streak, 0);
  v_longest_streak := COALESCE(v_longest_streak, 0);

  IF v_tests_completed >= 1  THEN INSERT INTO achievements (user_id, achievement_key) VALUES (v_uid, 'first_test')             ON CONFLICT (user_id, achievement_key) DO NOTHING; END IF;
  IF v_tests_completed >= 10 THEN INSERT INTO achievements (user_id, achievement_key) VALUES (v_uid, 'test_veteran')           ON CONFLICT (user_id, achievement_key) DO NOTHING; END IF;
  IF v_tests_completed >= 25 THEN INSERT INTO achievements (user_id, achievement_key) VALUES (v_uid, 'test_master')            ON CONFLICT (user_id, achievement_key) DO NOTHING; END IF;
  IF v_high_scores >= 1      THEN INSERT INTO achievements (user_id, achievement_key) VALUES (v_uid, 'high_scorer')            ON CONFLICT (user_id, achievement_key) DO NOTHING; END IF;
  IF v_high_scores >= 5      THEN INSERT INTO achievements (user_id, achievement_key) VALUES (v_uid, 'consistent_excellence')  ON CONFLICT (user_id, achievement_key) DO NOTHING; END IF;
  IF v_high_scores >= 10     THEN INSERT INTO achievements (user_id, achievement_key) VALUES (v_uid, 'perfectionist')          ON CONFLICT (user_id, achievement_key) DO NOTHING; END IF;
  IF v_user_rank IS NOT NULL AND v_user_rank <= 10 THEN INSERT INTO achievements (user_id, achievement_key) VALUES (v_uid, 'top_10')    ON CONFLICT (user_id, achievement_key) DO NOTHING; END IF;
  IF v_user_rank IS NOT NULL AND v_user_rank <= 3  THEN INSERT INTO achievements (user_id, achievement_key) VALUES (v_uid, 'top_3')     ON CONFLICT (user_id, achievement_key) DO NOTHING; END IF;
  IF v_user_rank IS NOT NULL AND v_user_rank = 1   THEN INSERT INTO achievements (user_id, achievement_key) VALUES (v_uid, 'champion')  ON CONFLICT (user_id, achievement_key) DO NOTHING; END IF;
  IF v_longest_streak >= 7   THEN INSERT INTO achievements (user_id, achievement_key) VALUES (v_uid, 'week_warrior')           ON CONFLICT (user_id, achievement_key) DO NOTHING; END IF;
  IF v_longest_streak >= 14  THEN INSERT INTO achievements (user_id, achievement_key) VALUES (v_uid, 'fortnight_fighter')      ON CONFLICT (user_id, achievement_key) DO NOTHING; END IF;
  IF v_longest_streak >= 30  THEN INSERT INTO achievements (user_id, achievement_key) VALUES (v_uid, 'monthly_master')         ON CONFLICT (user_id, achievement_key) DO NOTHING; END IF;

  RETURN QUERY
  SELECT a.achievement_key, FALSE AS newly_unlocked
  FROM achievements a
  WHERE a.user_id = v_uid;
END;
$$;

DROP FUNCTION IF EXISTS public.check_achievements(uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- A5. get_user_achievements  — no longer accepts p_user_id
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_user_achievements()
  RETURNS TABLE(achievement_key text, unlocked_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = 'public'
AS $$
  SELECT achievement_key, unlocked_at
  FROM achievements
  WHERE user_id = auth.uid()
  ORDER BY unlocked_at DESC;
$$;

DROP FUNCTION IF EXISTS public.get_user_achievements(uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- A6. get_user_rank  — no longer accepts p_user_id
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_user_rank()
  RETURNS TABLE(rank bigint, total_users bigint)
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = 'public'
AS $$
  WITH user_scores AS (
    SELECT
      user_id,
      CASE
        WHEN SUM(max_score) > 0 THEN (SUM(score) / SUM(max_score))
        ELSE 0
      END AS percentage
    FROM answer_submissions
    WHERE status = 'evaluated'
    GROUP BY user_id
  ),
  ranked AS (
    SELECT user_id, RANK() OVER (ORDER BY percentage DESC) AS rank
    FROM user_scores
  )
  SELECT
    COALESCE((SELECT rank FROM ranked WHERE user_id = auth.uid()), 0) AS rank,
    (SELECT COUNT(DISTINCT user_id) FROM user_scores)                 AS total_users;
$$;

DROP FUNCTION IF EXISTS public.get_user_rank(uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Switch safe no-param functions from SECURITY DEFINER → SECURITY INVOKER
-- ─────────────────────────────────────────────────────────────────────────────

-- get_leaderboard is a public leaderboard; every authenticated user may read it.
-- It previously used SECURITY DEFINER only to bypass RLS on profiles.
-- Since profiles already has an anon-readable policy, INVOKER is enough.
CREATE OR REPLACE FUNCTION public.get_leaderboard()
  RETURNS TABLE(
    user_id          uuid,
    display_name     text,
    total_score      numeric,
    total_max_score  integer,
    percentage       numeric,
    tests_completed  integer,
    rank             bigint
  )
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = 'public'
AS $$
  SELECT
    p.id AS user_id,
    COALESCE(p.full_name, split_part(p.email, '@', 1)) AS display_name,
    COALESCE(SUM(a.score), 0)                          AS total_score,
    COALESCE(SUM(a.max_score), 0)::integer             AS total_max_score,
    CASE
      WHEN COALESCE(SUM(a.max_score), 0) > 0
      THEN ROUND((COALESCE(SUM(a.score), 0) / SUM(a.max_score)) * 100, 1)
      ELSE 0
    END                                                AS percentage,
    COUNT(DISTINCT a.id)::integer                      AS tests_completed,
    RANK() OVER (
      ORDER BY
        CASE
          WHEN COALESCE(SUM(a.max_score), 0) > 0
          THEN (COALESCE(SUM(a.score), 0) / SUM(a.max_score))
          ELSE 0
        END DESC
    )                                                  AS rank
  FROM profiles p
  LEFT JOIN answer_submissions a ON a.user_id = p.id AND a.status = 'evaluated'
  GROUP BY p.id, p.full_name, p.email
  HAVING COUNT(a.id) > 0
  ORDER BY percentage DESC
  LIMIT 100;
$$;

-- my_credit_balance already uses auth.uid() — INVOKER is safe.
CREATE OR REPLACE FUNCTION public.my_credit_balance()
  RETURNS integer
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = 'public'
AS $$
  SELECT COALESCE((SELECT balance FROM evaluation_credits WHERE user_id = auth.uid()), free_trial_credits())
$$;

-- record_consent already uses auth.uid() — INVOKER is safe.
CREATE OR REPLACE FUNCTION public.record_consent(
  p_terms_version   text,
  p_privacy_version text,
  p_age_confirmed   boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in first'; END IF;
  IF p_age_confirmed IS NOT TRUE THEN RAISE EXCEPTION 'ShastraLab is for users aged 18 and over'; END IF;
  IF length(coalesce(p_terms_version, '')) NOT BETWEEN 1 AND 20
  OR length(coalesce(p_privacy_version,'')) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'invalid version';
  END IF;
  INSERT INTO user_consents (user_id, terms_version, privacy_version, age_confirmed, source)
  VALUES (auth.uid(), p_terms_version, p_privacy_version, TRUE, 'in_app');
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. has_role — revoke EXECUTE from authenticated role
--    It is a utility for other SECURITY DEFINER functions and edge functions
--    (service role).  Regular users have no business calling it directly.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. payment_events — add a permissive read policy for the owner
--    The table has RLS enabled but zero policies (flagged by the advisor).
--    Writes only ever come from edge functions via service_role; users may
--    read their own rows for debugging / receipts.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY "users can view own payment events"
  ON payment_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM payment_orders po
      WHERE po.id = payment_events.order_id
        AND po.user_id = auth.uid()
    )
  );
