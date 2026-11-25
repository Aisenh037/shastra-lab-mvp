// Drains the evaluation queue: retries due jobs and recovers jobs whose worker
// died. Called once a minute by pg_cron (only when there is work) and safe to
// call any time; jobs are claimed with SKIP LOCKED, so overlapping runs never
// process the same answer twice.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { serviceClient } from "../_shared/auth.ts";
import { LOCK_SECONDS, processJob, type JobOutcome, type JobRow } from "../_shared/evaluation-job.ts";

const BATCH = 4;
const CONCURRENCY = 2;
const TIME_BUDGET_MS = 100_000; // stay well inside the edge function wall-clock limit

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const admin = serviceClient();
  const secret = req.headers.get("x-worker-secret") ?? "";
  const { data: ok } = secret ? await admin.rpc("check_worker_secret", { p_secret: secret }) : { data: false };
  if (!ok) return reply({ error: "Unauthorized" }, 401);

  const started = Date.now();
  const counts: Record<JobOutcome, number> = { evaluated: 0, retry: 0, failed: 0, skipped: 0 };

  while (Date.now() - started < TIME_BUDGET_MS) {
    const { data, error } = await admin.rpc("claim_evaluation_jobs", { p_limit: BATCH, p_lock_seconds: LOCK_SECONDS, p_id: null });
    if (error) {
      console.error("claim failed", error.message);
      break;
    }
    const jobs = (data ?? []) as JobRow[];
    if (jobs.length === 0) break;

    for (let i = 0; i < jobs.length; i += CONCURRENCY) {
      const outcomes = await Promise.all(jobs.slice(i, i + CONCURRENCY).map((job) => processJob(admin, job)));
      for (const o of outcomes) counts[o]++;
    }
  }

  console.log(JSON.stringify({ event: "worker_run", ...counts, ms: Date.now() - started }));
  return reply({ ok: true, ...counts });
});
