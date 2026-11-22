// Shared request plumbing for edge functions (Deno).
import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "*").split(",").map((o) => o.trim());

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allow = allowedOrigins.includes("*") ? "*" : allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    Vary: "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

export interface AuthedContext {
  user: User;
  /** Acts as the caller: row-level security applies. */
  userClient: SupabaseClient;
  /** Service role: bypasses RLS. Use only for writes the user must not make directly. */
  adminClient: SupabaseClient;
}

/**
 * Resolve the signed-in user from the Authorization header.
 * verify_jwt alone is not enough: the public anon key is itself a valid JWT.
 */
export async function requireUser(req: Request): Promise<AuthedContext | Response> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) return json(req, { error: "Sign in to continue." }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data?.user) return json(req, { error: "Your session has expired. Sign in again." }, 401);

  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  return { user: data.user, userClient, adminClient };
}

/** Guard for functions that only need to know the caller is a real user. */
export async function requireSignedIn(req: Request): Promise<Response | null> {
  const ctx = await requireUser(req);
  return ctx instanceof Response ? ctx : null;
}

/** Service-role client for trusted server-side work (bypasses RLS). */
export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}
