import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { listPlaybooks, playbookInputSchema, savePlaybook } from "@/server/playbook-store";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    return NextResponse.json({ playbooks: await listPlaybooks(user.organizationId) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, { status: 401 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request, ["admin"]);
    return NextResponse.json({ playbook: await savePlaybook(user.organizationId, playbookInputSchema.parse(await request.json())) }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, { status: 400 }); }
}
