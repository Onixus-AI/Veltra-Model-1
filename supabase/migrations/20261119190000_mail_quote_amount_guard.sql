-- A quote may be staged with an owner-fillable rate, but never approved with
-- that placeholder or a price below the configured minimum.
create or replace function public.mail_item_decide(p_workspace uuid, p_id uuid, p_decision text, p_draft text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := revenue_private.require_role(p_workspace, 'owner'); i crm_private.mail_items;
  reply_text text; rate_text text; quoted numeric; rate_floor numeric := 0; mailbox_settings jsonb;
begin
  if p_decision not in ('approve', 'skip') then raise exception '400:Choose approve or skip.'; end if;
  if p_draft is not null and (length(btrim(p_draft)) = 0 or length(p_draft) > 8000) then raise exception '400:The reply must have text (up to 8,000 characters).'; end if;
  select * into i from crm_private.mail_items where id=p_id and workspace_id=p_workspace and status='pending' for update;
  if i.id is null then raise exception '409:This item was already handled.'; end if;
  reply_text := coalesce(p_draft,i.draft);
  if p_decision='approve' and i.plan->>'action'='reply' and nullif(btrim(coalesce(reply_text,'')),'') is null then
    raise exception '400:Add a priced reply before approving this request.';
  end if;
  if p_decision='approve' and i.category='QUOTE_REQUEST' and i.plan->>'action'='reply' then
    if position('[ENTER RATE]' in coalesce(reply_text,''))>0 then raise exception '400:Enter the actual rate before approving this quote.'; end if;
    select g.settings into mailbox_settings from crm_private.mail_google g where g.account_id=i.account_id;
    if (mailbox_settings->'rate_card'->>'minimum') ~ '^[0-9]+(\.[0-9]{1,2})?$' then
      rate_floor := (mailbox_settings->'rate_card'->>'minimum')::numeric;
    end if;
    rate_text := (regexp_match(reply_text, '(Quoted rate|Total):[[:space:]]*\$[[:space:]]*([0-9][0-9,]*(\.[0-9]{1,2})?)', 'i'))[2];
    if rate_text is null then raise exception '400:Add an explicit quoted rate or total before approving.'; end if;
    quoted := replace(rate_text,',','')::numeric;
    if quoted<=0 or quoted<rate_floor then raise exception '400:Quoted rate is below the configured floor.'; end if;
  end if;
  update crm_private.mail_items set status=case when p_decision='approve' then 'approved' else 'skipped' end,
    draft=case when p_decision='approve' and p_draft is not null and plan->>'action'='reply' then p_draft else draft end,
    decided_by=u, decided_at=now(), updated_at=now() where id=p_id returning * into i;
  return jsonb_build_object('id',i.id,'status',i.status);
end $$;

-- The Mail worker can put a configured category on autopilot. Apply the same
-- check there so it cannot bypass the owner-decision RPC.
create or replace function crm_private.mail_quote_approved_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare rate_text text; quoted numeric; rate_floor numeric:=0; mailbox_settings jsonb;
begin
  if new.status<>'approved' or new.category<>'QUOTE_REQUEST' or new.plan->>'action'<>'reply' then return new; end if;
  if new.draft is null or position('[ENTER RATE]' in new.draft)>0 then raise exception '400:Enter the actual rate before approving this quote.'; end if;
  select g.settings into mailbox_settings from crm_private.mail_google g where g.account_id=new.account_id;
  if (mailbox_settings->'rate_card'->>'minimum') ~ '^[0-9]+(\.[0-9]{1,2})?$' then
    rate_floor:=(mailbox_settings->'rate_card'->>'minimum')::numeric;
  end if;
  rate_text:=(regexp_match(new.draft,'(Quoted rate|Total):[[:space:]]*\$[[:space:]]*([0-9][0-9,]*(\.[0-9]{1,2})?)','i'))[2];
  if rate_text is null then raise exception '400:Add an explicit quoted rate or total before approving.'; end if;
  quoted:=replace(rate_text,',','')::numeric;
  if quoted<=0 or quoted<rate_floor then raise exception '400:Quoted rate is below the configured floor.'; end if;
  return new;
end $$;
do $$ begin
  if not exists(select 1 from pg_trigger where tgrelid='crm_private.mail_items'::regclass and tgname='mail_quote_approved_guard') then
    create trigger mail_quote_approved_guard before insert or update of status,draft,plan,category on crm_private.mail_items
    for each row execute function crm_private.mail_quote_approved_guard();
  end if;
end $$;
