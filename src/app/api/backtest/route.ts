import { NextResponse } from "next/server";
import { z } from "zod";
import { runBacktest } from "@/core/backtest";

const schema = z.object({
  baseRequest: z.unknown(),
  checkpoints: z.array(z.object({
    asOfDate: z.string().date(),
    runAt: z.string().datetime({ offset: true })
  })).min(1).max(90)
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    return NextResponse.json(runBacktest(input.baseRequest, input.checkpoints));
  } catch (error) {
    return NextResponse.json({ error: "BACKTEST_FAILURE", message: error instanceof Error ? error.message : "Unknown error" }, { status: 422 });
  }
}
