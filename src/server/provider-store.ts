import { randomUUID } from "node:crypto";
import { z } from "zod";
import { adminDb } from "./firebase-admin";
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

const collection = (organizationId: string) => adminDb().collection("organizations").doc(organizationId).collection("aiProviders");

export async function saveProvider(organizationId: string, input: ProviderInput): Promise<Omit<StoredProvider, "encryptedApiKey"> & { apiKeyMasked: string }> {
  const id = randomUUID(); const now = new Date().toISOString();
  const record: StoredProvider = { id, name: input.name, kind: input.kind, baseUrl: input.baseUrl, encryptedApiKey: encryptSecret(input.apiKey), models: input.models, enabled: input.enabled, createdAt: now, updatedAt: now };
  await collection(organizationId).doc(id).set(record);
  return { id, name: record.name, kind: record.kind, baseUrl: record.baseUrl, models: record.models, enabled: record.enabled, createdAt: now, updatedAt: now, apiKeyMasked: `••••${input.apiKey.slice(-4)}` };
}

export async function listProviders(organizationId: string) {
  const snapshot = await collection(organizationId).orderBy("name").get();
  return snapshot.docs.map((document) => {
    const { encryptedApiKey: _, ...provider } = document.data() as StoredProvider;
    return { ...provider, apiKeyMasked: "••••••••" };
  });
}

export async function getProviderSecret(organizationId: string, providerId: string) {
  const snapshot = await collection(organizationId).doc(providerId).get();
  if (!snapshot.exists) throw new Error("AI_PROVIDER_NOT_FOUND");
  const provider = snapshot.data() as StoredProvider;
  if (!provider.enabled) throw new Error("AI_PROVIDER_DISABLED");
  return { ...provider, apiKey: decryptSecret(provider.encryptedApiKey) };
}
