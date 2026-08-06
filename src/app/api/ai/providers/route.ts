import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { deleteProvider, listProviders, providerInputSchema, saveProvider } from "@/server/provider-store";

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const status = message.startsWith("AUTH_") ? 401 : message.includes("CONFIGURED") ? 503 : 400;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    return NextResponse.json({ providers: await listProviders(user.organizationId) });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request, ["admin"]);
    const input = providerInputSchema.parse(await request.json());
    return NextResponse.json({ provider: await saveProvider(user.organizationId, input) }, { status: 201 });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request, ["admin"]);
    const { providerId } = z.object({ providerId: z.string().min(1) }).parse(await request.json());
    await deleteProvider(user.organizationId, providerId);
    return NextResponse.json({ success: true });
  } catch (error) { return failure(error); }
}

