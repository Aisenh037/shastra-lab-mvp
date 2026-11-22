import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireSignedIn } from "../_shared/auth.ts";
import { ocrMode, transcribeImage } from "../_shared/ocr.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const denied = await requireSignedIn(req);
  if (denied) return denied;

  try {
    const { imageData } = await req.json();
    if (!imageData || typeof imageData !== "string") {
      throw new Error("Image data is required");
    }

    console.log(`Reading handwritten answer (${ocrMode()})`);
    const text = await transcribeImage(imageData);
    console.log("OCR successful, extracted", text.length, "characters");

    return new Response(JSON.stringify({ text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in ocr-handwriting:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
