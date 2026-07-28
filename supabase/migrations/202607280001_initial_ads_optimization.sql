-- Ads Optimization OS: Supabase schema, RLS, project permissions and audit tables.
-- Apply through Supabase CLI or Dashboard > SQL Editor before enabling team mode.
create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('admin', 'leader', 'buyer', 'reviewer');
exception when duplicate_object then null;
end $$;

create table if not exists public.organizations (
  organization_id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'buyer',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index if not exists organization_members_user_id_idx on public.organization_members(user_id);

create table if not exists public.projects (
  project_id text primary key check (char_length(project_id) between 1 and 128),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  config jsonb not null,
  metric_definitions jsonb not null default '[]'::jsonb,
  rules jsonb not null default '[]'::jsonb,
  mappings jsonb not null default '[]'::jsonb,
  metric_mappings jsonb not null default '[]'::jsonb,
  dimension_mappings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_organization_updated_idx on public.projects(organization_id, updated_at desc);

create table if not exists public.project_members (
  project_id text not null references public.projects(project_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  can_import boolean not null default false,
  can_run boolean not null default false,
  can_edit_config boolean not null default false,
  can_edit_rules boolean not null default false,
  can_review_actions boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_id_idx on public.project_members(user_id);

create table if not exists public.facts (
  fact_id text primary key,
  project_id text not null references public.projects(project_id) on delete cascade,
  source_row_key text not null,
  date date not null,
  entity_level text not null check (entity_level in ('CAMPAIGN', 'ADSET', 'AD')),
  source_updated_at timestamptz not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, source_row_key)
);
create index if not exists facts_project_date_idx on public.facts(project_id, date);
create index if not exists facts_project_level_date_idx on public.facts(project_id, entity_level, date);

create table if not exists public.import_runs (
  import_id text primary key,
  project_id text not null references public.projects(project_id) on delete cascade,
  imported_at timestamptz not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists import_runs_project_imported_at_idx on public.import_runs(project_id, imported_at desc);

create table if not exists public.optimization_runs (
  run_id text primary key,
  project_id text not null references public.projects(project_id) on delete cascade,
  run_at timestamptz not null,
  status text not null check (status in ('COMPLETED', 'BLOCKED')),
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists optimization_runs_project_run_at_idx on public.optimization_runs(project_id, run_at desc);

create table if not exists public.action_queue (
  action_id text primary key,
  project_id text not null references public.projects(project_id) on delete cascade,
  action_key text not null,
  approval_status text not null check (approval_status in ('PENDING', 'DONE', 'REJECTED', 'DEFERRED')),
  run_at timestamptz not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, action_key)
);
create index if not exists action_queue_project_status_run_at_idx on public.action_queue(project_id, approval_status, run_at desc);

create table if not exists public.action_log (
  event_id text primary key,
  project_id text not null references public.projects(project_id) on delete cascade,
  action_id text not null references public.action_queue(action_id) on delete restrict,
  at timestamptz not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists action_log_project_at_idx on public.action_log(project_id, at desc);

create table if not exists public.ai_providers (
  provider_id text primary key,
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('OPENAI_COMPATIBLE', 'ANTHROPIC', 'GEMINI')),
  base_url text not null,
  encrypted_api_key text not null,
  models jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_providers_organization_idx on public.ai_providers(organization_id);

create table if not exists public.analysis_playbooks (
  playbook_id text primary key,
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  name text not null,
  version integer not null check (version > 0),
  project_types jsonb not null default '[]'::jsonb,
  required_metrics jsonb not null default '[]'::jsonb,
  optional_metrics jsonb not null default '[]'::jsonb,
  instructions text not null,
  prohibited_actions jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists analysis_playbooks_organization_idx on public.analysis_playbooks(organization_id);

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members membership
    where membership.organization_id = target_organization_id and membership.user_id = auth.uid()
  );
$$;

create or replace function public.is_organization_manager(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members membership
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and membership.role in ('admin', 'leader')
  );
$$;

create or replace function public.can_access_project(target_project_id text, capability text default 'view')
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.projects project
    join public.organization_members organization_member
      on organization_member.organization_id = project.organization_id
     and organization_member.user_id = auth.uid()
    left join public.project_members project_member
      on project_member.project_id = project.project_id and project_member.user_id = auth.uid()
    where project.project_id = target_project_id
      and (
        organization_member.role in ('admin', 'leader')
        or (capability = 'view' and project_member.user_id is not null)
        or (capability = 'import' and project_member.can_import)
        or (capability = 'run' and project_member.can_run)
        or (capability = 'edit_config' and project_member.can_edit_config)
        or (capability = 'edit_rules' and project_member.can_edit_rules)
        or (capability = 'review_actions' and project_member.can_review_actions)
      )
  );
$$;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.facts enable row level security;
alter table public.import_runs enable row level security;
alter table public.optimization_runs enable row level security;
alter table public.action_queue enable row level security;
alter table public.action_log enable row level security;
alter table public.ai_providers enable row level security;
alter table public.analysis_playbooks enable row level security;

create policy "organization members read organization" on public.organizations for select using (public.is_organization_member(organization_id));
create policy "organization managers update organization" on public.organizations for update using (public.is_organization_manager(organization_id));
create policy "members read organization memberships" on public.organization_members for select using (public.is_organization_member(organization_id));
create policy "managers manage organization memberships" on public.organization_members for all using (public.is_organization_manager(organization_id)) with check (public.is_organization_manager(organization_id));

create policy "members read projects" on public.projects for select using (public.can_access_project(project_id));
create policy "managers create projects" on public.projects for insert with check (public.is_organization_manager(organization_id));
create policy "project config editors update" on public.projects for update using (public.can_access_project(project_id, 'edit_config')) with check (public.can_access_project(project_id, 'edit_config'));
create policy "managers delete projects" on public.projects for delete using (public.is_organization_manager(organization_id));
create policy "members read project members" on public.project_members for select using (public.can_access_project(project_id));
create policy "managers manage project members" on public.project_members for all using ((select public.is_organization_manager(project.organization_id) from public.projects project where project.project_id = project_members.project_id)) with check ((select public.is_organization_manager(project.organization_id) from public.projects project where project.project_id = project_members.project_id));

create policy "read facts" on public.facts for select using (public.can_access_project(project_id));
create policy "import facts" on public.facts for insert with check (public.can_access_project(project_id, 'import'));
create policy "update imported facts" on public.facts for update using (public.can_access_project(project_id, 'import')) with check (public.can_access_project(project_id, 'import'));
create policy "read import runs" on public.import_runs for select using (public.can_access_project(project_id));
create policy "write import runs" on public.import_runs for insert with check (public.can_access_project(project_id, 'import'));
create policy "read runs" on public.optimization_runs for select using (public.can_access_project(project_id));
create policy "run engine" on public.optimization_runs for insert with check (public.can_access_project(project_id, 'run'));
create policy "read actions" on public.action_queue for select using (public.can_access_project(project_id));
create policy "run writes actions" on public.action_queue for insert with check (public.can_access_project(project_id, 'run'));
create policy "review actions" on public.action_queue for update using (public.can_access_project(project_id, 'review_actions')) with check (public.can_access_project(project_id, 'review_actions'));
create policy "read action log" on public.action_log for select using (public.can_access_project(project_id));
create policy "write action log" on public.action_log for insert with check (public.can_access_project(project_id, 'review_actions'));
create policy "read ai providers" on public.ai_providers for select using (public.is_organization_member(organization_id));
create policy "manage ai providers" on public.ai_providers for all using (public.is_organization_manager(organization_id)) with check (public.is_organization_manager(organization_id));
create policy "read playbooks" on public.analysis_playbooks for select using (public.is_organization_member(organization_id));
create policy "manage playbooks" on public.analysis_playbooks for all using (public.is_organization_manager(organization_id)) with check (public.is_organization_manager(organization_id));

-- The APIs use the service-role key but must still pass application-level checks.
-- Do not expose SUPABASE_SERVICE_ROLE_KEY to Vercel's public/NEXT_PUBLIC variables.
