import { NextResponse } from "next/server";
import { z } from "zod";
import { canonicalFieldSchema, normalizeRows } from "@/core/normalize";
import { requireUser } from "@/server/auth";

const requestSchema = z.object({
  projectId: z.string().min(1), platform: z.string().min(1), accountId: z.string().min(1),
  mappings: z.array(z.object({ canonicalField: canonicalFieldSchema, sourceColumn: z.string().min(1), required: z.boolean(), defaultValue: z.unknown().optional() })),
  metricMappings: z.array(z.object({
    metricKey: z.string().min(1),
    sourceColumn: z.string().min(1),
    defaultValue: z.unknown().optional()
  })).optional(),
  dimensionMappings: z.array(z.object({
    dimensionKey: z.string().min(1),
    sourceColumn: z.string().min(1),
    defaultValue: z.unknown().optional()
  })).optional(),
  rows: z.array(z.record(z.unknown()))
});

export async function POST(request: Request) {
  try {
    await requireUser(request);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "UNAUTHORIZED" }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "INVALID_NORMALIZATION_INPUT", details: parsed.error.flatten() }, { status: 422 });
  if (parsed.data.rows.length > 20000) return NextResponse.json({ error: "ROW_LIMIT_EXCEEDED" }, { status: 400 });

  const result = normalizeRows(parsed.data.rows, parsed.data);
  return NextResponse.json({ ...result, accepted: result.facts.length, rejected: new Set(result.errors.map((item) => item.row)).size }, { status: result.errors.length ? 207 : 200 });
}
