import { z } from "zod";
import type { AppUser } from "./auth";
import { assertSupabaseResult, supabaseAdmin } from "./supabase-admin";

const memberInputSchema = z.object({
  email: z.string().trim().email().max(320),
  projectIds: z.array(z.string().min(1)).min(1, "TEAM_PROJECT_REQUIRED").max(100)
});

export type TeamMember = {
  userId: string;
  email: string;
  role: "admin" | "user";
  projectIds: string[];
};

function requireAdmin(user: AppUser) {
  if (user.role !== "admin") throw new Error("TEAM_ADMIN_REQUIRED");
}

async function findAuthUserByEmail(email: string) {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  assertSupabaseResult(error);
  return data.users.find((item) => item.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

export async function listTeamMembers(user: AppUser): Promise<TeamMember[]> {
  requireAdmin(user);
  const supabase = supabaseAdmin();
  const [{ data: memberships, error: membershipError }, { data: projects, error: projectsError }, { data: assignments, error: assignmentError }, { data: authUsers, error: authError }] = await Promise.all([
    supabase.from("organization_members").select("user_id, role").eq("organization_id", user.organizationId),
    supabase.from("projects").select("project_id").eq("organization_id", user.organizationId),
    supabase.from("project_members").select("user_id, project_id"),
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  ]);
  assertSupabaseResult(membershipError); assertSupabaseResult(projectsError); assertSupabaseResult(assignmentError); assertSupabaseResult(authError);
  const projectIds = new Set((projects ?? []).map((project) => project.project_id));
  const assigned = new Map<string, string[]>();
  for (const assignment of assignments ?? []) if (projectIds.has(assignment.project_id)) assigned.set(assignment.user_id, [...(assigned.get(assignment.user_id) ?? []), assignment.project_id]);
  const emailById = new Map((authUsers.users ?? []).map((item) => [item.id, item.email ?? item.id]));
  return (memberships ?? []).map((member) => ({
    userId: member.user_id,
    email: emailById.get(member.user_id) ?? member.user_id,
    role: (member.role === "admin" ? "admin" : "user") as TeamMember["role"],
    projectIds: assigned.get(member.user_id) ?? []
  })).sort((left, right) => left.role === right.role ? left.email.localeCompare(right.email) : left.role === "admin" ? -1 : 1);
}

/** Invites a new user, or updates an existing user's project assignments. */
export async function upsertTeamMember(user: AppUser, input: unknown) {
  requireAdmin(user);
  const parsed = memberInputSchema.parse(input);
  const supabase = supabaseAdmin();
  const { data: organizationProjects, error: projectError } = await supabase
    .from("projects").select("project_id").eq("organization_id", user.organizationId);
  assertSupabaseResult(projectError);
  const validProjectIds = new Set((organizationProjects ?? []).map((project) => project.project_id));
  if (parsed.projectIds.some((projectId) => !validProjectIds.has(projectId))) throw new Error("TEAM_PROJECT_NOT_IN_ORGANIZATION");

  let authUser = await findAuthUserByEmail(parsed.email);
  let invited = false;
  if (!authUser) {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(parsed.email, {
      redirectTo: process.env.NEXT_PUBLIC_APP_URL ?? "https://ads-optimization-app.vercel.app"
    });
    assertSupabaseResult(error);
    authUser = data.user;
    invited = true;
  }
  if (!authUser) throw new Error("TEAM_INVITE_FAILED");

  const { error: memberError } = await supabase.from("organization_members").upsert({
    organization_id: user.organizationId, user_id: authUser.id, role: "buyer"
  }, { onConflict: "organization_id,user_id", ignoreDuplicates: true });
  assertSupabaseResult(memberError);

  const organizationProjectIds = [...validProjectIds];
  const { error: clearError } = organizationProjectIds.length
    ? await supabase.from("project_members").delete().eq("user_id", authUser.id).in("project_id", organizationProjectIds)
    : { error: null };
  assertSupabaseResult(clearError);
  if (parsed.projectIds.length) {
    const { error: assignmentError } = await supabase.from("project_members").insert(parsed.projectIds.map((projectId) => ({
      project_id: projectId, user_id: authUser!.id,
      can_import: true, can_run: true, can_edit_config: true, can_edit_rules: true, can_review_actions: true
    })));
    assertSupabaseResult(assignmentError);
  }
  return { invited, member: { userId: authUser.id, email: parsed.email, role: "user" as const, projectIds: parsed.projectIds } };
}
