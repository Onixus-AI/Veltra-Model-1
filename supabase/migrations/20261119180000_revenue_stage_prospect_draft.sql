-- One owner-triggered, review-only outreach draft for the highest eligible
-- scored prospect. No mail is sent or queued by this function.
create or replace function public.revenue_stage_top_prospect(p_workspace uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := revenue_private.require_role(p_workspace, 'owner');
  candidate record;
  identity_id uuid;
  template public.revenue_templates;
  deal_id uuid;
  drafted jsonb;
begin
  select id into identity_id from public.revenue_sender_identities
   where workspace_id=p_workspace order by is_shared desc,created_at limit 1;
  if identity_id is null then return jsonb_build_object('status','blocked','reason','Connect a sending identity before staging outreach.'); end if;
  select * into template from public.revenue_templates
   where workspace_id=p_workspace and name='First contact — more clients' and not archived
   order by created_at limit 1;
  if template.id is null then return jsonb_build_object('status','blocked','reason','Create a first-contact template before staging outreach.'); end if;

  select c.id customer_id,c.company,c.email,s.score into candidate
  from public.crm_prospect_scores s
  join public.crm_customers c on c.workspace_id=s.workspace_id and c.id=s.customer_id
  where s.workspace_id=p_workspace and s.outreach_ready and s.tier in ('ready','good')
    and c.merged_into_id is null and not c.suppressed and not c.identity_review_required
    and c.email is not null and revenue_private.block_reason(p_workspace,c.email,'marketing') is null
    and not exists(select 1 from public.revenue_messages m where m.workspace_id=p_workspace
      and (m.customer_id=c.id or public.revenue_normalize_email(m.to_email)=public.revenue_normalize_email(c.email))
      and m.direction='outbound' and m.purpose='marketing')
    and not exists(select 1 from public.revenue_messages m where m.workspace_id=p_workspace
      and m.customer_id=c.id and m.direction='inbound')
  order by s.score desc,s.scored_at desc,c.id limit 1
  for update of c skip locked;
  if candidate.customer_id is null then return jsonb_build_object('status','empty','reason','No uncontacted, eligible scored prospect is available.'); end if;

  select id into deal_id from public.crm_deals where workspace_id=p_workspace and customer_id=candidate.customer_id
    and revenue_private.stage_outcome(p_workspace,stage)='open' order by created_at desc limit 1;
  if deal_id is null then
    insert into public.crm_deals(workspace_id,customer_id,title,stage,source,owner_id)
    values(p_workspace,candidate.customer_id,left('Outreach: '||candidate.company,300),'new','Ranked prospect',actor)
    returning id into deal_id;
  end if;
  drafted := public.revenue_draft_message(p_workspace,jsonb_build_object(
    'customer_id',candidate.customer_id,'deal_id',deal_id,'to',candidate.email,
    'subject',template.subject,'body',template.body,'purpose','marketing',
    'sender_identity_id',identity_id,'template_id',template.id,
    'idempotency_key','ranked-outreach:'||candidate.customer_id));
  return jsonb_build_object('status','drafted','customer_id',candidate.customer_id,'deal_id',deal_id,
    'message_id',drafted->>'message_id','score',candidate.score,'requires_approval',true);
end $$;
revoke all on function public.revenue_stage_top_prospect(uuid) from public,anon;
grant execute on function public.revenue_stage_top_prospect(uuid) to authenticated;

-- A real reply to a provider-accepted outreach email advances its open deal.
-- Merely drafting, approving, or queuing a message does not advance the stage.
create or replace function revenue_private.advance_outreach_reply()
returns trigger language plpgsql security definer set search_path='' as $$
declare prior public.revenue_messages; current_stage text;
begin
  if new.direction<>'inbound' or new.customer_id is null or new.in_reply_to is null then return new; end if;
  select * into prior from public.revenue_messages m
   where m.workspace_id=new.workspace_id and m.customer_id=new.customer_id
     and m.direction='outbound' and m.purpose='marketing'
     and m.provider_message_id=new.in_reply_to and m.status in ('provider_accepted','delivered','replied')
   order by m.created_at desc limit 1;
  if prior.id is null or prior.deal_id is null then return new; end if;
  if not exists(select 1 from public.revenue_pipeline_stages where workspace_id=new.workspace_id and key='replied' and not archived) then return new; end if;
  select stage into current_stage from public.crm_deals where id=prior.deal_id and workspace_id=new.workspace_id for update;
  if current_stage in ('new','contacted') then
    update public.crm_deals set stage='replied' where id=prior.deal_id;
    perform revenue_private.record_event(new.workspace_id,new.customer_id,prior.deal_id,
      'opportunity.stage_changed','gmail','customer',new.from_email,new.occurred_at,'recorded','deal',prior.deal_id,
      'Stage moved to Replied after customer email',jsonb_build_object('from',current_stage,'to','replied'),
      jsonb_build_object('message_id',new.id),'outreach.reply:'||new.id);
  end if;
  return new;
end $$;
do $$ begin
  if not exists(select 1 from pg_trigger where tgrelid='public.revenue_messages'::regclass and tgname='revenue_advance_outreach_reply') then
    create trigger revenue_advance_outreach_reply after insert on public.revenue_messages
    for each row execute function revenue_private.advance_outreach_reply();
  end if;
end $$;
