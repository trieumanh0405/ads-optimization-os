import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { getStoredProjectWorkspace } from "@/server/project-store";

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireUser(request);
    const { projectId } = await context.params;
    return NextResponse.json({ project: await getStoredProjectWorkspace(projectId, user) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, { status: 400 });
  }
}
