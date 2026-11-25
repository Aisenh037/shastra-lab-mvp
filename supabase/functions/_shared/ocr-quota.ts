// Guards for the OCR functions: one page per request, a size cap, and a daily
// per-user page quota (admins are exempt).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/** Base64 data-URL length for a ~6 MB image. Phones produce less after the app downsizes. */
export const MAX_IMAGE_CHARS = 8_000_000;

export function dailyPageLimit(): number {
  const n = Number(Deno.env.get("OCR_DAILY_PAGE_LIMIT"));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 40;
}

export interface Reservation {
  /** Give the pages back (the read failed). Safe to call more than once. */
  release(): Promise<void>;
  remaining: number | null;
}

export type ReserveResult = { ok: true; reservation: Reservation } | { ok: false; limit: number };

export async function reservePages(admin: SupabaseClient, userId: string, pages: number): Promise<ReserveResult> {
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (isAdmin) return { ok: true, reservation: { release: async () => {}, remaining: null } };

  const limit = dailyPageLimit();
  const { data, error } = await admin.rpc("reserve_ocr_pages", { p_user: userId, p_pages: pages, p_limit: limit });
  if (error) throw new Error(`quota check failed: ${error.message}`);
  if (data === -1) return { ok: false, limit };

  let released = false;
  return {
    ok: true,
    reservation: {
      remaining: data as number,
      release: async () => {
        if (released) return;
        released = true;
        await admin.rpc("release_ocr_pages", { p_user: userId, p_pages: pages });
      },
    },
  };
}

export function quotaMessage(limit: number): string {
  return `You've reached today's limit of ${limit} photo/page reads. It resets at midnight (India time). You can still type your answer.`;
}
