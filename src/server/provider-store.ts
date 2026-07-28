import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertSupabaseResult, supabaseAdmin } from "./supabase-admin";
import { decryptSecret, encryptSecret } from "./secret-crypto";

export const providerInputSchema = z.object({
  name: z.string().min(1), kind: z.enum(["OPENAI_COMPATIBLE", "ANTHROPIC", "GEMINI"]),
  baseUrl: z.string().url(), apiKey: z.string().min(1),
  models: z.array(z.string().min(1)).min(1), enabled: z.boolean().default(true)
});
export type ProviderInput = z.infer<typeof providerInputSchema>;
export type StoredProvider = {
  id: string; name: string; kind: z.infer<typeof providerInputSchema>["kind"]; baseUrl: string; encryptedApiKey: string;
  models: string[]; enabled: boolean; createdAt: string; updatedAt: string;
};

export async function saveProvider(organizationId: string, input: ProviderInput): Promise<Omit<StoredProvider, "encryptedApiKey"> & { apiKeyMasked: string }> {
  const id = randomUUID(); const now = new Date().toISOString();
  const record: StoredProvider = {
    id, name: input.name, kind: input.kind, baseUrl: input.baseUrl, encryptedApiKey: encryptSecret(input.apiKey),
    models: input.models, enabled: input.enabled, createdAt: now, updatedAt: now
  };
  const { error } = await supabaseAdmin().from("ai_providers").insert({
    provider_id: id, organization_id: organizationId, name: record.name, kind: record.kind,
    base_url: record.baseUrl, encrypted_api_key: record.encryptedApiKey, models: record.models,
    enabled: record.enabled, created_at: now, updated_at: now
  });
  assertSupabaseResult(error);
  return { id, name: record.name, kind: record.kind, baseUrl: record.baseUrl, models: record.models, enabled: record.enabled, createdAt: now, updatedAt: now, apiKeyMasked: `••••${input.apiKey.slice(-4)}` };
}

export async function listProviders(organizationId: string) {
  const { data, error } = await supabaseAdmin().from("ai_providers")
    .select("provider_id, name, kind, base_url, models, enabled, created_at, updated_at")
    .eq("organization_id", organizationId).order("name");
  assertSupabaseResult(error);
  return (data ?? []).map((provider) => ({
    id: provider.provider_id, name: provider.name, kind: provider.kind, baseUrl: provider.base_url,
    models: provider.models, enabled: provider.enabled, createdAt: provider.created_at,
    updatedAt: provider.updated_at, apiKeyMasked: "••••••••"
  }));
}

export async function getProviderSecret(organizationId: string, providerId: string) {
  const { data, error } = await supabaseAdmin().from("ai_providers")
    .select("provider_id, name, kind, base_url, encrypted_api_key, models, enabled, created_at, updated_at")
    .eq("organization_id", organizationId).eq("provider_id", providerId).maybeSingle();
  assertSupabaseResult(error);
  if (!data) throw new Error("AI_PROVIDER_NOT_FOUND");
  if (!data.enabled) throw new Error("AI_PROVIDER_DISABLED");
  const provider: StoredProvider = {
    id: data.provider_id, name: data.name, kind: data.kind, baseUrl: data.base_url,
    encryptedApiKey: data.encrypted_api_key, models: data.models, enabled: data.enabled,
    createdAt: data.created_at, updatedAt: data.updated_at
  };
  return { ...provider, apiKey: decryptSecret(provider.encryptedApiKey) };
}
