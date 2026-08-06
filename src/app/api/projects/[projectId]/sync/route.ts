import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { getStoredProjectWorkspace, syncGoogleSheetProject } from "@/server/project-store";

const schema = z.object({ runAfterSync: z.boolean().optional(), force: z.boolean().optional() });

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireUser(request, ["admin", "user"]);
    const { projectId } = await context.params;
    const body = schema.parse(await request.json().catch(() => ({})));
    const sync = await syncGoogleSheetProject({ projectId, user, ...body });
    const project = await getStoredProjectWorkspace(projectId, user);
    return NextResponse.json({ sync, project });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "SYNC_FAILED" }, { status: 400 });
  }
}
