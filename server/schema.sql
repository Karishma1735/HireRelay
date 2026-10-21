-- HireRelay schema (SQLite). Applied idempotently at every start (see src/db.js).
-- gen_uuid() and now() are SQL functions registered by db.js. JSON columns are TEXT.
-- Every row belongs to an HR user (users.id) via owner_id; the API always scopes queries by it.

create table if not exists users (
  id text primary key default (gen_uuid()),
  email text not null unique,
  password_hash text not null,
  created_at text not null default (now())
);

create table if not exists drives (
  id text primary key default (gen_uuid()),
  owner_id text not null references users(id) on delete cascade,
  name text not null,
  role_title text,
  venue text,
  drive_date text,
  slug text not null unique,
  status text not null default 'active' check (status in ('active','closed')),
  field_map text not null default '{}',
  created_at text not null default (now())
);
create index if not exists drives_owner_idx on drives(owner_id);

create table if not exists interviewers (
  id text primary key default (gen_uuid()),
  owner_id text not null references users(id) on delete cascade,
  name text not null,
  email text,
  active integer not null default 1,
  created_at text not null default (now())
);
create index if not exists interviewers_owner_idx on interviewers(owner_id);

create table if not exists candidates (
  id text primary key default (gen_uuid()),
  owner_id text not null references users(id) on delete cascade,
  drive_id text not null references drives(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  email_norm text,
  phone_norm text,
  role_applied text,
  experience_years real,
  current_company text,
  source text not null default 'form' check (source in ('form','google_forms','manual')),
  external_ref text,
  extra text not null default '{}',
  -- HR-managed fields: form synchronisation never writes these after the row exists.
  stage text not null default 'registered'
    check (stage in ('registered','checked_in','waiting','in_interview','completed','selected','rejected','no_show')),
  queue_number integer,
  checked_in_at text,
  interviewer_id text references interviewers(id) on delete set null,
  interview_started_at text,
  interview_completed_at text,
  created_at text not null default (now()),
  updated_at text not null default (now())
);
create index if not exists candidates_owner_drive_idx on candidates(owner_id, drive_id);
create index if not exists candidates_stage_idx on candidates(drive_id, stage);
create unique index if not exists candidates_drive_email_uq on candidates(drive_id, email_norm) where email_norm is not null;
create unique index if not exists candidates_drive_phone_uq on candidates(drive_id, phone_norm) where phone_norm is not null;
create unique index if not exists candidates_drive_extref_uq on candidates(drive_id, source, external_ref) where external_ref is not null;

create table if not exists feedback (
  id text primary key default (gen_uuid()),
  owner_id text not null references users(id) on delete cascade,
  candidate_id text not null references candidates(id) on delete cascade,
  interviewer_id text references interviewers(id) on delete set null,
  rating integer not null check (rating between 1 and 5),
  recommendation text not null check (recommendation in ('hire','hold','reject')),
  notes text,
  created_at text not null default (now())
);
create unique index if not exists feedback_candidate_uq on feedback(candidate_id);

create table if not exists approvals (
  id text primary key default (gen_uuid()),
  owner_id text not null references users(id) on delete cascade,
  kind text not null check (kind in ('send_email')),
  purpose text not null check (purpose in ('registration_confirmation','interview_reminder','feedback_reminder','custom')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','executed','failed')),
  title text not null,
  reason text,
  payload text not null,
  candidate_id text references candidates(id) on delete set null,
  requested_by text not null default 'system' check (requested_by in ('system','agent','hr')),
  decided_at text,
  error text,
  created_at text not null default (now())
);
create index if not exists approvals_owner_status_idx on approvals(owner_id, status);

create table if not exists workflow_runs (
  id text primary key default (gen_uuid()),
  owner_id text not null references users(id) on delete cascade,
  approval_id text references approvals(id) on delete set null,
  candidate_id text references candidates(id) on delete set null,
  kind text not null,
  status text not null check (status in ('running','success','failed')),
  request text,
  response text,
  error text,
  started_at text not null default (now()),
  finished_at text
);
create index if not exists workflow_runs_owner_idx on workflow_runs(owner_id, started_at desc);

create table if not exists viasocket_connections (
  id text primary key default (gen_uuid()),
  owner_id text not null references users(id) on delete cascade,
  service_id text not null,
  auth_id text not null,
  script_id text,            -- credential: server side only
  config text not null default '{}',
  created_at text not null default (now()),
  unique (owner_id, service_id)
);

create table if not exists viasocket_subscriptions (
  id text primary key default (gen_uuid()),
  owner_id text not null references users(id) on delete cascade,
  drive_id text not null references drives(id) on delete cascade,
  service_id text not null,
  trigger_version_id text not null,
  script_id text not null,   -- the subscription's own id on viaSocket
  auth_id text not null,
  input_data text not null,
  handler text not null,
  status text not null default 'active' check (status in ('active','removed')),
  created_at text not null default (now())
);
create unique index if not exists viasocket_subs_active_uq on viasocket_subscriptions(drive_id, trigger_version_id) where status = 'active';

create table if not exists ingest_events (
  id text primary key default (gen_uuid()),
  owner_id text not null references users(id) on delete cascade,
  drive_id text references drives(id) on delete cascade,
  source text not null,
  outcome text not null check (outcome in ('created','duplicate','rejected','error')),
  candidate_id text references candidates(id) on delete set null,
  message text,
  payload text,
  created_at text not null default (now())
);
create index if not exists ingest_events_owner_idx on ingest_events(owner_id, created_at desc);

-- Responses whose candidate HR deleted. A form keeps returning old responses, so without this they would be re-added.
create table if not exists deleted_responses (
  drive_id text not null references drives(id) on delete cascade,
  source text not null,
  external_ref text not null,
  deleted_at text not null default (now()),
  primary key (drive_id, source, external_ref)
);

create table if not exists settings (
  owner_id text primary key references users(id) on delete cascade,
  auto_send_confirmations integer not null default 0,
  auto_queue_on_check_in integer not null default 1,
  auto_send_queue_emails integer not null default 1,
  auto_send_assignment_emails integer not null default 1
);

