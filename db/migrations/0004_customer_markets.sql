-- Workspaces serve customers in many countries. Replace the single "region" choice with a list of markets, and
-- widen the privacy laws a workspace can declare to match. data_region stays: it is where this deployment hosts
-- the data (one Neon region per deployment), not where customers are.

alter table stratos.tenants
  add column customer_markets text[] not null default '{in}'
    check (cardinality(customer_markets) > 0
           and customer_markets <@ array['in', 'us', 'eu', 'uk', 'me', 'au', 'sea', 'other']::text[]);

-- Existing workspaces: their old region choice was their market.
update stratos.tenants set customer_markets = array[data_region];

alter table stratos.tenants drop constraint if exists tenants_compliance_regimes_check;
alter table stratos.tenants add constraint tenants_compliance_regimes_check
  check (compliance_regimes <@ array['dpdp', 'gdpr', 'uk_gdpr', 'ccpa', 'hipaa', 'uae_pdpl', 'ksa_pdpl',
                                     'au_privacy', 'pdpa_sg']::text[]);

grant update (customer_markets) on stratos.tenants to stratos_app;

drop function stratos.create_tenant(text, text, stratos.industry, text[], text);

-- Called by a signed-in user during onboarding. Creates the tenant, makes the caller its owner, seeds it.
create function stratos.create_tenant(p_name text, p_slug text, p_industry stratos.industry,
                                      p_regimes text[] default '{dpdp}', p_markets text[] default '{in}')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_user text := stratos.current_user_id();
begin
  if v_user is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  insert into stratos.tenants (name, slug, industry, compliance_regimes, customer_markets, created_by)
  values (p_name, lower(p_slug), p_industry, p_regimes, p_markets, v_user)
  returning id into v_id;
  insert into stratos.tenant_members (tenant_id, user_id, role) values (v_id, v_user, 'owner');
  -- Switch this transaction to the new tenant so the seed rows are stamped with it.
  perform set_config('app.tenant_id', v_id::text, true);
  perform stratos.seed_tenant(v_id);
  return v_id;
end $$;

revoke execute on function stratos.create_tenant(text, text, stratos.industry, text[], text[]) from public;
grant execute on function stratos.create_tenant(text, text, stratos.industry, text[], text[]) to stratos_app;
