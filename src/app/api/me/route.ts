import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, { status: 401 });
  }
}
