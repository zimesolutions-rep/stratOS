-- Step 2: inbound lead sources.
--
-- Google Business Profile has no lead webhook since Google shut down Business Messages (July 2024). Google leads
-- arrive through Google Ads lead forms instead, which post to a webhook, so they get their own source. Calls from a
-- Business Profile listing still come in through TeleCMI (Step 3).

alter type stratos.lead_source add value if not exists 'google_ads_lead_form' after 'google_my_business';

-- Show which token an endpoint uses (the first characters) without keeping the token itself.
alter table stratos.inbound_endpoints add column token_prefix text;

-- Starting score for Google lead forms: same as the tenant's Google Business score, else 30.
update stratos.industry_templates
set scoring = scoring || jsonb_build_object('source:google_ads_lead_form', coalesce((scoring ->> 'source:google_my_business')::numeric, 30));

insert into stratos.scoring_rules (tenant_id, rule_key, value)
select t.id, 'source:google_ads_lead_form', coalesce(r.value, 30)
from stratos.tenants t
left join stratos.scoring_rules r on r.tenant_id = t.id and r.rule_key = 'source:google_my_business'
on conflict (tenant_id, rule_key) do nothing;

-- A form re-submitted by a lead we already have counts as a sign of interest.
update stratos.industry_templates set scoring = scoring || '{"re_enquiry": 5}';
insert into stratos.scoring_rules (tenant_id, rule_key, value)
select id, 're_enquiry', 5 from stratos.tenants
on conflict (tenant_id, rule_key) do nothing;
