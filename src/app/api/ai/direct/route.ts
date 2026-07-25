import { NextResponse } from "next/server";
import { z } from "zod";
import { createProvider } from "@/ai/provider-registry";
import {
  basePerformancePlaybook,
  compilePlaybooks,
  findBuiltInPlaybooks,
  missingPlaybookMetrics
} from "@/ai/playbooks";

export const maxDuration = 60;

function isSafeProviderUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host !== "localhost"
      && host !== "0.0.0.0"
      && host !== "::1"
      && !host.endsWith(".local")
      && !/^127\./.test(host)
      && !/^10\./.test(host)
      && !/^192\.168\./.test(host)
      && !/^169\.254\./.test(host)
      && !/^172\.(1[6-9]|2\d|3[01])\./.test(host);
  } catch {
    return false;
  }
}

const requestSchema = z.object({
  provider: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(["OPENAI_COMPATIBLE", "ANTHROPIC", "GEMINI"]),
    baseUrl: z.string().url().refine(isSafeProviderUrl, "Provider base URL must be a public HTTPS endpoint"),
    apiKey: z.string().min(8),
    model: z.string().min(1)
  }),
  playbookIds: z.array(z.string()).max(10).default([]),
  metrics: z.record(z.number().nullable()),
  dimensions: z.record(z.string().nullable()).default({}),
  deterministicDecision: z.record(z.unknown()),
  projectContext: z.record(z.unknown()).default({})
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const playbooks = [basePerformancePlaybook, ...findBuiltInPlaybooks(body.playbookIds)];
    const provider = createProvider({
      id: body.provider.id,
      kind: body.provider.kind,
      name: body.provider.name,
      baseUrl: body.provider.baseUrl,
      apiKey: body.provider.apiKey,
      enabled: true
    });
    const missingMetrics = missingPlaybookMetrics(playbooks, body.metrics);
    const insight = await provider.analyze({
      model: body.provider.model,
      systemPrompt: compilePlaybooks(playbooks),
      payload: {
        projectContext: body.projectContext,
        metrics: body.metrics,
        dimensions: body.dimensions,
        deterministicDecision: body.deterministicDecision,
        selectedPlaybooks: playbooks.map((item) => ({
          id: item.id,
          version: item.version,
          source: item.source
        })),
        missingRequiredMetrics: missingMetrics,
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
    return NextResponse.json({ insight, missingMetrics });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
