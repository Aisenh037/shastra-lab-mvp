// One chat-completions client for every edge function, any provider.
//
// Providers are tried in order; a rate limit (429), a server error (5xx) or a
// network failure moves on to the next one. Configure with secrets:
//
//   Primary (any OpenAI-compatible API: Groq, OpenRouter, Together, a self-hosted
//   vLLM or Ollama server ...)
//     LLM_BASE_URL       e.g. https://api.groq.com/openai/v1
//     LLM_API_KEY
//     LLM_MODEL          e.g. openai/gpt-oss-120b
//     LLM_REASONING_EFFORT   optional: low | medium | high (gpt-oss and other reasoning models)
//   Fallback (optional, same shape)
//     LLM_FALLBACK_BASE_URL, LLM_FALLBACK_API_KEY, LLM_FALLBACK_MODEL, LLM_FALLBACK_REASONING_EFFORT
//   Azure OpenAI (optional, tried last)
//     AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT
//
//   Vision (reading answer photos). Defaults to the primary provider.
//     VISION_BASE_URL, VISION_API_KEY, VISION_MODEL   e.g. https://openrouter.ai/api/v1, qwen/qwen3.8-27b:free

export interface Provider {
  name: string;
  url: string;
  headers: Record<string, string>;
  /** Sent as "model"; Azure puts the deployment in the URL instead. */
  model?: string;
  reasoningEffort?: string;
}

type Env = (name: string) => string | undefined;
const denoEnv: Env = (name) => Deno.env.get(name) ?? undefined;

function openAiCompatible(name: string, base?: string, key?: string, model?: string, effort?: string): Provider | null {
  if (!base || !key || !model) return null;
  return {
    name,
    url: `${base.replace(/\/+$/, "")}/chat/completions`,
    headers: { Authorization: `Bearer ${key}` },
    model,
    reasoningEffort: effort || undefined,
  };
}

export function textProviders(env: Env = denoEnv): Provider[] {
  const list: Array<Provider | null> = [
    openAiCompatible("primary", env("LLM_BASE_URL"), env("LLM_API_KEY"), env("LLM_MODEL"), env("LLM_REASONING_EFFORT")),
    openAiCompatible(
      "fallback",
      env("LLM_FALLBACK_BASE_URL"),
      env("LLM_FALLBACK_API_KEY"),
      env("LLM_FALLBACK_MODEL"),
      env("LLM_FALLBACK_REASONING_EFFORT"),
    ),
  ];
  const azureEndpoint = env("AZURE_OPENAI_ENDPOINT");
  const azureKey = env("AZURE_OPENAI_API_KEY");
  if (azureEndpoint && azureKey) {
    const deployment = env("AZURE_OPENAI_DEPLOYMENT") ?? "gpt-5.2-chat";
    const base = azureEndpoint.endsWith("/") ? azureEndpoint : `${azureEndpoint}/`;
    list.push({
      name: `azure:${deployment}`,
      url: `${base}openai/deployments/${deployment}/chat/completions?api-version=2025-04-01-preview`,
      headers: { "api-key": azureKey },
    });
  }
  return list.filter((p): p is Provider => p !== null);
}

export function visionProviders(env: Env = denoEnv): Provider[] {
  const own = openAiCompatible("vision", env("VISION_BASE_URL"), env("VISION_API_KEY"), env("VISION_MODEL"));
  return own ? [own] : textProviders(env);
}

export type Message =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "user";
      content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
    };

export interface ChatOptions {
  messages: Message[];
  /** Ask for a JSON object. Retried without it if a provider rejects the parameter. */
  json?: boolean;
  maxTokens?: number;
  providers?: Provider[];
}

export interface ChatResult {
  content: string;
  provider: string;
  model: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const isOpenRouter = (url: string) => {
  try {
    return new URL(url).hostname.endsWith("openrouter.ai");
  } catch {
    return false;
  }
};

export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const providers = opts.providers ?? textProviders();
  if (providers.length === 0) {
    throw new Error("No AI provider configured: set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL");
  }

  const errors: string[] = [];
  for (const p of providers) {
    let json = !!opts.json;
    for (let attempt = 0; attempt < 2; attempt++) {
      const body: Record<string, unknown> = {
        messages: opts.messages,
        max_completion_tokens: opts.maxTokens ?? 4000,
      };
      if (p.model) body.model = p.model;
      if (p.reasoningEffort) body.reasoning_effort = p.reasoningEffort;
      if (json) body.response_format = { type: "json_object" };
      // Students' answers must not train anyone's model: on OpenRouter, only route to
      // providers that don't collect prompts. OPENROUTER_DATA_COLLECTION=allow turns this off.
      if (isOpenRouter(p.url) && (Deno.env.get("OPENROUTER_DATA_COLLECTION") ?? "deny") !== "allow") {
        body.provider = { data_collection: "deny" };
      }

      let res: Response;
      try {
        res = await fetch(p.url, {
          method: "POST",
          headers: { ...p.headers, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (e) {
        errors.push(`${p.name}: network ${(e as Error).message}`);
        break; // next provider
      }

      if (res.ok) {
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content === "string" && content.trim()) {
          return { content, provider: p.name, model: p.model ?? p.name };
        }
        errors.push(`${p.name}: empty response`);
        break;
      }

      const text = (await res.text()).slice(0, 300);
      // Some providers or models don't support JSON mode: retry once without it.
      if (res.status === 400 && json && /response_format|json/i.test(text)) {
        json = false;
        continue;
      }
      errors.push(`${p.name}: ${res.status} ${text}`);
      if (res.status === 429 || res.status >= 500) {
        await sleep(500);
        break; // next provider
      }
      break; // other 4xx: this provider won't work for this request; try the next
    }
  }
  throw new Error(`All AI providers failed. ${errors.join(" | ")}`);
}
