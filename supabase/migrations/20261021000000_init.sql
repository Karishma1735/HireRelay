-- HireRelay core schema. Every row belongs to an HR user (auth.users) via owner_id.
-- The Express backend connects with the service role / postgres role and always scopes by owner_id;
-- RLS is enabled with no policies so the anon/authenticated roles can never read these tables directly.

create table drives (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  role_title text,
  venue text,
  drive_date date,
  slug text not null unique,
  status text not null default 'active' check (status in ('active','closed')),
  field_map jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index drives_owner_idx on drives(owner_id);

create table interviewers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index interviewers_owner_idx on interviewers(owner_id);

create table candidates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  drive_id uuid not null references drives(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  email_norm text,
  phone_norm text,
  role_applied text,
  experience_years numeric,
  current_company text,
  source text not null default 'form' check (source in ('form','google_forms','manual')),
  external_ref text,
  extra jsonb not null default '{}'::jsonb,
  -- HR-managed fields: form synchronisation never writes these after the row exists.
  stage text not null default 'registered'
    check (stage in ('registered','checked_in','waiting','in_interview','completed','selected','rejected','no_show')),
  queue_number integer,
  checked_in_at timestamptz,
  interviewer_id uuid references interviewers(id) on delete set null,
  interview_started_at timestamptz,
  interview_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index candidates_owner_drive_idx on candidates(owner_id, drive_id);
create index candidates_stage_idx on candidates(drive_id, stage);
create unique index candidates_drive_email_uq on candidates(drive_id, email_norm) where email_norm is not null;
create unique index candidates_drive_phone_uq on candidates(drive_id, phone_norm) where phone_norm is not null;
create unique index candidates_drive_extref_uq on candidates(drive_id, source, external_ref) where external_ref is not null;

create table feedback (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  candidate_id uuid not null references candidates(id) on delete cascade,
  interviewer_id uuid references interviewers(id) on delete set null,
  rating integer not null check (rating between 1 and 5),
  recommendation text not null check (recommendation in ('hire','hold','reject')),
  notes text,
  created_at timestamptz not null default now()
);
create unique index feedback_candidate_uq on feedback(candidate_id);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('send_email')),
  purpose text not null check (purpose in ('registration_confirmation','interview_reminder','feedback_reminder','custom')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','executed','failed')),
  title text not null,
  reason text,
  payload jsonb not null,
  candidate_id uuid references candidates(id) on delete set null,
  requested_by text not null default 'system' check (requested_by in ('system','agent','hr')),
  decided_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index approvals_owner_status_idx on approvals(owner_id, status);

create table workflow_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  approval_id uuid references approvals(id) on delete set null,
  candidate_id uuid references candidates(id) on delete set null,
  kind text not null,
  status text not null check (status in ('running','success','failed')),
  request jsonb,
  response jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index workflow_runs_owner_idx on workflow_runs(owner_id, started_at desc);

create table viasocket_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  service_id text not null,
  auth_id text not null,
  script_id text,            -- credential: server side only
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (owner_id, service_id)
);

create table viasocket_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  drive_id uuid not null references drives(id) on delete cascade,
  service_id text not null,
  trigger_version_id text not null,
  script_id text not null,   -- the subscription's own id on viaSocket
  auth_id text not null,
  input_data jsonb not null,
  handler text not null,
  status text not null default 'active' check (status in ('active','removed')),
  created_at timestamptz not null default now()
);
create unique index viasocket_subs_active_uq on viasocket_subscriptions(drive_id, trigger_version_id) where status = 'active';

create table ingest_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  drive_id uuid references drives(id) on delete cascade,
  source text not null,
  outcome text not null check (outcome in ('created','duplicate','rejected','error')),
  candidate_id uuid references candidates(id) on delete set null,
  message text,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index ingest_events_owner_idx on ingest_events(owner_id, created_at desc);

create table settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  auto_send_confirmations boolean not null default false
);

alter table drives enable row level security;
alter table interviewers enable row level security;
alter table candidates enable row level security;
alter table feedback enable row level security;
alter table approvals enable row level security;
alter table workflow_runs enable row level security;
alter table viasocket_connections enable row level security;
alter table viasocket_subscriptions enable row level security;
alter table ingest_events enable row level security;
alter table settings enable row level security;
