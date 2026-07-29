import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { listTeamMembers, upsertTeamMember } from "@/server/team-store";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    return NextResponse.json({ members: await listTeamMembers(user) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, { status: 403 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(await upsertTeamMember(user, await request.json()), { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, { status: 400 }); }
}
