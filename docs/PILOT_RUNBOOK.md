# Pilot runbook (phase 1)

What changed, how to switch it on, and the daily operations for the 30-day paid pilot.

## What changed

| Area | Before | Now |
|---|---|---|
| Scoring | One prompt; the model picked the score | The model reports evidence; code verifies quotes and computes marks (`supabase/functions/_shared/scoring.ts`) |
| Rubrics | Same generic 40/25/20/15 split for every question | Per-question rubric (`question_rubrics` table), falling back to key points |
| Non-answers | Charged and scored | Rejected free of charge (fewer than 30 words, gibberish, repetition) |
| Who writes scores | The browser (anyone could insert any score) | Only the `evaluate-answer` function, with the service role |
| Edge functions | `verify_jwt = false`, no auth check: anyone could run up the Azure bill | Signed-in users only |
| Progress-report email | Anyone could send any user's report to any address | Own report, own address only (or a service-role scheduled job) |
| Answer photos | Public bucket | Private bucket |
| Credits | None | 1 free evaluation, then packs via Razorpay payment links |
| Recurring weaknesses | None | "Your recurring gaps" on the dashboard after 3 answers |
| Video, audio, leaderboard, streak freeze | On | Off (turn back on with `VITE_FEATURE_*=true`) |

## Where it runs

- **Supabase project:** `shastralab` (`xcrlxcyicagthchxasgx`, Mumbai, ap-south-1), in KC's own Supabase account. It replaces the Lovable Cloud project `twvbntdtnpawhfpygvyn`; users and data from there were not migrated.
- **AI:** every function calls Azure OpenAI (`_shared/azure.ts`). Nothing depends on Lovable's AI gateway any more.

## Switch it on

1. **Apply the migration** `supabase/migrations/20261121160000_phase1_pilot_readiness.sql` (`supabase db push`, or let Lovable apply it on sync, then confirm in the dashboard that `question_rubrics`, `evaluation_credits` and `credit_ledger` exist).
2. **Deploy all edge functions.** `config.toml` now has `verify_jwt = true` for every function. Optional secret: `AZURE_OPENAI_DEPLOYMENT` (default `gpt-5.2-chat`).
3. **Make yourself an admin:** `insert into user_roles (user_id, role) select id, 'admin' from auth.users where email = 'you@example.com';`
4. **Create the payment links** in Razorpay (₹99 / ₹199 / ₹499) and set `VITE_PAYMENT_LINK_5`, `VITE_PAYMENT_LINK_10` and `VITE_PAYMENT_LINK_30` in the frontend env (see `.env.example`). Packs without a link are hidden.
5. **Load rubrics** (see `rubrics/README.md`). The three in the repo are drafts; nothing uses them until a mentor marks them reviewed.

Old submissions keep working. Photos uploaded before the change were saved as public URLs; they stop loading once the bucket is private, which is intended.

## Daily: grant credits after a payment

Razorpay → Payments → copy the payment id and the email the buyer entered. In the SQL editor:

```sql
select grant_credits('aspirant@example.com', 10, 'pay_XXXXXXXX', '₹199 pack');
```

Re-running with the same payment id does nothing, so a double paste can't double-credit. Check a user's history with `select * from credit_ledger where user_id = (select id from auth.users where email = '...') order by created_at desc;`

## Calibration (before launch, then weekly)

1. Collect 100 real answers: `answers.csv` with `item_id,question_id,answer_text`.
2. Have 2-3 mains-qualified evaluators score each one independently: `human.csv` with `item_id,rater,score,max_marks`.
3. Score them with the evaluator (admin token, no credits used, nothing saved):
   ```bash
   SUPABASE_URL=... SUPABASE_ANON_KEY=... ADMIN_ACCESS_TOKEN=<admin JWT> \
     npm run calibrate -- run --answers answers.csv --out ai.csv
   npm run calibrate -- report --human human.csv --ai ai.csv --json report.json
   ```
4. Target: **at least 70% within ±1.5 marks on 10-markers (±2.3 on 15-markers)** of the human average. The report also shows how often the humans agree with each other, which is the realistic ceiling, plus systematic bias and the worst disagreements. Fix the rubrics behind the worst items first.

## Tests

```bash
npm run test:engine   # scoring, rubric, weakness, calibration (vitest)
npm run test:edge     # evaluate-answer end to end in Deno, Supabase + Azure faked
npm run rubrics:validate
```

The older suite (`npm run test:run`) had 80 failing tests before this change (mocks out of date). This change adds no failures.
