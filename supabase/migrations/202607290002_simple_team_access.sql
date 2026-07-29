-- Product roles are intentionally simple: admin manages the team, users run
-- projects they own or that an admin assigned. Existing enum values remain for
-- backwards compatibility; the application normalizes them to `user`.

alter table public.projects add column if not exists created_by uuid references auth.users(id) on delete set null;

update public.projects project
set created_by = (
  select member.user_id
  from public.organization_members member
  where member.organization_id = project.organization_id
  order by case when member.role = 'admin' then 0 else 1 end, member.created_at
  limit 1
)
where project.created_by is null;

create index if not exists projects_organization_owner_idx on public.projects(organization_id, created_by);

-- Direct database access follows the same ownership rule used by server APIs.
create or replace function public.is_project_owner(target_project_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects project
    where project.project_id = target_project_id and project.created_by = auth.uid()
  );
$$;

drop policy if exists "managers create projects" on public.projects;
create policy "members create projects" on public.projects for insert with check (public.is_organization_member(organization_id) and created_by = auth.uid());

drop policy if exists "managers delete projects" on public.projects;
create policy "admins or owners delete projects" on public.projects for delete using (public.is_organization_manager(organization_id) or public.is_project_owner(project_id));
