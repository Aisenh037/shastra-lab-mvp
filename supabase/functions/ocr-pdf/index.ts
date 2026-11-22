import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireSignedIn } from "../_shared/auth.ts";
import { ocrMode, transcribeImage } from "../_shared/ocr.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_PAGES = 40;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const denied = await requireSignedIn(req);
  if (denied) return denied;

  try {
    const { images } = await req.json();
    if (!Array.isArray(images) || images.length === 0) {
      throw new Error("Images array is required");
    }
    if (images.length > MAX_PAGES) {
      throw new Error(`At most ${MAX_PAGES} pages per upload`);
    }

    console.log(`Reading ${images.length} pages (${ocrMode()})`);

    const textParts: string[] = [];
    for (let i = 0; i < images.length; i++) {
      try {
        const pageText = await transcribeImage(images[i]);
        if (pageText) textParts.push(`--- Page ${i + 1} ---\n${pageText}`);
      } catch (pageError) {
        console.error(`Error processing page ${i + 1}:`, pageError);
        textParts.push(`--- Page ${i + 1} ---\n[Error extracting text from this page]`);
      }
    }

    const text = textParts.join("\n\n");
    console.log("OCR complete, extracted", text.length, "characters");

    return new Response(JSON.stringify({ text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in ocr-pdf:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
