import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { finalizeProjectImport, importProjectRows, storeNormalizedFacts } from "@/server/project-store";
import { parseCsv } from "@/core/csv";
import { factRowSchema } from "@/core/schemas";

const schema = z.object({ rows: z.array(z.record(z.unknown())).min(1), mode: z.enum(["STRICT", "PARTIAL"]).default("STRICT"), fileName: z.string().max(255).optional() });
const batchSchema = z.object({ facts: z.array(factRowSchema).min(1).max(500) });
const finalizeSchema = z.object({
  finalize: z.object({
    fileName: z.string().max(255).optional(), entityLevel: z.enum(["CAMPAIGN", "ADSET", "AD"]),
    accepted: z.number().int().nonnegative(), rejected: z.number().int().nonnegative(),
    mode: z.enum(["STRICT", "PARTIAL"]), errorCodes: z.array(z.string().min(1)).max(100)
  })
});
export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireUser(request, ["admin", "user"]);
    const { projectId } = await context.params;
    const isCsv = request.headers.get("content-type")?.includes("text/csv");
    if (!isCsv) {
      const json = await request.json();
      const batch = batchSchema.safeParse(json);
      if (batch.success) return NextResponse.json(await storeNormalizedFacts({ projectId, user, facts: batch.data.facts }));
      const finalize = finalizeSchema.safeParse(json);
      if (finalize.success) return NextResponse.json({ importRecord: await finalizeProjectImport({ projectId, user, ...finalize.data.finalize }) });
      const parsed = schema.safeParse(json);
      if (!parsed.success) return NextResponse.json({ error: "INVALID_IMPORT_INPUT", details: parsed.error.flatten() }, { status: 422 });
      return NextResponse.json(await importProjectRows({ projectId, user, ...parsed.data }));
    }
    const body = { rows: parseCsv(await request.text()), mode: new URL(request.url).searchParams.get("mode") === "PARTIAL" ? "PARTIAL" as const : "STRICT" as const, fileName: "CSV upload" };
    return NextResponse.json(await importProjectRows({ projectId, user, ...body }));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, { status: 400 }); }
}
