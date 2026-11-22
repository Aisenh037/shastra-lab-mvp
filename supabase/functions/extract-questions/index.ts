import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { chat } from "../_shared/llm.ts";
import { requireSignedIn } from "../_shared/auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const denied = await requireSignedIn(req);
  if (denied) return denied;

  try {
    const { text } = await req.json();
    
    const { content } = await chat({ messages: [
          {
            role: "system",
            content: `You are an expert at extracting exam questions from raw text. Extract each individual question from the provided exam paper text. Ignore headers, instructions, page numbers, and formatting text. Return ONLY a JSON array with objects containing: question_number (integer) and question_text (string). Preserve the exact wording of each question.`
          },
          { role: "user", content: text }
        ] });
    
    // Parse JSON from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    const questions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    return new Response(JSON.stringify({ questions }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
