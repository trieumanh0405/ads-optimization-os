import { randomUUID } from "node:crypto";
import { z } from "zod";
import { adminDb } from "./firebase-admin";

export const playbookInputSchema = z.object({
  name: z.string().min(1),
  version: z.number().int().positive(),
  projectTypes: z.array(z.string()).default([]),
  requiredMetrics: z.array(z.string()).min(1),
  optionalMetrics: z.array(z.string()).default([]),
  instructions: z.string().min(20),
  prohibitedActions: z.array(z.string()).default(["override_rule_action", "execute_meta_action"]),
  enabled: z.boolean().default(true)
});
export type PlaybookRecord = z.infer<typeof playbookInputSchema> & { id: string; createdAt: string; updatedAt: string };

const collection = (organizationId: string) => adminDb().collection("organizations").doc(organizationId).collection("analysisPlaybooks");

export async function savePlaybook(organizationId: string, input: z.infer<typeof playbookInputSchema>): Promise<PlaybookRecord> {
  const id = randomUUID(); const now = new Date().toISOString();
  const record = { id, ...input, createdAt: now, updatedAt: now };
  await collection(organizationId).doc(`${id}_v${input.version}`).set(record);
  return record;
}

export async function listPlaybooks(organizationId: string): Promise<PlaybookRecord[]> {
  const snapshot = await collection(organizationId).where("enabled", "==", true).get();
  return snapshot.docs.map((document) => document.data() as PlaybookRecord);
}

export async function getPlaybooks(organizationId: string, ids: string[]): Promise<PlaybookRecord[]> {
  const all = await listPlaybooks(organizationId);
  const selected = all.filter((item) => ids.includes(item.id));
  if (selected.length !== new Set(ids).size) throw new Error("ANALYSIS_PLAYBOOK_NOT_FOUND");
  return selected;
}
