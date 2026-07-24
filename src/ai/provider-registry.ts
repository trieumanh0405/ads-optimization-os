import type { AiProvider } from "./contracts";
import { OpenAiCompatibleProvider } from "./openai-compatible";
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";

export type ProviderConfig = {
  id: string;
  kind: "OPENAI_COMPATIBLE" | "ANTHROPIC" | "GEMINI";
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
};

export function createProvider(config: ProviderConfig): AiProvider {
  if (!config.enabled) throw new Error("AI provider is disabled");
  if (config.kind === "ANTHROPIC") return new AnthropicProvider(config.id, config.baseUrl, config.apiKey);
  if (config.kind === "GEMINI") return new GeminiProvider(config.id, config.baseUrl, config.apiKey);
  return new OpenAiCompatibleProvider(config.id, config.baseUrl, config.apiKey);
}
