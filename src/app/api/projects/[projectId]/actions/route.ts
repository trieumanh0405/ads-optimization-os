import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { listStoredActions } from "@/server/project-store";

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireUser(request);
    const { projectId } = await context.params;
    const status = new URL(request.url).searchParams.get("status") as "PENDING" | "DONE" | "REJECTED" | "DEFERRED" | null;
    return NextResponse.json({ actions: await listStoredActions(projectId, user.organizationId, status ?? undefined) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, { status: 400 }); }
}
