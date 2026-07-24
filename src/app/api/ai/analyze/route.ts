import { NextResponse } from "next/server";
import { z } from "zod";
import { createProvider } from "@/ai/provider-registry";
import { basePerformancePlaybook, compilePlaybooks } from "@/ai/playbooks";
import { requireUser } from "@/server/auth";
import { getProviderSecret } from "@/server/provider-store";
import { getPlaybooks } from "@/server/playbook-store";

const requestSchema = z.object({
  providerId: z.string().min(1),
  playbookIds: z.array(z.string()).default([]),
  model: z.string().min(1),
  metrics: z.record(z.number().nullable()),
  deterministicDecision: z.record(z.unknown())
});

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = requestSchema.parse(await request.json());
    const stored = await getProviderSecret(user.organizationId, body.providerId);
    const storedPlaybooks = body.playbookIds.length ? await getPlaybooks(user.organizationId, body.playbookIds) : [];
    if (!stored.models.includes(body.model)) throw new Error("AI_MODEL_NOT_ALLOWED_FOR_PROVIDER");
    const provider = createProvider({
      id: stored.id, kind: stored.kind, name: stored.name, baseUrl: stored.baseUrl,
      apiKey: stored.apiKey, enabled: stored.enabled
    });
    const insight = await provider.analyze({
      model: body.model,
      systemPrompt: compilePlaybooks([
        basePerformancePlaybook,
        ...storedPlaybooks.map((item) => ({
          id: item.id, name: item.name, version: item.version,
          requiredMetrics: item.requiredMetrics, instructions: item.instructions, enabled: item.enabled
        }))
      ]),
      payload: {
        metrics: body.metrics,
        deterministicDecision: body.deterministicDecision,
        selectedPlaybooks: storedPlaybooks.map((item) => ({ id: item.id, version: item.version })),
        outputSchema: {
          summary: "string",
          observations: [{ metric: "string", finding: "string", severity: "info|warning|critical" }],
          hypotheses: ["string"],
          suggestedChecks: ["string"],
          actionCommentary: "string",
          confidence: "number 0..1",
          limitations: ["string"]
        }
      }
    });
    return NextResponse.json({ insight });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
