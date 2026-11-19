-- A quote request without a rate stays in review. Owner approval must include
-- real reply text; the Mail worker never sends a blank or invented quote.
create or replace function public.mail_item_decide(p_workspace uuid, p_id uuid, p_decision text, p_draft text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := revenue_private.require_role(p_workspace, 'owner'); i crm_private.mail_items;
begin
  if p_decision not in ('approve', 'skip') then raise exception '400:Choose approve or skip.'; end if;
  if p_draft is not null and (length(btrim(p_draft)) = 0 or length(p_draft) > 8000) then raise exception '400:The reply must have text (up to 8,000 characters).'; end if;
  select * into i from crm_private.mail_items where id = p_id and workspace_id = p_workspace and status = 'pending' for update;
  if i.id is null then raise exception '409:This item was already handled.'; end if;
  if p_decision = 'approve' and i.plan->>'action' = 'reply' and nullif(btrim(coalesce(p_draft, i.draft)), '') is null then
    raise exception '400:Add a priced reply before approving this request.';
  end if;
  update crm_private.mail_items set status = case when p_decision = 'approve' then 'approved' else 'skipped' end,
    draft = case when p_decision = 'approve' and p_draft is not null and plan->>'action' = 'reply' then p_draft else draft end,
    decided_by = u, decided_at = now(), updated_at = now()
   where id = p_id returning * into i;
  return jsonb_build_object('id', i.id, 'status', i.status);
end $$;
