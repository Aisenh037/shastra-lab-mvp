// "Download my data": everything ShastraLab holds about the signed-in user, as JSON.
// (DPDP Act 2023 s.11, right to access information about personal data.)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, json, requireUser } from "../_shared/auth.ts";

/** Tables keyed by the user, and the column that holds the user id. */
export const USER_TABLES: Array<[table: string, column: string]> = [
  ["profiles", "id"],
  ["user_roles", "user_id"],
  ["user_consents", "user_id"],
  ["answer_submissions", "user_id"],
  ["practice_questions", "user_id"],
  ["mock_tests", "user_id"],
  ["daily_practice_streaks", "user_id"],
  ["achievements", "user_id"],
  ["email_report_preferences", "user_id"],
  ["syllabi", "user_id"],
  ["exam_papers", "user_id"],
  ["questions", "user_id"],
  ["evaluation_credits", "user_id"],
  ["credit_ledger", "user_id"],
  ["payment_orders", "user_id"],
  ["ocr_usage", "user_id"],
];

// Internal processing fields, not personal data about the user.
const STRIP: Record<string, string[]> = { answer_submissions: ["job_payload", "locked_until"] };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  const ctx = await requireUser(req);
  if (ctx instanceof Response) return ctx;

  const data: Record<string, unknown> = {};
  for (const [table, column] of USER_TABLES) {
    const { data: rows, error } = await ctx.adminClient.from(table).select("*").eq(column, ctx.user.id);
    if (error) {
      console.error(`export ${table}`, error.message);
      data[table] = { error: "could not be read; contact us for this part" };
      continue;
    }
    data[table] = (rows ?? []).map((r: Record<string, unknown>) => {
      for (const k of STRIP[table] ?? []) delete r[k];
      return r;
    });
  }

  const { data: files } = await ctx.adminClient.storage.from("answer-uploads").list(ctx.user.id, { limit: 1000 });

  return json(req, {
    exported_at: new Date().toISOString(),
    account: {
      id: ctx.user.id,
      email: ctx.user.email,
      created_at: ctx.user.created_at,
      last_sign_in_at: ctx.user.last_sign_in_at,
      sign_in_methods: (ctx.user.identities ?? []).map((i) => i.provider),
      metadata: ctx.user.user_metadata,
    },
    uploaded_answer_photos: (files ?? []).map((f) => ({ name: f.name, uploaded_at: f.created_at })),
    data,
  });
});
