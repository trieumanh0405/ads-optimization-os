import type { AiProvider } from "./contracts";
import { OpenAiCompatibleProvider } from "./openai-compatible";

export type ProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
};

export function createProvider(config: ProviderConfig): AiProvider {
  if (!config.enabled) throw new Error("AI provider is disabled");
  return new OpenAiCompatibleProvider(config.id, config.baseUrl, config.apiKey);
}
