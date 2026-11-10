-- StratOS checks: tenant isolation, roles, column guards, scoring, cadence stop/resume, worker, erasure.
-- Fails loudly on the first broken expectation. Run after 0001_auth.sql and 0002_stratos_core.sql.
\set ON_ERROR_STOP 1

insert into "user" (id, name, email, "emailVerified") values
  ('u-a-owner', 'A Owner', 'owner@a.test', true),
  ('u-a-viewer', 'A Viewer', 'viewer@a.test', true),
  ('u-b-owner', 'B Owner', 'owner@b.test', true);

create function pg_temp.as_user(p_user text, p_tenant uuid default null) returns void language plpgsql as $$
begin
  perform set_config('app.user_id', p_user, true);
  perform set_config('app.tenant_id', coalesce(p_tenant::text, ''), true);
  execute 'set local role stratos_app';
end $$;
create function pg_temp.expect(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', msg; end if; end $$;
create function pg_temp.fails(p_sql text, msg text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FAILED (should have been refused): %', msg;
end $$;
grant execute on function pg_temp.expect(boolean, text), pg_temp.fails(text, text) to stratos_app;

-- Onboarding seeds stages, scoring rules and cadences from the industry template.
begin;
select pg_temp.as_user('u-a-owner');
create temp table ta as select stratos.create_tenant('Acme', 'acme', 'it_consulting_saas') as id;
commit;
begin;
select pg_temp.as_user('u-b-owner');
create temp table tb as select stratos.create_tenant('Beta', 'beta', 'recruitment_staffing') as id;
commit;
grant select on ta, tb to stratos_app;
insert into stratos.tenant_members (tenant_id, user_id, role) select id, 'u-a-viewer', 'viewer' from ta;

select pg_temp.expect((select count(*) from stratos.pipeline_stages where tenant_id = (select id from ta)) = 7, 'SaaS template seeds 7 stages');
select pg_temp.expect((select count(*) from stratos.pipeline_stages where tenant_id = (select id from tb)) = 7, 'staffing template seeds 7 stages');
select pg_temp.expect((select count(*) from stratos.cadence_steps s join stratos.cadences c on c.id = s.cadence_id
                       where c.tenant_id = (select id from ta)) = 5, 'SaaS cadence has 5 steps');
select pg_temp.expect((select value from stratos.scoring_rules where tenant_id = (select id from ta) and rule_key = 'call_answered') = 15, 'scoring rules seeded');

-- Owner A creates a lead; tenant is stamped from the session and the baseline comes from the channel.
begin;
select pg_temp.as_user('u-a-owner', (select id from ta));
insert into stratos.leads (full_name, email, phone, company, source)
  values ('Priya Shah', 'priya@acme-client.test', '+919800000001', 'Acme Client', 'website_form');
select pg_temp.expect((select tenant_id from stratos.leads) = (select id from ta), 'tenant_id stamped from session');
select pg_temp.expect((select conversion_probability from stratos.leads) = 35, 'website_form baseline is 35');
select pg_temp.fails($$insert into stratos.leads (tenant_id, full_name) values (gen_random_uuid(), 'x')$$, 'tenant_id is not writable');
select pg_temp.fails($$update stratos.leads set conversion_probability = 99$$, 'score is not writable by users');
commit;

-- Tenant B, and a forged tenant id, see nothing of tenant A.
begin;
select pg_temp.as_user('u-b-owner', (select id from tb));
select pg_temp.expect((select count(*) from stratos.leads) = 0, 'tenant B cannot see tenant A leads');
select pg_temp.expect((select count(*) from stratos.cadences) = 1, 'tenant B sees only its own cadence');
commit;
begin;
select pg_temp.as_user('u-b-owner', (select id from ta));
select pg_temp.expect(stratos.current_tenant_id() is null, 'forged tenant id resolves to no tenant');
select pg_temp.expect((select count(*) from stratos.leads) = 0, 'forged tenant id sees no leads');
select pg_temp.expect((select count(*) from stratos.tenants) = 1, 'non-member sees only own tenant row');
select pg_temp.fails($$insert into stratos.leads (full_name) values ('intruder')$$, 'forged tenant id cannot insert');
commit;

-- Viewers read but cannot write.
begin;
select pg_temp.as_user('u-a-viewer', (select id from ta));
select pg_temp.expect((select count(*) from stratos.leads) = 1, 'viewer reads tenant leads');
select pg_temp.fails($$insert into stratos.leads (full_name) values ('nope')$$, 'viewer cannot insert');
select pg_temp.fails($$insert into stratos.tickets (subject) values ('nope')$$, 'viewer cannot raise tickets');
commit;

-- Scoring: an answered call adds 15.
begin;
select pg_temp.as_user('u-a-owner', (select id from ta));
insert into stratos.interactions (lead_id, channel, direction, answered, duration_seconds)
  select id, 'call', 'outbound', true, 240 from stratos.leads;
select pg_temp.expect((select conversion_probability from stratos.leads) = 50, 'answered call: 35 + 15 = 50');
select pg_temp.expect((select count(*) from stratos.score_events) = 1, 'score change logged');

-- Moving to a later stage lifts the score to the stage floor (SaaS "POC / trial" = 55) and logs why.
update stratos.leads set stage_id = (select id from stratos.pipeline_stages where key = 'poc');
select pg_temp.expect((select conversion_probability from stratos.leads) = 55, 'stage move lifts score to floor 55');
select pg_temp.expect((select count(*) from stratos.score_events where rule_key = 'stage_floor') = 1, 'stage floor change logged');
update stratos.leads set stage_id = (select id from stratos.pipeline_stages where key = 'new');
select pg_temp.expect((select conversion_probability from stratos.leads) = 55, 'moving back never lowers the score');

-- Enrol in the cadence, then a ticket pauses it and resolving resumes at the same next step.
insert into stratos.lead_cadence_state (lead_id, cadence_id) select l.id, c.id from stratos.leads l, stratos.cadences c;
select pg_temp.expect((select cadence_active and next_step = 1 from stratos.lead_cadence_state), 'enrolled and active at step 1');
insert into stratos.tickets (lead_id, subject) select id, 'Login broken' from stratos.leads;
select pg_temp.expect((select number from stratos.tickets) = 1, 'ticket numbered T-1');
select pg_temp.expect((select not cadence_active and stop_reason = 'ticket_open' from stratos.lead_cadence_state), 'open ticket pauses cadence');
update stratos.tickets set status = 'resolved';
select pg_temp.expect((select cadence_active and stop_reason is null and next_step = 1 from stratos.lead_cadence_state), 'resolved ticket resumes cadence');
select pg_temp.expect((select resolved_at is not null from stratos.tickets), 'resolved_at stamped');
commit;

-- Worker (service path): claim, validate, record. Step 1 sent moves the pointer to step 2.
update stratos.lead_cadence_state set next_run_at = now() - interval '1 minute';
create temp table claimed as select * from stratos.claim_due_cadences(10);
select pg_temp.expect((select count(*) from claimed) = 1, 'one due enrolment claimed');
select pg_temp.expect((select count(*) from stratos.claim_due_cadences(10)) = 0, 'leased rows are not claimed twice');
select pg_temp.expect((select stratos.cadence_stop_reason(state_id) is null from claimed), 'validation passes');
select stratos.record_dispatch(state_id, step_position, 'sent', 'wamid.1') from claimed;
select stratos.record_dispatch(state_id, step_position, 'sent', 'wamid.dup') from claimed; -- stale retry: no-op
select pg_temp.expect((select next_step = 2 and locked_until is null from stratos.lead_cadence_state), 'pointer moved to step 2');
select pg_temp.expect((select count(*) from stratos.cadence_dispatches where status = 'sent') = 1, 'step sent exactly once');

-- Users cannot call worker functions.
begin;
select pg_temp.as_user('u-a-owner', (select id from ta));
select pg_temp.fails($$select stratos.claim_due_cadences(10)$$, 'claim is service only');
select pg_temp.fails($$select stratos.process_erasure(gen_random_uuid())$$, 'erasure is service only');
commit;

-- An inbound WhatsApp reply stops the cadence and scores +10.
insert into stratos.interactions (tenant_id, lead_id, channel, direction, provider, provider_ref, body)
  select tenant_id, id, 'whatsapp', 'inbound', 'meta', 'wamid.in1', 'Yes, call me' from stratos.leads;
select pg_temp.expect((select not cadence_active and stop_reason = 'lead_responded' from stratos.lead_cadence_state), 'reply stops cadence');
select pg_temp.expect((select conversion_probability from stratos.leads) = 65, 'reply: 55 + 10 = 65');
select pg_temp.fails($$insert into stratos.interactions (tenant_id, lead_id, channel, direction, provider, provider_ref)
  select tenant_id, id, 'whatsapp', 'inbound', 'meta', 'wamid.in1' from stratos.leads$$, 'webhook retries are deduplicated');

-- Rep resumes manually; negative call sentiment from the AI pipeline stops it again and scores -20.
begin;
select pg_temp.as_user('u-a-owner', (select id from ta));
select pg_temp.expect((select stratos.resume_cadence(id) from stratos.lead_cadence_state) is null, 'manual resume succeeds');
select pg_temp.expect((select cadence_active from stratos.lead_cadence_state), 'active after resume');
commit;
update stratos.interactions set sentiment = 'negative', summary = 'Annoyed by calls', follow_up_required = false,
  ai_status = 'done' where channel = 'call';
select pg_temp.expect((select conversion_probability from stratos.leads) = 45, 'negative sentiment: 65 - 20 = 45');
select pg_temp.expect((select not cadence_active and stop_reason = 'hostile_sentiment' from stratos.lead_cadence_state), 'hostile sentiment stops cadence');

-- Inactivity decay: -10 once per 48h.
update stratos.leads set last_activity_at = now() - interval '3 days';
select pg_temp.expect(stratos.decay_inactive_leads() = 1, 'one lead decayed');
select pg_temp.expect(stratos.decay_inactive_leads() = 0, 'decay applies once per 48h');
select pg_temp.expect((select conversion_probability from stratos.leads) = 35, 'decay: 45 - 10 = 35');

-- Erasure: the rep records the request; the worker hard-deletes and keeps only the hash.
begin;
select pg_temp.as_user('u-a-owner', (select id from ta));
update stratos.leads set consent_status = 'erasure_requested';
select pg_temp.expect((select count(*) from stratos.erasure_requests where status = 'pending') = 1, 'erasure request queued');
select pg_temp.fails($$delete from stratos.leads$$, 'users cannot delete leads directly');
commit;
select stratos.process_erasure(id) from stratos.erasure_requests;
select pg_temp.expect((select count(*) from stratos.leads) = 0, 'lead hard-deleted');
select pg_temp.expect((select count(*) from stratos.interactions) + (select count(*) from stratos.tickets)
                      + (select count(*) from stratos.lead_cadence_state) + (select count(*) from stratos.score_events) = 0,
                      'dependent rows deleted');
select pg_temp.expect((select status = 'done' and lead_id is null and length(subject_hash) = 64 from stratos.erasure_requests),
                      'erasure proof kept without PII');

select pg_temp.expect(stratos.queue_retention_purges() = 0, 'retention purge runs (no tenant has retention set)');

\echo 'All StratOS checks passed'
