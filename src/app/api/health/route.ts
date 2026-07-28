import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL
    && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  return NextResponse.json({
    status: "ok",
    product: "ads-optimization-os",
    version: "1.0.0",
    runtime: "vercel-nextjs",
    browserWorkspace: true,
    supabaseTeamBackendConfigured: supabaseConfigured,
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
