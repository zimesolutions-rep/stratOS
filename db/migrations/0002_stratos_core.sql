-- StratOS core: tenants, members, pipeline, leads, interactions, scoring, cadences, tickets, consent and erasure,
-- AI usage metering. Follows the DealGuard conventions (plain SQL migrations applied by scripts/migrate.mjs,
-- `pg` queries, Better Auth user ids as text, RLS enforced by Postgres).
--
-- How RLS knows the tenant (same mechanism as DealGuard, plain Postgres, works on Neon):
-- the app connects as the database owner and, for every signed-in request, opens a transaction that runs
--   set local role stratos_app;
--   select set_config('app.user_id',   '<better-auth user id>', true);
--   select set_config('app.tenant_id', '<tenant uuid picked in the UI>', true);
-- stratos.current_tenant_id() returns that tenant ONLY if the user is an active member of it, so a forged
-- tenant id yields null and every policy hides everything. Webhooks, cron workers and migrations run as the
-- owner without that switch (the trusted "service" path) and must always filter by tenant_id themselves.
--
-- Supabase variant: replace the body of stratos.current_user_id() with `select auth.uid()::text`, drop the
-- `to stratos_app` role targets (use `to authenticated`), and point tenant_members.user_id at auth.users.
-- Nothing else in this file changes.

create extension if not exists pgcrypto;

do $$ begin create role stratos_app nologin; exception when duplicate_object then null; end $$;
grant stratos_app to current_user;

create schema if not exists stratos;
grant usage on schema stratos to stratos_app;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type stratos.industry as enum (
  'digital_marketing_agency', 'it_consulting_saas', 'recruitment_staffing', 'tech_support'
);
create type stratos.member_role as enum ('owner', 'admin', 'sales_rep', 'support_agent', 'viewer');
create type stratos.lead_source as enum (
  'facebook_lead_ads', 'instagram_lead_ads', 'google_my_business', 'website_form',
  'whatsapp', 'telecmi', 'referral', 'manual', 'api'
);
create type stratos.lead_status as enum ('active', 'won', 'lost', 'unsubscribed', 'archived');
-- DPDP / GDPR consent lifecycle. erasure_requested -> the purge worker hard-deletes the lead.
create type stratos.consent_status as enum ('unknown', 'granted', 'withdrawn', 'erasure_requested');
create type stratos.channel as enum ('call', 'meeting', 'whatsapp', 'sms', 'email', 'chat', 'note');
create type stratos.direction as enum ('inbound', 'outbound', 'internal');
create type stratos.sentiment as enum ('positive', 'neutral', 'negative');
create type stratos.step_channel as enum ('whatsapp', 'sms', 'email', 'call_task');
create type stratos.stop_reason as enum (
  'lead_responded', 'ticket_open', 'unsubscribed', 'hostile_sentiment', 'consent_withdrawn',
  'lead_closed', 'manual_pause', 'completed'
);
create type stratos.ticket_status as enum ('open', 'pending', 'resolved', 'closed');
create type stratos.ticket_priority as enum ('low', 'normal', 'high', 'urgent');
create type stratos.dispatch_status as enum ('sent', 'skipped', 'failed');

-- ---------------------------------------------------------------------------
-- Identity helpers
-- ---------------------------------------------------------------------------

-- The signed-in user's id for this transaction, or null on the service path.
create function stratos.current_user_id() returns text
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')
$$;

create function stratos.is_service() returns boolean
language sql stable as $$
  select stratos.current_user_id() is null
$$;

-- ---------------------------------------------------------------------------
-- Tenants (workspaces) and members
-- ---------------------------------------------------------------------------

create table stratos.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
  industry stratos.industry not null,
  -- White-label: logo, colors, sender names. Never secrets.
  branding jsonb not null default '{}',
  -- Which regimes this tenant must satisfy; drives retention and masking defaults in the app.
  compliance_regimes text[] not null default '{dpdp}'
    check (compliance_regimes <@ array['dpdp', 'gdpr', 'hipaa']::text[]),
  data_region text not null default 'in' check (data_region in ('in', 'eu', 'us')),
  -- Leads with no activity for this many days are queued for purge (null = keep until erasure request).
  retention_days int check (retention_days is null or retention_days between 30 and 3650),
  default_currency text not null default 'INR' check (default_currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'Asia/Kolkata',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table stratos.tenant_members (
  tenant_id uuid not null references stratos.tenants (id) on delete cascade,
  user_id text not null references public."user" (id) on delete cascade,
  role stratos.member_role not null default 'sales_rep',
  display_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_members_user_idx on stratos.tenant_members (user_id) where active;

-- security definer so policies can read membership without recursing into tenant_members' own RLS.
create function stratos.current_tenant_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.tenant_id from stratos.tenant_members m
  where m.user_id = stratos.current_user_id()
    and m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and m.active
$$;

create function stratos.my_role() returns stratos.member_role
language sql stable security definer set search_path = '' as $$
  select m.role from stratos.tenant_members m
  where m.user_id = stratos.current_user_id() and m.tenant_id = stratos.current_tenant_id()
$$;

create function stratos.can_write() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(stratos.my_role() in ('owner', 'admin', 'sales_rep', 'support_agent'), false)
$$;

create function stratos.is_tenant_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(stratos.my_role() in ('owner', 'admin'), false)
$$;

grant execute on function stratos.current_user_id(), stratos.is_service(), stratos.current_tenant_id(),
  stratos.my_role(), stratos.can_write(), stratos.is_tenant_admin() to stratos_app;

-- ---------------------------------------------------------------------------
-- Industry templates (global reference data, read-only to the app)
-- ---------------------------------------------------------------------------

create table stratos.industry_templates (
  industry stratos.industry primary key,
  -- [{key, name, probability, is_won, is_lost}]
  stages jsonb not null,
  -- [{key, name, description, steps: [{channel, delay_minutes, template_name, body}]}]
  cadences jsonb not null,
  -- {rule_key: delta}, e.g. {"source:website_form": 30, "call_answered": 15, ...}
  scoring jsonb not null
);

-- ---------------------------------------------------------------------------
-- Pipeline, scoring rules
-- ---------------------------------------------------------------------------

create table stratos.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references stratos.tenants (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]+$'),
  name text not null check (length(trim(name)) > 0),
  position int not null,
  -- Typical win probability at this stage (a floor the scorer never drops an open lead below).
  probability numeric(5, 2) not null default 0 check (probability between 0 and 100),
  is_won boolean not null default false,
  is_lost boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, key),
  unique (id, tenant_id),
  check (not (is_won and is_lost))
);
create index pipeline_stages_tenant_idx on stratos.pipeline_stages (tenant_id, position);

-- Per-tenant scoring weights. rule_key: 'source:<lead_source>' (baseline, absolute), or a delta rule such as
-- 'call_answered', 'call_missed', 'sentiment_positive', 'sentiment_negative', 'inbound_reply', 'inactivity_48h'.
create table stratos.scoring_rules (
  tenant_id uuid not null references stratos.tenants (id) on delete cascade,
  rule_key text not null check (rule_key ~ '^[a-z0-9_:]+$'),
  value numeric(6, 2) not null check (value between -100 and 100),
  primary key (tenant_id, rule_key)
);

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------

create table stratos.leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references stratos.tenants (id) on delete cascade,
  full_name text,
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'), -- E.164
  company text,
  job_title text,
  source stratos.lead_source not null default 'manual',
  -- The provider's own id (Meta leadgen_id, GMB message id, form submission id) for idempotent ingestion.
  source_ref text,
  source_meta jsonb not null default '{}', -- campaign, ad, form, UTM; no free-text PII
  stage_id uuid,
  status stratos.lead_status not null default 'active',
  owner_id text references public."user" (id) on delete set null,
  contract_value numeric(14, 2) check (contract_value is null or contract_value >= 0),
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  baseline_probability numeric(5, 2) not null default 0 check (baseline_probability between 0 and 100),
  conversion_probability numeric(5, 2) not null default 0 check (conversion_probability between 0 and 100),
  last_activity_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  last_decay_at timestamptz,
  consent_status stratos.consent_status not null default 'unknown',
  consent_updated_at timestamptz,
  -- How consent was captured: {source, text_version, ip_hash, at}. Kept for DPDP / GDPR proof.
  consent_evidence jsonb not null default '{}',
  -- HIPAA: true when the lead record may contain PHI. Forces strict masking before any AI call.
  contains_phi boolean not null default false,
  custom_fields jsonb not null default '{}',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (stage_id, tenant_id) references stratos.pipeline_stages (id, tenant_id),
  check (email is not null or phone is not null or full_name is not null)
);
create unique index leads_source_ref_uidx on stratos.leads (tenant_id, source, source_ref) where source_ref is not null;
create index leads_tenant_stage_idx on stratos.leads (tenant_id, stage_id);
create index leads_tenant_owner_idx on stratos.leads (tenant_id, owner_id);
create index leads_tenant_phone_idx on stratos.leads (tenant_id, phone);
create index leads_tenant_email_idx on stratos.leads (tenant_id, lower(email));
create index leads_inactive_idx on stratos.leads (last_activity_at) where status = 'active';
create index leads_company_idx on stratos.leads (tenant_id, lower(company));

-- Every change to conversion_probability, with its reason, so reps can see why a score moved.
create table stratos.score_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references stratos.tenants (id) on delete cascade,
  lead_id uuid not null,
  rule_key text not null,
  delta numeric(6, 2) not null,
  score_before numeric(5, 2) not null,
  score_after numeric(5, 2) not null,
  interaction_id uuid,
  created_at timestamptz not null default now(),
  foreign key (lead_id, tenant_id) references stratos.leads (id, tenant_id) on delete cascade
);
create index score_events_lead_idx on stratos.score_events (lead_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Interactions (calls, meetings, WhatsApp, SMS, email, notes)
-- ---------------------------------------------------------------------------

create table stratos.interactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references stratos.tenants (id) on delete cascade,
  lead_id uuid not null,
  channel stratos.channel not null,
  direction stratos.direction not null,
  occurred_at timestamptz not null default now(),
  -- Provider dedupe key: TeleCMI call id, Meta wamid, Evolution message id. Webhook retries upsert on it.
  provider text check (provider is null or provider in ('telecmi', 'meta', 'evolution', 'email', 'manual')),
  provider_ref text,
  answered boolean,                   -- calls: did the lead pick up
  duration_seconds int check (duration_seconds is null or duration_seconds >= 0),
  body text,                          -- message text or rep notes
  recording_url text,                 -- provider URL; never sent to an AI endpoint unmasked
  transcript text,
  -- AI enrichment (Step 3)
  sentiment stratos.sentiment,
  summary text,
  follow_up_required boolean,
  ai_status text not null default 'none' check (ai_status in ('none', 'queued', 'done', 'failed', 'skipped')),
  ai_model text,
  ai_processed_at timestamptz,
  actor_id text references public."user" (id) on delete set null,
  cadence_state_id uuid,              -- set when sent by the cadence engine
  created_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (lead_id, tenant_id) references stratos.leads (id, tenant_id) on delete cascade
);
create unique index interactions_provider_uidx on stratos.interactions (tenant_id, provider, provider_ref)
  where provider_ref is not null;
create index interactions_lead_idx on stratos.interactions (lead_id, occurred_at desc);
create index interactions_ai_queue_idx on stratos.interactions (ai_status, created_at) where ai_status = 'queued';

alter table stratos.score_events
  add foreign key (interaction_id, tenant_id) references stratos.interactions (id, tenant_id) on delete set null (interaction_id);

-- ---------------------------------------------------------------------------
-- Tickets
-- ---------------------------------------------------------------------------

create table stratos.tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references stratos.tenants (id) on delete cascade,
  lead_id uuid,
  number int not null,
  subject text not null check (length(trim(subject)) > 0),
  description text,
  status stratos.ticket_status not null default 'open',
  priority stratos.ticket_priority not null default 'normal',
  assignee_id text references public."user" (id) on delete set null,
  resolved_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, number),
  unique (id, tenant_id),
  foreign key (lead_id, tenant_id) references stratos.leads (id, tenant_id) on delete cascade
);
create index tickets_tenant_status_idx on stratos.tickets (tenant_id, status);
create index tickets_lead_open_idx on stratos.tickets (lead_id) where status in ('open', 'pending');

-- ---------------------------------------------------------------------------
-- Cadences
-- ---------------------------------------------------------------------------

create table stratos.cadences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references stratos.tenants (id) on delete cascade,
  key text check (key is null or key ~ '^[a-z0-9_]+$'), -- template key when seeded from an industry
  name text not null check (length(trim(name)) > 0),
  description text,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key),
  unique (id, tenant_id)
);

create table stratos.cadence_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  cadence_id uuid not null,
  position int not null check (position >= 1),
  channel stratos.step_channel not null,
  -- Wait after the previous step (or after enrolment for step 1).
  delay_minutes int not null default 0 check (delay_minutes >= 0),
  -- Meta-approved WhatsApp template name (required outside the 24h service window), or SMS/email template id.
  template_name text,
  body text, -- with {{first_name}}, {{company}}, {{rep_name}} placeholders
  -- Only send between these local hours (tenant timezone).
  send_window_start smallint not null default 9 check (send_window_start between 0 and 23),
  send_window_end smallint not null default 19 check (send_window_end between 1 and 24),
  created_at timestamptz not null default now(),
  unique (cadence_id, position),
  foreign key (cadence_id, tenant_id) references stratos.cadences (id, tenant_id) on delete cascade
);

-- One row per (lead, cadence) enrolment. next_step is the position of the next step to send;
-- pausing never moves it, so a resume continues with the next sequential step.
create table stratos.lead_cadence_state (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  lead_id uuid not null,
  cadence_id uuid not null,
  next_step int not null default 1 check (next_step >= 1),
  next_run_at timestamptz not null default now(),
  cadence_active boolean not null default true,
  stop_reason stratos.stop_reason,
  stopped_at timestamptz,
  paused_by_ticket_id uuid,
  -- Start of the current active run (enrolment or last resume). Replies and sentiment before it are ignored.
  active_since timestamptz not null default now(),
  completed_at timestamptz,
  locked_until timestamptz,           -- worker lease, so overlapping cron runs never double-send
  enrolled_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, cadence_id),
  unique (id, tenant_id),
  foreign key (lead_id, tenant_id) references stratos.leads (id, tenant_id) on delete cascade,
  foreign key (cadence_id, tenant_id) references stratos.cadences (id, tenant_id) on delete cascade,
  check (cadence_active or stop_reason is not null)
);
create index lead_cadence_due_idx on stratos.lead_cadence_state (next_run_at)
  where cadence_active and completed_at is null;
create index lead_cadence_lead_idx on stratos.lead_cadence_state (lead_id);

alter table stratos.interactions
  add foreign key (cadence_state_id, tenant_id) references stratos.lead_cadence_state (id, tenant_id)
  on delete set null (cadence_state_id);

-- Dispatch log for every attempt (sent, skipped by validation, failed at the provider).
create table stratos.cadence_dispatches (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  state_id uuid not null,
  step_position int not null,
  channel stratos.step_channel not null,
  status stratos.dispatch_status not null,
  skip_reason stratos.stop_reason,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  foreign key (state_id, tenant_id) references stratos.lead_cadence_state (id, tenant_id) on delete cascade
);
-- A step is sent at most once per enrolment; skipped and failed attempts stay in the log.
create unique index cadence_dispatches_sent_uidx on stratos.cadence_dispatches (state_id, step_position)
  where status = 'sent';

-- ---------------------------------------------------------------------------
-- Compliance: erasure requests, inbound credentials, AI usage metering, AI chat audit
-- ---------------------------------------------------------------------------

-- Survives the lead's hard delete: holds only hashes, never the PII itself.
create table stratos.erasure_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references stratos.tenants (id) on delete cascade,
  lead_id uuid,                        -- null once erased
  subject_hash text not null,          -- sha256 of lower(email) || '|' || phone, to prove the erasure later
  reason text not null default 'subject_request' check (reason in ('subject_request', 'retention_expired', 'admin')),
  requested_by text,
  requested_at timestamptz not null default now(),
  due_by timestamptz not null default now() + interval '30 days', -- GDPR one-month deadline
  processed_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  error text
);
create index erasure_requests_pending_idx on stratos.erasure_requests (requested_at) where status = 'pending';

-- Per-tenant inbound webhook tokens. /api/v1/webhooks/inbound/[source]?t=<token>; only sha256 is stored.
create table stratos.inbound_endpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references stratos.tenants (id) on delete cascade,
  source stratos.lead_source not null,
  token_hash text not null unique,
  label text,
  -- Non-secret routing config, e.g. Meta page_id / form_id, default cadence key, default owner.
  config jsonb not null default '{}',
  active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index inbound_endpoints_tenant_idx on stratos.inbound_endpoints (tenant_id);
-- Meta sends one webhook per app; route by page_id to the tenant.
create unique index inbound_endpoints_meta_page_uidx on stratos.inbound_endpoints ((config ->> 'page_id'))
  where config ? 'page_id' and active;

-- Metered AI consumption under the single developer key, billed back per tenant.
create table stratos.ai_usage (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references stratos.tenants (id) on delete cascade,
  provider text not null check (provider in ('groq', 'deepinfra', 'openai')),
  model text not null,
  purpose text not null check (purpose in ('transcription', 'sentiment', 'chat', 'summary')),
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  audio_seconds int not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  user_id text,
  created_at timestamptz not null default now()
);
create index ai_usage_tenant_month_idx on stratos.ai_usage (tenant_id, created_at);

-- Ambient AI sidebar: every tool call that mutates CRM data is recorded (arguments already PII-masked).
create table stratos.ai_tool_calls (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references stratos.tenants (id) on delete cascade,
  user_id text not null,
  tool text not null,
  args jsonb not null default '{}',
  result jsonb not null default '{}',
  lead_id uuid,
  created_at timestamptz not null default now()
);
create index ai_tool_calls_tenant_idx on stratos.ai_tool_calls (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers: timestamps, tenant stamping, ticket numbers
-- ---------------------------------------------------------------------------

create function stratos.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger tenants_touch before update on stratos.tenants for each row execute function stratos.touch_updated_at();
create trigger leads_touch before update on stratos.leads for each row execute function stratos.touch_updated_at();
create trigger tickets_touch before update on stratos.tickets for each row execute function stratos.touch_updated_at();
create trigger cadences_touch before update on stratos.cadences for each row execute function stratos.touch_updated_at();
create trigger lcs_touch before update on stratos.lead_cadence_state for each row execute function stratos.touch_updated_at();

-- tenant_id (and created_by where present) always come from the session, never from the request body.
create function stratos.stamp_tenant() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not stratos.is_service() then
    new.tenant_id := stratos.current_tenant_id();
    if new.tenant_id is null then
      raise exception 'No active tenant for this session' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create function stratos.stamp_creator() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not stratos.is_service() then
    new.created_by := stratos.current_user_id();
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['pipeline_stages', 'scoring_rules', 'leads', 'score_events', 'interactions', 'tickets',
    'cadences', 'cadence_steps', 'lead_cadence_state', 'cadence_dispatches', 'erasure_requests',
    'inbound_endpoints', 'ai_usage', 'ai_tool_calls'] loop
    execute format('create trigger %I before insert on stratos.%I for each row execute function stratos.stamp_tenant()',
      t || '_stamp_tenant', t);
  end loop;
  foreach t in array array['leads', 'tickets', 'cadences'] loop
    execute format('create trigger %I before insert on stratos.%I for each row execute function stratos.stamp_creator()',
      t || '_stamp_creator', t);
  end loop;
end $$;

-- Tenant can never change on update.
create function stratos.freeze_tenant() returns trigger
language plpgsql as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id cannot change' using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['pipeline_stages', 'scoring_rules', 'leads', 'interactions', 'tickets', 'cadences',
    'cadence_steps', 'lead_cadence_state', 'inbound_endpoints'] loop
    execute format('create trigger %I before update on stratos.%I for each row execute function stratos.freeze_tenant()',
      t || '_freeze_tenant', t);
  end loop;
end $$;

-- Ticket numbers per tenant (T-1, T-2, ...).
create function stratos.number_ticket() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text, 42));
  select coalesce(max(number), 0) + 1 into new.number from stratos.tickets where tenant_id = new.tenant_id;
  if new.status in ('resolved', 'closed') then new.resolved_at := coalesce(new.resolved_at, now()); end if;
  return new;
end $$;

-- Postgres fires same-event triggers in name order, so the "zz" prefix runs this after tickets_stamp_tenant.
create trigger tickets_zz_number before insert on stratos.tickets
  for each row execute function stratos.number_ticket();

-- ---------------------------------------------------------------------------
-- Scoring
-- ---------------------------------------------------------------------------

create function stratos.rule_value(p_tenant uuid, p_rule text) returns numeric
language sql stable security definer set search_path = '' as $$
  select value from stratos.scoring_rules where tenant_id = p_tenant and rule_key = p_rule
$$;

-- Applies a scoring rule to a lead: clamps to 0..100, never below the open stage's floor, logs a score_event.
-- Returns the new score, or null when the tenant has no such rule.
create function stratos.apply_score(p_lead uuid, p_rule text, p_interaction uuid default null)
returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  v_lead stratos.leads;
  v_delta numeric;
  v_floor numeric := 0;
  v_after numeric;
begin
  select * into v_lead from stratos.leads where id = p_lead for update;
  if not found then return null; end if;
  -- A signed-in caller may only score leads in their own tenant.
  if not stratos.is_service() and v_lead.tenant_id is distinct from stratos.current_tenant_id() then
    raise exception 'Lead not found' using errcode = '42501';
  end if;
  v_delta := stratos.rule_value(v_lead.tenant_id, p_rule);
  if v_delta is null then return null; end if;

  select coalesce(s.probability, 0) into v_floor from stratos.pipeline_stages s
  where s.id = v_lead.stage_id and not s.is_lost;
  v_after := greatest(coalesce(v_floor, 0), least(100, v_lead.conversion_probability + v_delta));
  if v_after = v_lead.conversion_probability then return v_after; end if;

  update stratos.leads set conversion_probability = v_after where id = p_lead;
  insert into stratos.score_events (tenant_id, lead_id, rule_key, delta, score_before, score_after, interaction_id)
  values (v_lead.tenant_id, p_lead, p_rule, v_after - v_lead.conversion_probability,
          v_lead.conversion_probability, v_after, p_interaction);
  return v_after;
end $$;

-- Baseline from the inbound channel, set once when the lead is created.
create function stratos.set_baseline_score() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v numeric;
begin
  v := stratos.rule_value(new.tenant_id, 'source:' || new.source::text);
  if v is not null and new.conversion_probability = 0 then
    new.baseline_probability := greatest(0, least(100, v));
    new.conversion_probability := new.baseline_probability;
  end if;
  return new;
end $$;

create trigger leads_zz_baseline before insert on stratos.leads
  for each row execute function stratos.set_baseline_score();

-- Service path, called by the cron worker: -inactivity_48h for every active lead quiet for 48h, at most once per 48h.
create function stratos.decay_inactive_leads(p_limit int default 500) returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  if not stratos.is_service() then raise exception 'service only' using errcode = '42501'; end if;
  for r in
    select id from stratos.leads
    where status = 'active'
      and last_activity_at < now() - interval '48 hours'
      and (last_decay_at is null or last_decay_at < now() - interval '48 hours')
    order by last_activity_at
    limit p_limit
    for update skip locked
  loop
    perform stratos.apply_score(r.id, 'inactivity_48h');
    update stratos.leads set last_decay_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Cadence stop triggers (the state machine lives in Postgres so no code path can skip it)
-- ---------------------------------------------------------------------------

-- The single source of truth for "may we message this lead now?". Returns the stop reason, or null when clear.
-- The cadence worker calls this inside its claim transaction immediately before every dispatch.
create function stratos.cadence_stop_reason(p_state uuid) returns stratos.stop_reason
language sql stable security definer set search_path = '' as $$
  select case
    when l.consent_status in ('withdrawn', 'erasure_requested') then 'consent_withdrawn'::stratos.stop_reason
    when l.status = 'unsubscribed' then 'unsubscribed'
    when l.status in ('won', 'lost', 'archived') then 'lead_closed'
    when exists (select 1 from stratos.tickets t where t.lead_id = l.id and t.status in ('open', 'pending'))
      then 'ticket_open'
    when (select i.sentiment from stratos.interactions i
          where i.lead_id = l.id and i.sentiment is not null and i.occurred_at >= s.active_since
          order by i.occurred_at desc limit 1) = 'negative'
      then 'hostile_sentiment'
    when l.last_inbound_at > s.active_since then 'lead_responded'
  end
  from stratos.lead_cadence_state s join stratos.leads l on l.id = s.lead_id
  where s.id = p_state
$$;

create function stratos.stop_cadences(p_lead uuid, p_reason stratos.stop_reason, p_ticket uuid default null)
returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update stratos.lead_cadence_state
  set cadence_active = false, stop_reason = p_reason, stopped_at = now(),
      paused_by_ticket_id = case when p_reason = 'ticket_open' then p_ticket else paused_by_ticket_id end
  where lead_id = p_lead and cadence_active and completed_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Leads: unsubscribe, consent withdrawal, closing the deal.
create function stratos.on_lead_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_stage stratos.pipeline_stages;
begin
  if new.consent_status is distinct from old.consent_status then
    new.consent_updated_at := now();
  end if;
  -- Moving a lead into a stage lifts its score to that stage's floor (a won stage means 100).
  if new.stage_id is distinct from old.stage_id and new.stage_id is not null then
    select * into v_stage from stratos.pipeline_stages where id = new.stage_id;
    if v_stage.is_won then
      new.conversion_probability := 100;
      new.status := 'won';
    elsif not v_stage.is_lost then
      new.conversion_probability := greatest(new.conversion_probability, v_stage.probability);
    else
      new.status := 'lost';
    end if;
    new.last_activity_at := now();
  end if;
  return new;
end $$;
create trigger leads_consent_stamp before update on stratos.leads
  for each row execute function stratos.on_lead_change();

create function stratos.after_lead_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.conversion_probability is distinct from old.conversion_probability and new.stage_id is distinct from old.stage_id then
    insert into stratos.score_events (tenant_id, lead_id, rule_key, delta, score_before, score_after)
    values (new.tenant_id, new.id, 'stage_floor', new.conversion_probability - old.conversion_probability,
            old.conversion_probability, new.conversion_probability);
  end if;
  if new.consent_status in ('withdrawn', 'erasure_requested') and old.consent_status is distinct from new.consent_status then
    perform stratos.stop_cadences(new.id, 'consent_withdrawn');
  elsif new.status = 'unsubscribed' and old.status is distinct from new.status then
    perform stratos.stop_cadences(new.id, 'unsubscribed');
  elsif new.status in ('won', 'lost', 'archived') and old.status is distinct from new.status then
    perform stratos.stop_cadences(new.id, 'lead_closed');
  end if;
  if new.consent_status = 'erasure_requested' and old.consent_status is distinct from new.consent_status then
    insert into stratos.erasure_requests (tenant_id, lead_id, subject_hash, requested_by)
    values (new.tenant_id, new.id,
            encode(sha256(convert_to(coalesce(lower(new.email), '') || '|' || coalesce(new.phone, ''), 'UTF8')), 'hex'),
            stratos.current_user_id());
  end if;
  return null;
end $$;
create trigger leads_after_change after update on stratos.leads
  for each row execute function stratos.after_lead_change();

-- Interactions: inbound replies stop cadences, any activity resets inactivity, scoring and hostile sentiment.
create function stratos.after_interaction() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update stratos.leads set
      last_activity_at = greatest(last_activity_at, new.occurred_at),
      last_inbound_at = case when new.direction = 'inbound' then greatest(coalesce(last_inbound_at, new.occurred_at), new.occurred_at)
                             else last_inbound_at end
    where id = new.lead_id;

    if new.direction = 'inbound' and new.channel in ('whatsapp', 'sms', 'chat', 'email') then
      perform stratos.stop_cadences(new.lead_id, 'lead_responded');
      perform stratos.apply_score(new.lead_id, 'inbound_reply', new.id);
    end if;
    if new.channel = 'call' and new.answered is true then
      perform stratos.apply_score(new.lead_id, 'call_answered', new.id);
    elsif new.channel = 'call' and new.answered is false and new.direction = 'outbound' then
      perform stratos.apply_score(new.lead_id, 'call_missed', new.id);
    end if;
  end if;

  -- Sentiment arrives later (Step 3 AI pipeline) as an update; score it once.
  if new.sentiment is not null and (tg_op = 'INSERT' or old.sentiment is distinct from new.sentiment) then
    perform stratos.apply_score(new.lead_id, 'sentiment_' || new.sentiment::text, new.id);
    if new.sentiment = 'negative' then
      perform stratos.stop_cadences(new.lead_id, 'hostile_sentiment');
    end if;
  end if;
  return null;
end $$;
create trigger interactions_after after insert or update of sentiment on stratos.interactions
  for each row execute function stratos.after_interaction();

-- Tickets: an unresolved ticket pauses the lead's cadences; resolving the last one resumes those it paused.
create function stratos.before_ticket_update() returns trigger
language plpgsql as $$
begin
  if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then
    new.resolved_at := now();
  elsif new.status in ('open', 'pending') then
    new.resolved_at := null;
  end if;
  return new;
end $$;
create trigger tickets_resolved_stamp before update on stratos.tickets
  for each row execute function stratos.before_ticket_update();

create function stratos.after_ticket_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.lead_id is null then return null; end if;

  if new.status in ('open', 'pending') and (tg_op = 'INSERT' or old.status in ('resolved', 'closed')) then
    perform stratos.stop_cadences(new.lead_id, 'ticket_open', new.id);
  elsif tg_op = 'UPDATE' and new.status = 'resolved' and old.status in ('open', 'pending')
        and not exists (select 1 from stratos.tickets t
                        where t.lead_id = new.lead_id and t.id <> new.id and t.status in ('open', 'pending')) then
    -- Resume only enrolments paused for a ticket, and only if nothing else would stop them now.
    update stratos.lead_cadence_state s
    set cadence_active = true, stop_reason = null, stopped_at = null, paused_by_ticket_id = null,
        active_since = now(), next_run_at = greatest(s.next_run_at, now())
    where s.lead_id = new.lead_id and not s.cadence_active and s.completed_at is null
      and s.stop_reason = 'ticket_open';
    -- Re-stop any whose lead is otherwise blocked (unsubscribed, hostile, consent) so the reason stays truthful.
    update stratos.lead_cadence_state s
    set cadence_active = false, stop_reason = stratos.cadence_stop_reason(s.id), stopped_at = now()
    where s.lead_id = new.lead_id and s.cadence_active and stratos.cadence_stop_reason(s.id) is not null;
  end if;
  return null;
end $$;
create trigger tickets_after_change after insert or update of status on stratos.tickets
  for each row execute function stratos.after_ticket_change();

-- ---------------------------------------------------------------------------
-- Cadence worker (service path only)
-- ---------------------------------------------------------------------------

-- Leases due enrolments for 5 minutes. Overlapping cron invocations never see the same row.
create function stratos.claim_due_cadences(p_limit int default 100)
returns table (state_id uuid, tenant_id uuid, lead_id uuid, cadence_id uuid, step_position int)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not stratos.is_service() then raise exception 'service only' using errcode = '42501'; end if;
  return query
  with due as (
    select s.id from stratos.lead_cadence_state s
    join stratos.cadences c on c.id = s.cadence_id and c.active
    where s.cadence_active and s.completed_at is null and s.next_run_at <= now()
      and (s.locked_until is null or s.locked_until < now())
    order by s.next_run_at
    limit p_limit
    for update of s skip locked
  )
  update stratos.lead_cadence_state s set locked_until = now() + interval '5 minutes'
  from due where s.id = due.id
  returning s.id, s.tenant_id, s.lead_id, s.cadence_id, s.next_step;
end $$;

-- Records the outcome of one step and moves the pointer. Idempotent per (state, step).
create function stratos.record_dispatch(
  p_state uuid, p_step int, p_status stratos.dispatch_status,
  p_provider_message_id text default null, p_error text default null, p_skip_reason stratos.stop_reason default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_state stratos.lead_cadence_state;
  v_next stratos.cadence_steps;
  v_step stratos.cadence_steps;
begin
  if not stratos.is_service() then raise exception 'service only' using errcode = '42501'; end if;
  select * into v_state from stratos.lead_cadence_state where id = p_state for update;
  select * into v_step from stratos.cadence_steps where cadence_id = v_state.cadence_id and position = p_step;

  if v_state.next_step <> p_step then return; end if; -- stale worker: the pointer already moved

  insert into stratos.cadence_dispatches (tenant_id, state_id, step_position, channel, status, skip_reason, provider_message_id, error)
  values (v_state.tenant_id, p_state, p_step, v_step.channel, p_status, p_skip_reason, p_provider_message_id, p_error)
  on conflict (state_id, step_position) where status = 'sent' do nothing;

  if p_status = 'skipped' then
    -- Validation failed at dispatch time: stop, keep the pointer so a resume sends this same step.
    update stratos.lead_cadence_state set cadence_active = false, stop_reason = coalesce(p_skip_reason, 'manual_pause'),
      stopped_at = now(), locked_until = null where id = p_state;
    return;
  elsif p_status = 'failed' then
    -- Retry in 30 minutes.
    update stratos.lead_cadence_state set next_run_at = now() + interval '30 minutes', locked_until = null where id = p_state;
    return;
  end if;

  select * into v_next from stratos.cadence_steps where cadence_id = v_state.cadence_id and position > p_step
  order by position limit 1;
  if found then
    update stratos.lead_cadence_state set next_step = v_next.position,
      next_run_at = now() + make_interval(mins => v_next.delay_minutes), locked_until = null
    where id = p_state;
  else
    update stratos.lead_cadence_state set completed_at = now(), cadence_active = false, stop_reason = 'completed',
      stopped_at = now(), locked_until = null
    where id = p_state;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Erasure (service path only): hard delete, keep only the hashed proof
-- ---------------------------------------------------------------------------

create function stratos.process_erasure(p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_req stratos.erasure_requests;
begin
  if not stratos.is_service() then raise exception 'service only' using errcode = '42501'; end if;
  select * into v_req from stratos.erasure_requests where id = p_request and status = 'pending' for update skip locked;
  if not found then return; end if;
  -- Cascades to interactions, score_events, lead_cadence_state, cadence_dispatches and tickets.
  delete from stratos.leads where id = v_req.lead_id and tenant_id = v_req.tenant_id;
  update stratos.ai_tool_calls set args = '{}'::jsonb, result = '{}'::jsonb
  where tenant_id = v_req.tenant_id and lead_id = v_req.lead_id;
  update stratos.erasure_requests set status = 'done', processed_at = now(), lead_id = null where id = p_request;
end $$;

-- Retention: queue purge for leads idle past the tenant's retention_days.
create function stratos.queue_retention_purges(p_limit int default 500) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not stratos.is_service() then raise exception 'service only' using errcode = '42501'; end if;
  with expired as (
    select l.id, l.tenant_id, l.email, l.phone from stratos.leads l
    join stratos.tenants t on t.id = l.tenant_id
    where t.retention_days is not null and l.status <> 'active'
      and l.last_activity_at < now() - make_interval(days => t.retention_days)
      and not exists (select 1 from stratos.erasure_requests e where e.lead_id = l.id and e.status = 'pending')
    limit p_limit
  )
  insert into stratos.erasure_requests (tenant_id, lead_id, subject_hash, reason)
  select tenant_id, id, encode(sha256(convert_to(coalesce(lower(email), '') || '|' || coalesce(phone, ''), 'UTF8')), 'hex'),
         'retention_expired'
  from expired;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Onboarding: create a tenant and seed it from its industry template
-- ---------------------------------------------------------------------------

create function stratos.seed_tenant(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tpl stratos.industry_templates;
  v_cad jsonb;
  v_cad_id uuid;
begin
  select tpl.* into v_tpl from stratos.industry_templates tpl
  join stratos.tenants t on t.industry = tpl.industry where t.id = p_tenant;
  if not found then raise exception 'No template for this tenant''s industry'; end if;

  insert into stratos.pipeline_stages (tenant_id, key, name, position, probability, is_won, is_lost)
  select p_tenant, s ->> 'key', s ->> 'name', ord::int, coalesce((s ->> 'probability')::numeric, 0),
         coalesce((s ->> 'is_won')::boolean, false), coalesce((s ->> 'is_lost')::boolean, false)
  from jsonb_array_elements(v_tpl.stages) with ordinality as x(s, ord)
  on conflict (tenant_id, key) do nothing;

  insert into stratos.scoring_rules (tenant_id, rule_key, value)
  select p_tenant, k, v::numeric from jsonb_each_text(v_tpl.scoring) as x(k, v)
  on conflict (tenant_id, rule_key) do nothing;

  for v_cad in select * from jsonb_array_elements(v_tpl.cadences) loop
    insert into stratos.cadences (tenant_id, key, name, description)
    values (p_tenant, v_cad ->> 'key', v_cad ->> 'name', v_cad ->> 'description')
    on conflict (tenant_id, key) do nothing
    returning id into v_cad_id;
    if v_cad_id is not null then
      insert into stratos.cadence_steps (tenant_id, cadence_id, position, channel, delay_minutes, template_name, body)
      select p_tenant, v_cad_id, ord::int, (st ->> 'channel')::stratos.step_channel,
             coalesce((st ->> 'delay_minutes')::int, 0), st ->> 'template_name', st ->> 'body'
      from jsonb_array_elements(v_cad -> 'steps') with ordinality as y(st, ord);
    end if;
  end loop;
end $$;

-- Called by a signed-in user during onboarding. Creates the tenant, makes the caller its owner, seeds it.
create function stratos.create_tenant(p_name text, p_slug text, p_industry stratos.industry,
                                      p_regimes text[] default '{dpdp}', p_region text default 'in')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_user text := stratos.current_user_id();
begin
  if v_user is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  insert into stratos.tenants (name, slug, industry, compliance_regimes, data_region, created_by)
  values (p_name, lower(p_slug), p_industry, p_regimes, p_region, v_user)
  returning id into v_id;
  insert into stratos.tenant_members (tenant_id, user_id, role) values (v_id, v_user, 'owner');
  -- Switch this transaction to the new tenant so the seed rows are stamped with it.
  perform set_config('app.tenant_id', v_id::text, true);
  perform stratos.seed_tenant(v_id);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Enrolment, pause and resume (used by the UI and the AI sidebar's pauseCadence tool)
-- ---------------------------------------------------------------------------

-- First send waits for step 1's delay.
create function stratos.before_enrol() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_delay int;
begin
  select delay_minutes into v_delay from stratos.cadence_steps where cadence_id = new.cadence_id and position = 1;
  new.next_step := 1;
  new.next_run_at := now() + make_interval(mins => coalesce(v_delay, 0));
  new.active_since := now();
  if not stratos.is_service() then new.enrolled_by := stratos.current_user_id(); end if;
  return new;
end $$;
create trigger lcs_zz_enrol before insert on stratos.lead_cadence_state
  for each row execute function stratos.before_enrol();

-- A lead that is already blocked (open ticket, unsubscribed, no consent) is enrolled stopped, with the reason.
create function stratos.after_enrol() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_reason stratos.stop_reason := stratos.cadence_stop_reason(new.id);
begin
  if v_reason is not null then
    update stratos.lead_cadence_state set cadence_active = false, stop_reason = v_reason, stopped_at = now()
    where id = new.id;
  end if;
  return null;
end $$;
create trigger lcs_after_enrol after insert on stratos.lead_cadence_state
  for each row execute function stratos.after_enrol();

create function stratos.pause_cadence(p_state uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not stratos.can_write() then raise exception 'Not allowed' using errcode = '42501'; end if;
  update stratos.lead_cadence_state set cadence_active = false, stop_reason = 'manual_pause', stopped_at = now()
  where id = p_state and tenant_id = stratos.current_tenant_id() and cadence_active;
end $$;

-- Resumes from the next unsent step. Refuses (and says why) if a stop trigger still applies.
create function stratos.resume_cadence(p_state uuid) returns stratos.stop_reason
language plpgsql security definer set search_path = '' as $$
declare v_reason stratos.stop_reason;
begin
  if not stratos.can_write() then raise exception 'Not allowed' using errcode = '42501'; end if;
  update stratos.lead_cadence_state
  set cadence_active = true, stop_reason = null, stopped_at = null, paused_by_ticket_id = null,
      active_since = now(), next_run_at = greatest(next_run_at, now())
  where id = p_state and tenant_id = stratos.current_tenant_id() and not cadence_active and completed_at is null;
  if not found then return null; end if;
  v_reason := stratos.cadence_stop_reason(p_state);
  if v_reason is not null then
    update stratos.lead_cadence_state set cadence_active = false, stop_reason = v_reason, stopped_at = now()
    where id = p_state;
  end if;
  return v_reason;
end $$;

revoke execute on all functions in schema stratos from public;
grant execute on function stratos.current_user_id(), stratos.is_service(), stratos.current_tenant_id(),
  stratos.my_role(), stratos.can_write(), stratos.is_tenant_admin(), stratos.apply_score(uuid, text, uuid),
  stratos.cadence_stop_reason(uuid), stratos.create_tenant(text, text, stratos.industry, text[], text),
  stratos.pause_cadence(uuid), stratos.resume_cadence(uuid)
  to stratos_app;
-- Trigger functions run as their owner; they need no grant.

-- ---------------------------------------------------------------------------
-- Row level security: every StratOS table, scoped to stratos.current_tenant_id(). Not FORCEd: the owner is the
-- trusted service path, exactly as in DealGuard.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['tenants', 'tenant_members', 'industry_templates', 'pipeline_stages', 'scoring_rules',
    'leads', 'score_events', 'interactions', 'tickets', 'cadences', 'cadence_steps', 'lead_cadence_state',
    'cadence_dispatches', 'erasure_requests', 'inbound_endpoints', 'ai_usage', 'ai_tool_calls'] loop
    execute format('alter table stratos.%I enable row level security', t);
  end loop;
end $$;

create policy "tenants: members read" on stratos.tenants for select to stratos_app
  using (id = stratos.current_tenant_id()
         or exists (select 1 from stratos.tenant_members m
                    where m.tenant_id = tenants.id and m.user_id = stratos.current_user_id() and m.active));
create policy "tenants: admin update" on stratos.tenants for update to stratos_app
  using (id = stratos.current_tenant_id() and stratos.is_tenant_admin())
  with check (id = stratos.current_tenant_id());

create policy "tenant_members: read own and same tenant" on stratos.tenant_members for select to stratos_app
  using (user_id = stratos.current_user_id() or tenant_id = stratos.current_tenant_id());
create policy "tenant_members: admin write" on stratos.tenant_members for all to stratos_app
  using (tenant_id = stratos.current_tenant_id() and stratos.is_tenant_admin())
  with check (tenant_id = stratos.current_tenant_id() and stratos.is_tenant_admin());

create policy "industry_templates: read" on stratos.industry_templates for select to stratos_app using (true);

-- Settings tables: everyone in the tenant reads, admins write.
do $$
declare t text;
begin
  foreach t in array array['pipeline_stages', 'scoring_rules', 'cadences', 'cadence_steps', 'inbound_endpoints'] loop
    execute format($p$create policy "%1$s: tenant read" on stratos.%1$I for select to stratos_app
      using (tenant_id = stratos.current_tenant_id())$p$, t);
    execute format($p$create policy "%1$s: admin write" on stratos.%1$I for all to stratos_app
      using (tenant_id = stratos.current_tenant_id() and stratos.is_tenant_admin())
      with check (tenant_id = stratos.current_tenant_id() and stratos.is_tenant_admin())$p$, t);
  end loop;
end $$;

-- Working data: tenant reads, writers (not viewers) insert and update. No user deletes leads directly:
-- erasure goes through consent_status = 'erasure_requested' and the purge worker.
do $$
declare t text;
begin
  foreach t in array array['leads', 'interactions', 'tickets', 'lead_cadence_state'] loop
    execute format($p$create policy "%1$s: tenant read" on stratos.%1$I for select to stratos_app
      using (tenant_id = stratos.current_tenant_id())$p$, t);
    execute format($p$create policy "%1$s: writers insert" on stratos.%1$I for insert to stratos_app
      with check (tenant_id = stratos.current_tenant_id() and stratos.can_write())$p$, t);
    execute format($p$create policy "%1$s: writers update" on stratos.%1$I for update to stratos_app
      using (tenant_id = stratos.current_tenant_id() and stratos.can_write())
      with check (tenant_id = stratos.current_tenant_id())$p$, t);
  end loop;
end $$;
create policy "interactions: admin delete" on stratos.interactions for delete to stratos_app
  using (tenant_id = stratos.current_tenant_id() and stratos.is_tenant_admin());
create policy "tickets: admin delete" on stratos.tickets for delete to stratos_app
  using (tenant_id = stratos.current_tenant_id() and stratos.is_tenant_admin());
create policy "lead_cadence_state: writers delete" on stratos.lead_cadence_state for delete to stratos_app
  using (tenant_id = stratos.current_tenant_id() and stratos.can_write());

-- Logs: tenant reads; written only by triggers and the service path.
create policy "score_events: tenant read" on stratos.score_events for select to stratos_app
  using (tenant_id = stratos.current_tenant_id());
create policy "cadence_dispatches: tenant read" on stratos.cadence_dispatches for select to stratos_app
  using (tenant_id = stratos.current_tenant_id());
create policy "erasure_requests: admin read" on stratos.erasure_requests for select to stratos_app
  using (tenant_id = stratos.current_tenant_id() and stratos.is_tenant_admin());
create policy "ai_usage: admin read" on stratos.ai_usage for select to stratos_app
  using (tenant_id = stratos.current_tenant_id() and stratos.is_tenant_admin());
create policy "ai_tool_calls: read own or admin" on stratos.ai_tool_calls for select to stratos_app
  using (tenant_id = stratos.current_tenant_id() and (user_id = stratos.current_user_id() or stratos.is_tenant_admin()));
create policy "ai_tool_calls: append own" on stratos.ai_tool_calls for insert to stratos_app
  with check (tenant_id = stratos.current_tenant_id() and user_id = stratos.current_user_id());

-- Grants (RLS narrows these further).
grant select on stratos.industry_templates to stratos_app;
grant select, update (name, branding, compliance_regimes, retention_days, default_currency, timezone) on stratos.tenants to stratos_app;
grant select, insert, update, delete on stratos.tenant_members to stratos_app;
grant select, insert, update, delete on stratos.pipeline_stages, stratos.scoring_rules, stratos.cadences,
  stratos.cadence_steps, stratos.inbound_endpoints to stratos_app;
-- Column grants: users can never write scores, activity clocks or AI output directly; those come from
-- apply_score(), the interaction triggers and the AI pipeline (service path).
grant select on stratos.leads, stratos.interactions, stratos.tickets, stratos.lead_cadence_state to stratos_app;
grant insert (full_name, email, phone, company, job_title, source, source_ref, source_meta, stage_id, owner_id,
  contract_value, currency, consent_status, consent_evidence, contains_phi, custom_fields) on stratos.leads to stratos_app;
grant update (full_name, email, phone, company, job_title, stage_id, status, owner_id, contract_value, currency,
  consent_status, consent_evidence, contains_phi, custom_fields) on stratos.leads to stratos_app;
grant insert (lead_id, channel, direction, occurred_at, answered, duration_seconds, body, actor_id)
  on stratos.interactions to stratos_app;
grant update (body, follow_up_required) on stratos.interactions to stratos_app;
grant insert (lead_id, subject, description, status, priority, assignee_id) on stratos.tickets to stratos_app;
grant update (subject, description, status, priority, assignee_id) on stratos.tickets to stratos_app;
grant insert (lead_id, cadence_id) on stratos.lead_cadence_state to stratos_app; -- pause/resume via functions
grant delete on stratos.interactions, stratos.tickets, stratos.lead_cadence_state to stratos_app;
grant select on stratos.score_events, stratos.cadence_dispatches, stratos.erasure_requests, stratos.ai_usage to stratos_app;
grant select, insert on stratos.ai_tool_calls to stratos_app;
revoke all on "user", "session", "account", "verification" from stratos_app;

-- ---------------------------------------------------------------------------
-- Industry templates
-- ---------------------------------------------------------------------------

insert into stratos.industry_templates (industry, stages, cadences, scoring) values
('digital_marketing_agency',
 '[{"key":"new","name":"New enquiry","probability":5},{"key":"discovery","name":"Discovery call","probability":20},
   {"key":"audit","name":"Audit / proposal","probability":40},{"key":"negotiation","name":"Negotiation","probability":65},
   {"key":"won","name":"Retainer signed","probability":100,"is_won":true},{"key":"lost","name":"Lost","is_lost":true}]',
 '[{"key":"new_lead_7d","name":"New lead, 7 days","description":"Fast follow-up for ad leads","steps":[
    {"channel":"whatsapp","delay_minutes":2,"template_name":"stratos_welcome","body":"Hi {{first_name}}, thanks for reaching out to {{tenant_name}}. When is a good time for a 15 minute call?"},
    {"channel":"call_task","delay_minutes":60,"body":"Call {{first_name}} about their enquiry"},
    {"channel":"whatsapp","delay_minutes":1440,"template_name":"stratos_case_study","body":"Here is how we grew a brand like {{company}}: {{case_study_link}}"},
    {"channel":"email","delay_minutes":2880,"body":"Free marketing audit for {{company}}"},
    {"channel":"sms","delay_minutes":4320,"body":"{{first_name}}, shall we book your audit call? Reply YES"}]}]',
 '{"source:facebook_lead_ads":20,"source:instagram_lead_ads":18,"source:google_my_business":35,"source:website_form":30,
   "source:referral":45,"source:whatsapp":30,"source:telecmi":25,"source:manual":15,"source:api":15,
   "call_answered":15,"call_missed":-3,"inbound_reply":10,"sentiment_positive":10,"sentiment_neutral":0,
   "sentiment_negative":-20,"inactivity_48h":-10}'),
('it_consulting_saas',
 '[{"key":"new","name":"New lead","probability":5},{"key":"qualified","name":"Qualified (BANT)","probability":20},
   {"key":"demo","name":"Demo","probability":35},{"key":"poc","name":"POC / trial","probability":55},
   {"key":"proposal","name":"Proposal","probability":70},{"key":"won","name":"Closed won","probability":100,"is_won":true},
   {"key":"lost","name":"Closed lost","is_lost":true}]',
 '[{"key":"demo_booking_10d","name":"Demo booking, 10 days","description":"Book a demo with inbound trial and form leads","steps":[
    {"channel":"email","delay_minutes":5,"body":"{{first_name}}, here is a 2 minute overview and a link to book a demo"},
    {"channel":"call_task","delay_minutes":240,"body":"Qualify {{company}}: budget, authority, need, timeline"},
    {"channel":"whatsapp","delay_minutes":2880,"template_name":"stratos_demo_nudge","body":"Hi {{first_name}}, would a short demo this week help?"},
    {"channel":"email","delay_minutes":7200,"body":"Customer story relevant to {{company}}"},
    {"channel":"email","delay_minutes":14400,"body":"Should I close your file, {{first_name}}?"}]}]',
 '{"source:facebook_lead_ads":10,"source:instagram_lead_ads":8,"source:google_my_business":25,"source:website_form":35,
   "source:referral":50,"source:whatsapp":20,"source:telecmi":25,"source:manual":15,"source:api":30,
   "call_answered":15,"call_missed":-3,"inbound_reply":10,"sentiment_positive":10,"sentiment_neutral":0,
   "sentiment_negative":-20,"inactivity_48h":-10}'),
('recruitment_staffing',
 '[{"key":"new","name":"New requirement","probability":10},{"key":"intake","name":"Intake call","probability":30},
   {"key":"shortlist","name":"Shortlist shared","probability":50},{"key":"interviews","name":"Interviews","probability":70},
   {"key":"offer","name":"Offer","probability":85},{"key":"won","name":"Placement","probability":100,"is_won":true},
   {"key":"lost","name":"Lost","is_lost":true}]',
 '[{"key":"client_intake_5d","name":"Client intake, 5 days","description":"Turn a hiring enquiry into an intake call","steps":[
    {"channel":"whatsapp","delay_minutes":2,"template_name":"stratos_hiring_hello","body":"Hi {{first_name}}, thanks for your hiring requirement. Can we do a 10 minute intake call today?"},
    {"channel":"call_task","delay_minutes":30,"body":"Intake call: role, budget, location, notice period"},
    {"channel":"whatsapp","delay_minutes":1440,"template_name":"stratos_profiles_ready","body":"We have matching profiles for your role. Shall I share them?"},
    {"channel":"sms","delay_minutes":4320,"body":"{{first_name}}, still hiring? Reply YES and we will share profiles."}]}]',
 '{"source:facebook_lead_ads":15,"source:instagram_lead_ads":12,"source:google_my_business":30,"source:website_form":35,
   "source:referral":50,"source:whatsapp":30,"source:telecmi":30,"source:manual":15,"source:api":20,
   "call_answered":15,"call_missed":-3,"inbound_reply":10,"sentiment_positive":10,"sentiment_neutral":0,
   "sentiment_negative":-20,"inactivity_48h":-10}'),
('tech_support',
 '[{"key":"new","name":"New enquiry","probability":10},{"key":"assessment","name":"Assessment","probability":30},
   {"key":"quote","name":"Quote sent","probability":55},{"key":"won","name":"AMC / contract signed","probability":100,"is_won":true},
   {"key":"lost","name":"Lost","is_lost":true}]',
 '[{"key":"amc_followup_7d","name":"AMC follow-up, 7 days","description":"Convert support enquiries into annual contracts","steps":[
    {"channel":"whatsapp","delay_minutes":2,"template_name":"stratos_support_hello","body":"Hi {{first_name}}, we got your request. A technician will call you shortly."},
    {"channel":"call_task","delay_minutes":15,"body":"Call {{first_name}} to assess the issue"},
    {"channel":"whatsapp","delay_minutes":2880,"template_name":"stratos_amc_offer","body":"Avoid surprise downtime: our annual plan for {{company}} covers this. Want a quote?"},
    {"channel":"sms","delay_minutes":7200,"body":"{{first_name}}, your quote is ready. Reply QUOTE to receive it."}]}]',
 '{"source:facebook_lead_ads":15,"source:instagram_lead_ads":12,"source:google_my_business":40,"source:website_form":35,
   "source:referral":45,"source:whatsapp":35,"source:telecmi":35,"source:manual":15,"source:api":20,
   "call_answered":15,"call_missed":-3,"inbound_reply":10,"sentiment_positive":10,"sentiment_neutral":0,
   "sentiment_negative":-20,"inactivity_48h":-10}');
