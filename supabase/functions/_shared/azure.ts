// Azure OpenAI chat-completions endpoint shared by the edge functions.
// Replaces Lovable's AI gateway, which only works inside Lovable Cloud.

export function azureChat(): { url: string; headers: Record<string, string> } {
  const endpoint = Deno.env.get("AZURE_OPENAI_ENDPOINT");
  const key = Deno.env.get("AZURE_OPENAI_API_KEY");
  if (!endpoint || !key) throw new Error("Azure OpenAI credentials not configured");
  const deployment = Deno.env.get("AZURE_OPENAI_DEPLOYMENT") ?? "gpt-5.2-chat";
  const base = endpoint.endsWith("/") ? endpoint : `${endpoint}/`;
  return {
    url: `${base}openai/deployments/${deployment}/chat/completions?api-version=2025-04-01-preview`,
    headers: { "api-key": key },
  };
}
