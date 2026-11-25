import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { chat } from "../_shared/llm.ts";
import { requireSignedIn } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VideoFeedbackRequest {
  score: number;
  percentage: number;
  strengths: string[];
  improvements: string[];
  overallFeedback: string;
  questionText: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const denied = await requireSignedIn(req);
  if (denied) return denied;

  try {
    const {
      score,
      percentage,
      strengths,
      improvements,
      overallFeedback,
      questionText,
    }: VideoFeedbackRequest = await req.json();

    
    // Generate a structured video script/storyboard for the feedback
    const { content } = await chat({ messages: [
          {
            role: "system",
            content: `You are a video content creator for educational feedback. 
Create a structured video storyboard that can be animated on the frontend.
Return a JSON object with "slides" array, each slide having:
- "title": short title for the slide
- "content": main text content (1-2 sentences)
- "icon": one of: trophy, star, target, lightbulb, chart, checkmark, arrow-up
- "color": one of: green, amber, blue, purple
- "duration": seconds to show this slide (3-6 seconds)`,
          },
          {
            role: "user",
            content: `Create a 5-7 slide video storyboard for this evaluation:
Score: ${score}/${percentage}%
Question: ${questionText.slice(0, 200)}
Overall: ${overallFeedback}
Strengths: ${strengths.join(", ")}
Improvements: ${improvements.join(", ")}`,
          },
        ] });

    let videoData;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        videoData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found");
      }
    } catch {
      // Fallback storyboard
      videoData = {
        slides: [
          {
            title: "Your Score",
            content: `You scored ${score} points (${percentage}%)`,
            icon: percentage >= 60 ? "trophy" : "target",
            color: percentage >= 70 ? "green" : percentage >= 50 ? "amber" : "blue",
            duration: 4,
          },
          {
            title: "What You Did Well",
            content: strengths[0] || "Good attempt at answering the question",
            icon: "star",
            color: "green",
            duration: 5,
          },
          {
            title: "Room for Growth",
            content: improvements[0] || "Keep practicing for better results",
            icon: "lightbulb",
            color: "amber",
            duration: 5,
          },
          {
            title: "Keep Going!",
            content: "Every practice session makes you stronger. Keep it up!",
            icon: "arrow-up",
            color: "purple",
            duration: 4,
          },
        ],
      };
    }

    return new Response(JSON.stringify(videoData), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in generate-video-feedback:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
