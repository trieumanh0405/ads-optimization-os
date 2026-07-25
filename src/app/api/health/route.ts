import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const firebaseConfigured = Boolean(
    process.env.FIREBASE_PROJECT_ID
    && process.env.FIREBASE_CLIENT_EMAIL
    && process.env.FIREBASE_PRIVATE_KEY
  );
  return NextResponse.json({
    status: "ok",
    product: "ads-optimization-os",
    version: "1.0.0",
    runtime: "vercel-nextjs",
    browserWorkspace: true,
    firebaseTeamBackendConfigured: firebaseConfigured,
    capabilities: [
      "project-config",
      "csv-normalization",
      "custom-metrics",
      "rule-engine",
      "action-queue",
      "audit-log",
      "multi-provider-ai"
    ],
    checkedAt: new Date().toISOString()
  }, {
    headers: { "Cache-Control": "no-store" }
  });
}
