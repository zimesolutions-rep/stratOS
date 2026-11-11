-- Audit log: who did what, when, to which record, in every workspace. Written only by triggers, so no code path
-- (app, webhook, cron, or a manual SQL session that sets app.user_id) can change data without leaving a row.
--
-- Personal data stays out of the log: for fields like name, email, phone or message bodies it records only that the
-- field changed, never the values. That keeps erasure simple (deleting a lead leaves no copy of its details here).

create table stratos.audit_log (
  id         bigint generated always as identity primary key,
  tenant_id  uuid,                  -- no foreign key: the log outlives a deleted workspace
  at         timestamptz not null default now(),
  actor_id   text,                  -- Better Auth user id; null = system (webhook, cron, migration)
  action     text not null check (action in ('insert', 'update', 'delete', 'sign_in')),
  entity     text not null,         -- table name, e.g. leads, pipeline_stages
  entity_id  text,
  changes    jsonb not null default '{}'::jsonb
);
create index audit_log_tenant_at_idx on stratos.audit_log (tenant_id, at desc);
create index audit_log_entity_idx on stratos.audit_log (tenant_id, entity, entity_id, at desc);

-- Fields whose values are personal data: logged as {"changed": true} only.
create function stratos.audit_personal_fields() returns text[]
language sql immutable as $$
  select array['full_name', 'email', 'phone', 'body', 'transcript', 'summary', 'recording_url', 'consent_evidence',
               'custom_fields', 'source_meta', 'source_ref', 'subject', 'description', 'token_hash', 'token_prefix',
               'subject_hash', 'config', 'branding', 'error']
$$;

-- Bookkeeping fields that change on their own (clocks, scores, worker locks): never logged.
create function stratos.audit_noise_fields() returns text[]
language sql immutable as $$
  select array['id', 'tenant_id', 'created_at', 'updated_at', 'created_by', 'conversion_probability',
               'baseline_probability', 'last_activity_at', 'last_inbound_at', 'last_decay_at', 'consent_updated_at',
               'next_step', 'next_run_at', 'locked_until', 'active_since', 'last_used_at', 'ai_status', 'ai_model',
               'ai_processed_at', 'due_by']
$$;

create function stratos.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb := '{}'::jsonb;
  v_personal text[] := stratos.audit_personal_fields();
  v_noise text[] := stratos.audit_noise_fields();
  k text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      continue when k = any (v_noise) or (v_old -> k) is not distinct from (v_new -> k);
      v_changes := v_changes || jsonb_build_object(k, case when k = any (v_personal)
        then jsonb_build_object('changed', true)
        else jsonb_build_object('from', v_old -> k, 'to', v_new -> k) end);
    end loop;
    if v_changes = '{}'::jsonb then return null; end if;  -- only bookkeeping changed
  elsif tg_op = 'INSERT' then
    for k in select jsonb_object_keys(v_new) loop
      continue when k = any (v_noise) or k = any (v_personal) or v_new -> k = 'null'::jsonb;
      v_changes := v_changes || jsonb_build_object(k, v_new -> k);
    end loop;
  end if;

  insert into stratos.audit_log (tenant_id, actor_id, action, entity, entity_id, changes)
  values (case when tg_table_name = 'tenants' then (v_row ->> 'id')::uuid else (v_row ->> 'tenant_id')::uuid end,
          stratos.current_user_id(), lower(tg_op), tg_table_name,
          coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'rule_key'), v_changes);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['tenants', 'tenant_members', 'pipeline_stages', 'scoring_rules', 'cadences',
    'cadence_steps', 'inbound_endpoints', 'leads', 'interactions', 'tickets', 'lead_cadence_state',
    'erasure_requests'] loop
    execute format('create trigger zz_audit after insert or update or delete on stratos.%I
                    for each row execute function stratos.audit_row()', t);
  end loop;
end $$;

-- Append-only: rows are never updated.
create function stratos.audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'The audit log cannot be changed' using errcode = '42501';
end $$;
create trigger audit_log_no_update before update on stratos.audit_log
  for each row execute function stratos.audit_log_immutable();

-- Sign-ins: Better Auth creates a session row on each sign-in. Log it in every workspace the person belongs to.
create function stratos.audit_sign_in() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into stratos.audit_log (tenant_id, actor_id, action, entity, entity_id, changes)
  select m.tenant_id, new."userId", 'sign_in', 'session', null,
         jsonb_strip_nulls(jsonb_build_object('ip', new."ipAddress", 'device', left(new."userAgent", 200)))
    from stratos.tenant_members m
   where m.user_id = new."userId" and m.active;
  return null;
end $$;
create trigger zz_audit_sign_in after insert on public."session"
  for each row execute function stratos.audit_sign_in();

-- Workspace owners and admins read their workspace's log. Nobody writes it except the triggers above.
alter table stratos.audit_log enable row level security;
create policy "audit_log: admin read" on stratos.audit_log for select to stratos_app
  using (tenant_id = stratos.current_tenant_id() and stratos.is_tenant_admin());
grant select on stratos.audit_log to stratos_app;
