// Read text from a photo of a handwritten answer.
//
// Default: an open vision-language model through any OpenAI-compatible API
// (see llm.ts, VISION_*). Azure Document Intelligence stays available: set
// OCR_PROVIDER=azure (or leave OCR_PROVIDER unset with only the Azure keys present).
import { chat, visionProviders } from "./llm.ts";

const TRANSCRIBE_PROMPT = `Transcribe all handwritten and printed text in this image of an exam answer sheet.
Rules:
- Copy the words exactly as written, including spelling mistakes. Do not correct, summarise or add anything.
- Keep paragraph breaks, headings, bullet points and numbering.
- Write [illegible] for any word you cannot read.
- Ignore page margins, ruled lines and doodles.
Output only the transcribed text.`;

export function ocrMode(): "vision" | "azure" {
  const explicit = Deno.env.get("OCR_PROVIDER");
  if (explicit === "azure" || explicit === "vision") return explicit;
  const hasAzure = !!Deno.env.get("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT") && !!Deno.env.get("AZURE_DOCUMENT_INTELLIGENCE_API_KEY");
  const hasVision = !!Deno.env.get("VISION_API_KEY") || !!Deno.env.get("LLM_API_KEY");
  return hasAzure && !hasVision ? "azure" : "vision";
}

function toDataUrl(imageData: string): string {
  if (imageData.startsWith("data:")) return imageData;
  return `data:image/jpeg;base64,${imageData}`;
}

async function transcribeWithVisionModel(imageData: string): Promise<string> {
  const result = await chat({
    providers: visionProviders(),
    maxTokens: 4000,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: TRANSCRIBE_PROMPT },
          { type: "image_url", image_url: { url: toDataUrl(imageData) } },
        ],
      },
    ],
  });
  console.log(`OCR via ${result.provider} (${result.model})`);
  return result.content.trim();
}

async function transcribeWithAzure(imageData: string): Promise<string> {
  const endpoint = Deno.env.get("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT");
  const key = Deno.env.get("AZURE_DOCUMENT_INTELLIGENCE_API_KEY");
  if (!endpoint || !key) throw new Error("Azure Document Intelligence credentials not configured");
  const base = endpoint.endsWith("/") ? endpoint : `${endpoint}/`;

  const base64 = imageData.replace(/^data:image\/\w+;base64,/, "");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

  const start = await fetch(`${base}documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-02-29-preview`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  if (!start.ok) throw new Error(`Azure API error: ${start.status} ${(await start.text()).slice(0, 200)}`);
  const operation = start.headers.get("Operation-Location");
  if (!operation) throw new Error("No operation location returned");

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const poll = await fetch(operation, { headers: { "Ocp-Apim-Subscription-Key": key } });
    if (!poll.ok) throw new Error(`Azure polling error: ${poll.status}`);
    const result = await poll.json();
    if (result.status === "succeeded") {
      if (result.analyzeResult?.content) return result.analyzeResult.content;
      return (result.analyzeResult?.paragraphs ?? []).map((p: { content: string }) => p.content).join("\n\n");
    }
    if (result.status === "failed") throw new Error("Azure OCR processing failed");
  }
  throw new Error("OCR processing timed out");
}

export function transcribeImage(imageData: string): Promise<string> {
  return ocrMode() === "azure" ? transcribeWithAzure(imageData) : transcribeWithVisionModel(imageData);
}
