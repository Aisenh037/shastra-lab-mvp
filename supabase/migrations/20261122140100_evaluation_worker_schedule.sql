-- Safety net for the evaluation queue: once a minute, if any job is runnable
-- (new, due for retry, or abandoned by a crashed worker), call the
-- evaluation-worker edge function.
--
-- Normally a job is processed straight away by the submit function; this only
-- catches retries and failures. It needs three Vault secrets, created per
-- environment (not stored in git):
--   project_url                 https://<project-ref>.supabase.co
--   anon_key                    the project's anon key (public)
--   evaluation_worker_secret    random string; the worker checks it

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- The worker asks the database whether the secret it was sent is right.
CREATE OR REPLACE FUNCTION public.check_worker_secret(p_secret TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
     WHERE name = 'evaluation_worker_secret' AND decrypted_secret = p_secret
  )
$$;
REVOKE ALL ON FUNCTION public.check_worker_secret(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_worker_secret(TEXT) TO service_role;

-- The secret is generated here, so it never appears in git or in a chat.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'evaluation_worker_secret') THEN
    PERFORM vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'evaluation_worker_secret');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.kick_evaluation_worker()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_url TEXT; v_anon TEXT; v_secret TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM answer_submissions
     WHERE (status = 'queued' AND COALESCE(next_attempt_at, now()) <= now())
        OR (status = 'processing' AND locked_until < now())
  ) THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url';
  SELECT decrypted_secret INTO v_anon FROM vault.decrypted_secrets WHERE name = 'anon_key';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'evaluation_worker_secret';
  IF v_url IS NULL OR v_anon IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'evaluation worker not configured: add project_url and anon_key to Vault';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/evaluation-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon,
      'x-worker-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
END $$;
REVOKE ALL ON FUNCTION public.kick_evaluation_worker() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'evaluation-worker';
SELECT cron.schedule('evaluation-worker', '* * * * *', 'SELECT public.kick_evaluation_worker()');
