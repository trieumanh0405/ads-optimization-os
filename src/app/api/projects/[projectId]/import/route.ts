import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { importProjectRows } from "@/server/project-store";
import { parseCsv } from "@/core/csv";

const schema = z.object({ rows: z.array(z.record(z.unknown())).min(1), mode: z.enum(["STRICT", "PARTIAL"]).default("STRICT"), fileName: z.string().max(255).optional() });
export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireUser(request, ["admin", "user"]);
    const { projectId } = await context.params;
    const isCsv = request.headers.get("content-type")?.includes("text/csv");
    const body = isCsv
      ? { rows: parseCsv(await request.text()), mode: new URL(request.url).searchParams.get("mode") === "PARTIAL" ? "PARTIAL" as const : "STRICT" as const, fileName: "CSV upload" }
      : schema.parse(await request.json());
    return NextResponse.json(await importProjectRows({ projectId, user, ...body }));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, { status: 400 }); }
}
