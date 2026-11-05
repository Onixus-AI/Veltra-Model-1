-- Rate card accessorials can be charged per day with a minimum (chassis: $35/day, 3-day minimum).
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
      or coalesce(a->>'per', '') not in ('flat', 'stop', 'hour', 'day')
      or (a ? 'min' and (jsonb_typeof(a->'min') <> 'number' or (a->>'min')::numeric not between 1 and 30 or (a->>'min')::numeric <> trunc((a->>'min')::numeric)))))
$$;
revoke all on function crm_private.mail_rate_card_valid(jsonb) from public, anon, authenticated;
