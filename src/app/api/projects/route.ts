import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { listProjects, projectBundleSchema, saveProjectBundle } from "@/server/project-store";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    return NextResponse.json({ projects: await listProjects(user.organizationId) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, { status: 401 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request, ["admin", "leader"]);
    const bundle = projectBundleSchema.parse(await request.json());
    return NextResponse.json({ project: await saveProjectBundle(user.organizationId, bundle) }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, { status: 400 }); }
}
