import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { runOptimizationEngine } from "@/core/engine";
import { requireUser } from "@/server/auth";

export async function POST(request: Request) {
  try {
    await requireUser(request);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    return NextResponse.json(runOptimizationEngine(await request.json()));
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: "INVALID_ENGINE_INPUT", details: error.flatten() }, { status: 422 });
    return NextResponse.json({ error: "ENGINE_FAILURE", message: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
