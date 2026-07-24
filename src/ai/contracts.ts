import { z } from "zod";

export const aiInsightSchema = z.object({
  summary: z.string(),
  observations: z.array(z.object({
    metric: z.string(),
    finding: z.string(),
    severity: z.enum(["info", "warning", "critical"])
  })),
  hypotheses: z.array(z.string()),
  suggestedChecks: z.array(z.string()),
  actionCommentary: z.string(),
  confidence: z.number().min(0).max(1),
  limitations: z.array(z.string())
});

export type AiInsight = z.infer<typeof aiInsightSchema>;

export function parseAiInsight(content: string): AiInsight {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{"); const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("AI_PROVIDER_RESPONSE_IS_NOT_JSON");
  return aiInsightSchema.parse(JSON.parse(trimmed.slice(start, end + 1)));
}

export interface AiProvider {
  id: string;
  analyze(input: {
    model: string;
    systemPrompt: string;
    payload: unknown;
  }): Promise<AiInsight>;
}
