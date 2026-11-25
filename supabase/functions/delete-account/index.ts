// "Delete my account": erase the signed-in user's personal data.
// (DPDP Act 2023 s.12, right to erasure.)
//
// Order: answer photos in storage -> the auth user. Deleting the auth user
// cascades through every user table (see migration 20261125110000). Payment
// records stay, detached from the person, because tax law requires them.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, json, requireUser } from "../_shared/auth.ts";

const BUCKET = "answer-uploads";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  const ctx = await requireUser(req);
  if (ctx instanceof Response) return ctx;

  let confirmEmail: unknown;
  try {
    ({ confirmEmail } = await req.json());
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  if (typeof confirmEmail !== "string" || confirmEmail.trim().toLowerCase() !== (ctx.user.email ?? "").toLowerCase()) {
    return json(req, { error: "Type your account email exactly to confirm.", code: "CONFIRMATION_MISMATCH" }, 400);
  }

  const { data: isAdmin } = await ctx.adminClient.rpc("has_role", { _user_id: ctx.user.id, _role: "admin" });
  if (isAdmin) {
    return json(req, { error: "Admin accounts can't be deleted here. Remove the admin role first.", code: "ADMIN" }, 403);
  }

  // 1. Answer photos (storage isn't covered by database cascades).
  for (;;) {
    const { data: files, error } = await ctx.adminClient.storage.from(BUCKET).list(ctx.user.id, { limit: 100 });
    if (error) {
      console.error("listing uploads failed", error.message);
      return json(req, { error: "Couldn't delete your account right now. Nothing was removed; try again.", code: "STORAGE" }, 500);
    }
    if (!files || files.length === 0) break;
    const { error: rmError } = await ctx.adminClient.storage.from(BUCKET).remove(files.map((f) => `${ctx.user.id}/${f.name}`));
    if (rmError) {
      console.error("removing uploads failed", rmError.message);
      return json(req, { error: "Couldn't delete your account right now. Try again.", code: "STORAGE" }, 500);
    }
    if (files.length < 100) break;
  }

  // 2. The account itself; cascades to every user table.
  const { error } = await ctx.adminClient.auth.admin.deleteUser(ctx.user.id);
  if (error) {
    console.error("deleteUser failed", error.message);
    return json(req, { error: "Couldn't delete your account right now. Try again.", code: "AUTH" }, 500);
  }

  console.log(`account deleted ${ctx.user.id}`);
  return json(req, { deleted: true });
});
