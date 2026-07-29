import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { assertProjectAccess } from "@/server/project-store";
import { previewGoogleSheet } from "@/server/google-sheets";

const previewSchema = z.object({
  spreadsheetInput: z.string().min(1).max(2_000),
  sheetName: z.string().trim().min(1).max(150).optional(),
  headerRow: z.number().int().min(1).max(100).default(1)
});

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireUser(request);
    const { projectId } = await context.params;
    await assertProjectAccess(projectId, user, "import");
    const body = previewSchema.parse(await request.json());
    return NextResponse.json(await previewGoogleSheet(body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "GOOGLE_SHEETS_PREVIEW_FAILED" }, { status: 400 });
  }
}
