import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/server/auth";
import { assertSupabaseResult, supabaseAdmin } from "@/server/supabase-admin";

const schema = z.object({ organizationName: z.string().trim().min(2).max(120) });

/** Creates the first organization for a newly authenticated account. */
export async function POST(request: Request) {
  try {
    const { uid } = await requireAuthenticatedUser(request);
    const body = schema.parse(await request.json());
    const supabase = supabaseAdmin();
    const { data: memberships, error: membershipError } = await supabase
      .from("organization_members").select("organization_id").eq("user_id", uid).limit(1);
    assertSupabaseResult(membershipError);
    if (memberships?.length) throw new Error("ONBOARDING_ALREADY_COMPLETED");
    const { data: existingOrganizations, error: organizationCountError } = await supabase
      .from("organizations").select("organization_id").limit(1);
    assertSupabaseResult(organizationCountError);
    if (existingOrganizations?.length) throw new Error("ONBOARDING_CLOSED_CONTACT_ADMIN");
    const { data: organization, error: organizationError } = await supabase
      .from("organizations").insert({ name: body.organizationName }).select("organization_id, name").single();
    assertSupabaseResult(organizationError);
    if (!organization) throw new Error("ONBOARDING_ORGANIZATION_CREATE_FAILED");
    const { error: insertError } = await supabase.from("organization_members").insert({
      organization_id: organization.organization_id, user_id: uid, role: "admin"
    });
    assertSupabaseResult(insertError);
    return NextResponse.json({ organization, role: "admin" }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, { status: 400 });
  }
}

/** Lets the client show the first-admin bootstrap only on a new installation. */
export async function GET(request: Request) {
  try {
    await requireAuthenticatedUser(request);
    const { data, error } = await supabaseAdmin().from("organizations").select("organization_id").limit(1);
    assertSupabaseResult(error);
    return NextResponse.json({ bootstrapAllowed: !(data?.length) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, { status: 401 }); }
}
