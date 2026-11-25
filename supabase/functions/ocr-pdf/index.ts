// Read pages of a scanned PDF (rendered to images by the browser).
//
// At most MAX_PAGES_PER_REQUEST pages per call so each request finishes well
// inside the edge function time limit; the app sends a long PDF page by page.
// Each page counts against the user's daily OCR quota; pages that fail to read
// are given back.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, json, requireUser } from "../_shared/auth.ts";
import { ocrMode, transcribeImage } from "../_shared/ocr.ts";
import { MAX_IMAGE_CHARS, quotaMessage, reservePages } from "../_shared/ocr-quota.ts";

export const MAX_PAGES_PER_REQUEST = 2;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const ctx = await requireUser(req);
  if (ctx instanceof Response) return ctx;

  let images: unknown;
  try {
    ({ images } = await req.json());
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  if (!Array.isArray(images) || images.length === 0 || images.some((i) => typeof i !== "string" || !i)) {
    return json(req, { error: "images must be a non-empty array of image data" }, 400);
  }
  if (images.length > MAX_PAGES_PER_REQUEST) {
    return json(req, { error: `Send at most ${MAX_PAGES_PER_REQUEST} pages per request.`, code: "TOO_MANY_PAGES" }, 400);
  }
  if (images.some((i: string) => i.length > MAX_IMAGE_CHARS)) {
    return json(req, { error: "A page image is too large.", code: "IMAGE_TOO_LARGE" }, 413);
  }

  const quota = await reservePages(ctx.adminClient, ctx.user.id, images.length);
  if (!quota.ok) return json(req, { error: quotaMessage(quota.limit), code: "OCR_QUOTA", limit: quota.limit }, 429);

  console.log(`Reading ${images.length} page(s) (${ocrMode()})`);
  const pages: string[] = [];
  let failed = 0;
  for (const image of images as string[]) {
    try {
      pages.push(await transcribeImage(image));
    } catch (error) {
      failed++;
      console.error("page failed:", error);
      pages.push("[Error extracting text from this page]");
    }
  }

  if (failed === images.length) {
    await quota.reservation.release();
    return json(req, { error: "Could not read this page. Try again.", code: "OCR_FAILED" }, 502);
  }
  return json(req, { text: pages.join("\n\n"), pages, pagesLeftToday: quota.reservation.remaining });
});
