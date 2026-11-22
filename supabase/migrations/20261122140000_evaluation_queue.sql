-- Evaluation queue
--
-- answer_submissions doubles as the job table:
--   queued -> processing -> evaluated
--                       \-> queued again (retry with backoff) -> ... -> failed (credit refunded)
-- Workers claim jobs with FOR UPDATE SKIP LOCKED, so any number can run at once
-- without double-processing. A job whose worker died is reclaimed once its lock expires.

ALTER TABLE public.answer_submissions
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS job_payload JSONB;

-- Workers only look at unfinished jobs.
CREATE INDEX IF NOT EXISTS answer_submissions_pending
  ON public.answer_submissions (created_at)
  WHERE status IN ('queued', 'processing');

-- Claim up to p_limit runnable jobs (or one specific job) and lock them for p_lock_seconds.
CREATE OR REPLACE FUNCTION public.claim_evaluation_jobs(p_limit INTEGER DEFAULT 5, p_lock_seconds INTEGER DEFAULT 180, p_id UUID DEFAULT NULL)
RETURNS SETOF public.answer_submissions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE answer_submissions s
     SET status = 'processing',
         attempts = s.attempts + 1,
         locked_until = now() + make_interval(secs => p_lock_seconds)
   WHERE s.id IN (
     SELECT j.id FROM answer_submissions j
      WHERE (p_id IS NULL OR j.id = p_id)
        AND (
          (j.status = 'queued' AND COALESCE(j.next_attempt_at, now()) <= now())
          OR (j.status = 'processing' AND j.locked_until < now())
        )
      ORDER BY j.created_at
      LIMIT GREATEST(1, LEAST(p_limit, 50))
      FOR UPDATE SKIP LOCKED
   )
  RETURNING s.*;
END $$;

REVOKE ALL ON FUNCTION public.claim_evaluation_jobs(INTEGER, INTEGER, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_evaluation_jobs(INTEGER, INTEGER, UUID) TO service_role;

-- Queue health at a glance (admins / SQL editor).
CREATE OR REPLACE VIEW public.evaluation_queue_stats WITH (security_invoker = true) AS
SELECT status,
       count(*) AS jobs,
       min(created_at) AS oldest,
       max(attempts) AS max_attempts
  FROM public.answer_submissions
 WHERE status IN ('queued', 'processing', 'failed')
 GROUP BY status;
REVOKE ALL ON public.evaluation_queue_stats FROM anon, authenticated;

-- The browser listens for its own row to change (RLS limits it to the owner's rows).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'answer_submissions'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.answer_submissions;
  END IF;
END $$;
