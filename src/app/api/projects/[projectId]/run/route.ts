import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { runStoredProject } from "@/server/project-store";

const schema = z.object({ asOfDate: z.string().date(), runAt: z.string().datetime({ offset: true }) });
export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireUser(request, ["admin", "leader", "buyer"]);
    const { projectId } = await context.params; const body = schema.parse(await request.json());
    return NextResponse.json(await runStoredProject({ projectId, organizationId: user.organizationId, ...body }));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, { status: 400 }); }
}
