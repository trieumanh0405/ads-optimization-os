import { assertSupabaseResult, supabaseAdmin } from "./supabase-admin";

export type AppUser = { uid: string; organizationId: string; role: "admin" | "leader" | "buyer" | "reviewer" };

export async function requireAuthenticatedUser(request: Request): Promise<{ uid: string }> {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new Error("AUTH_TOKEN_REQUIRED");
  const supabase = supabaseAdmin();
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  assertSupabaseResult(authError);
  const uid = authData.user?.id;
  if (!uid) throw new Error("AUTH_USER_NOT_FOUND");
  return { uid };
}

export async function requireUser(request: Request, roles?: AppUser["role"][]): Promise<AppUser> {
  const { uid } = await requireAuthenticatedUser(request);
  const supabase = supabaseAdmin();

  const requestedOrganizationId = request.headers.get("x-organization-id");
  let membershipQuery = supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", uid);
  if (requestedOrganizationId) membershipQuery = membershipQuery.eq("organization_id", requestedOrganizationId);
  const { data: memberships, error: membershipError } = await membershipQuery.limit(2);
  assertSupabaseResult(membershipError);
  if (!memberships?.length) throw new Error("AUTH_ORGANIZATION_MEMBERSHIP_REQUIRED");
  if (!requestedOrganizationId && memberships.length > 1) throw new Error("AUTH_ORGANIZATION_HEADER_REQUIRED");
  const membership = memberships[0];
  const organizationId = membership.organization_id;
  const role = membership.role as AppUser["role"];
  if (!organizationId || !["admin", "leader", "buyer", "reviewer"].includes(role)) throw new Error("AUTH_ROLE_INVALID");
  if (roles && !roles.includes(role)) throw new Error("AUTH_FORBIDDEN");
  return { uid, organizationId, role };
}
