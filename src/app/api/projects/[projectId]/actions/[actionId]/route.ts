import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { updateStoredAction } from "@/server/project-store";

const schema = z.object({
  to: z.enum(["PENDING", "DONE", "REJECTED", "DEFERRED"]),
  at: z.string().datetime({ offset: true }), note: z.string().max(2000).nullable().default(null)
});
export async function PATCH(request: Request, context: { params: Promise<{ projectId: string; actionId: string }> }) {
  try {
    const user = await requireUser(request, ["admin", "leader", "buyer", "reviewer"]);
    const { projectId, actionId } = await context.params; const body = schema.parse(await request.json());
    return NextResponse.json(await updateStoredAction({ projectId, actionId, organizationId: user.organizationId, actor: user.uid, ...body }));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, { status: 400 }); }
}
