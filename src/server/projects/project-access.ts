import { assertSupabaseResult, supabaseAdmin } from "../supabase-admin";
import type { AppUser } from "../auth";

export type ProjectCapability = "view" | "import" | "run" | "editConfig" | "editRules" | "reviewActions";

/**
 * The service-role database client bypasses RLS. This is the mandatory server
 * authorization guard for every project operation; RLS remains a second layer
 * for future direct/realtime browser reads.
 */
export async function assertProjectAccess(projectId: string, user: AppUser, capability: ProjectCapability = "view") {
  const supabase = supabaseAdmin();
  const { data: project, error: projectError } = await supabase
    .from("projects").select("project_id, organization_id, created_by").eq("project_id", projectId).maybeSingle();
  assertSupabaseResult(projectError);
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  if (project.organization_id !== user.organizationId) throw new Error("PROJECT_FORBIDDEN");
  if (user.role === "admin" || project.created_by === user.uid) return project;

  const { data: membership, error: membershipError } = await supabase
    .from("project_members")
    .select("user_id")
    .eq("project_id", projectId).eq("user_id", user.uid).maybeSingle();
  assertSupabaseResult(membershipError);
  if (!membership) throw new Error("PROJECT_FORBIDDEN");
  // A project assignment grants the whole operating workflow. Keeping this
  // atomic avoids confusing per-button permission matrices for media buyers.
  return project;
}
