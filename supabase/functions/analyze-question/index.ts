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
    const { question, topics } = await req.json();
    
    const { content } = await chat({ messages: [
          {
            role: "system",
            content: `You are an expert exam analyst. Analyze the given question and:
1. Classify it to ONE topic from the provided list ONLY
2. Assign difficulty: Easy, Medium, or Hard
3. Explain why this topic is academically important (max 3 lines, formal tone)

Return ONLY valid JSON: {"topic": "string", "difficulty": "Easy|Medium|Hard", "importance_explanation": "string"}`
          },
          {
            role: "user",
            content: `Available topics: ${topics.join(', ')}\n\nQuestion: ${question}`
          }
        ] });
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { topic: null, difficulty: null, importance_explanation: null };

    return new Response(JSON.stringify(analysis), {
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
