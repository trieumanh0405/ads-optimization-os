import { NextResponse } from "next/server";
import { z } from "zod";
import { createProvider } from "@/ai/provider-registry";
import { basePerformancePlaybook, compilePlaybooks } from "@/ai/playbooks";

const requestSchema = z.object({
  provider: z.object({
    id: z.string(),
    name: z.string(),
    baseUrl: z.string().url(),
    apiKey: z.string().min(1),
    enabled: z.boolean()
  }),
  model: z.string().min(1),
  metrics: z.record(z.number().nullable()),
  deterministicDecision: z.record(z.unknown())
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const provider = createProvider(body.provider);
    const insight = await provider.analyze({
      model: body.model,
      systemPrompt: compilePlaybooks([basePerformancePlaybook]),
      payload: {
        metrics: body.metrics,
        deterministicDecision: body.deterministicDecision,
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
