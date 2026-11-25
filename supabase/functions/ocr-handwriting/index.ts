// Read one photo of a handwritten answer. One image per request; counts one page
// against the user's daily OCR quota (given back if the read fails).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, json, requireUser } from "../_shared/auth.ts";
import { ocrMode, transcribeImage } from "../_shared/ocr.ts";
import { MAX_IMAGE_CHARS, quotaMessage, reservePages } from "../_shared/ocr-quota.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const ctx = await requireUser(req);
  if (ctx instanceof Response) return ctx;

  let imageData: unknown;
  try {
    ({ imageData } = await req.json());
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  if (!imageData || typeof imageData !== "string") return json(req, { error: "Image data is required" }, 400);
  if (imageData.length > MAX_IMAGE_CHARS) {
    return json(req, { error: "This photo is too large. Retake it at a lower resolution.", code: "IMAGE_TOO_LARGE" }, 413);
  }

  const quota = await reservePages(ctx.adminClient, ctx.user.id, 1);
  if (!quota.ok) return json(req, { error: quotaMessage(quota.limit), code: "OCR_QUOTA", limit: quota.limit }, 429);

  try {
    console.log(`Reading handwritten answer (${ocrMode()})`);
    const text = await transcribeImage(imageData);
    console.log("OCR successful, extracted", text.length, "characters");
    return json(req, { text, pagesLeftToday: quota.reservation.remaining });
  } catch (error) {
    await quota.reservation.release();
    console.error("Error in ocr-handwriting:", error);
    return json(req, { error: "Could not read this photo. Try again, or type the answer.", code: "OCR_FAILED" }, 502);
  }
});
