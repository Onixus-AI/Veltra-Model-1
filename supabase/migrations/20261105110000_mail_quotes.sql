-- Mail quotes trucking rates (2026-11): the mailbox settings also hold the owner's rate card
-- (rate per mile, minimum, fuel %, accessorials), the signature quotes are signed with, and how
-- many days a quote is valid. Code writes every price; this only checks the shape.
create or replace function crm_private.mail_rate_card_valid(c jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select c is null or jsonb_typeof(c) = 'null' or (
    jsonb_typeof(c) = 'object'
    and jsonb_typeof(c->'per_mile') = 'number' and (c->>'per_mile')::numeric > 0 and (c->>'per_mile')::numeric <= 100
    and jsonb_typeof(c->'minimum') = 'number' and (c->>'minimum')::numeric between 0 and 1000000
    and jsonb_typeof(c->'fuel_pct') = 'number' and (c->>'fuel_pct')::numeric between 0 and 100
    and jsonb_typeof(c->'accessorials') = 'array' and jsonb_array_length(c->'accessorials') <= 30
    and not exists (select 1 from jsonb_array_elements(c->'accessorials') a where jsonb_typeof(a) <> 'object'
      or jsonb_typeof(a->'name') <> 'string' or length(btrim(a->>'name')) not between 1 and 80
      or jsonb_typeof(a->'price') <> 'number' or (a->>'price')::numeric not between 0 and 100000
      or coalesce(a->>'per', '') not in ('flat', 'stop', 'hour')))
$$;

create or replace function crm_private.mail_settings_valid(s jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(s) = 'object'
    and jsonb_typeof(s->'auto_clean') = 'boolean' and jsonb_typeof(s->'delete_junk') = 'boolean' and jsonb_typeof(s->'unsubscribe') = 'boolean'
    and jsonb_typeof(s->'auto_send') = 'array'
    and not exists (select 1 from jsonb_array_elements_text(s->'auto_send') k where k not in ('QUESTION','QUOTE_REQUEST','DOCUMENT'))
    and (s->'tms_org_id' is null or jsonb_typeof(s->'tms_org_id') = 'null' or (s->>'tms_org_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and crm_private.mail_rate_card_valid(s->'rate_card')
    and (s->'signature' is null or jsonb_typeof(s->'signature') = 'null' or (jsonb_typeof(s->'signature') = 'string' and length(s->>'signature') <= 600))
    and (s->'quote_valid_days' is null or jsonb_typeof(s->'quote_valid_days') = 'null'
      or (jsonb_typeof(s->'quote_valid_days') = 'number' and (s->>'quote_valid_days')::numeric between 1 and 60))
$$;
revoke all on function crm_private.mail_rate_card_valid(jsonb), crm_private.mail_settings_valid(jsonb) from public, anon, authenticated;
