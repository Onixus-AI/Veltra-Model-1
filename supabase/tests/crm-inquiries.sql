-- Run only after the isolated bootstrap and the enquiry migration.
begin;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
insert into public.crm_inquiries(id,workspace_id,customer_id,subject,message,source) values
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Fixture enquiry','Fictional test request','phone');
do $$ begin
 if (select count(*) from public.crm_inquiries)<>1 then raise exception 'Owner cannot read inserted enquiry'; end if;
 if (select created_by from public.crm_inquiries limit 1)<>auth.uid() then raise exception 'Creator is not caller'; end if;
 begin
  insert into public.crm_inquiries(workspace_id,customer_id,subject,message,source) values
   ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','Cross tenant','Test','phone');
  raise exception 'Cross-workspace customer accepted';
 exception when foreign_key_violation then null; end;
 begin
  update public.crm_inquiries set workspace_id='10000000-0000-4000-8000-000000000002';
  raise exception 'Workspace mutation accepted';
 exception when insufficient_privilege then null; end;
 begin
  update public.crm_inquiries set message='Rewritten source';
  raise exception 'Source rewrite accepted';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.crm_inquiries(workspace_id,customer_id,subject,message,source,created_by) values
   ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Spoof','Test','phone','00000000-0000-4000-8000-000000000002');
  raise exception 'Creator spoof accepted';
 exception when insufficient_privilege then null; end;
 begin delete from public.crm_inquiries;raise exception 'Delete accepted';exception when insufficient_privilege then null;end;
end $$;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
update public.crm_inquiries set status='reviewing' where id='30000000-0000-4000-8000-000000000001';
do $$ begin
 if (select status from public.crm_inquiries limit 1)<>'reviewing' then raise exception 'Member status update failed';end if;
end $$;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';
do $$ declare changed integer;begin
 if (select count(*) from public.crm_inquiries)<>1 then raise exception 'Viewer read failed';end if;
 update public.crm_inquiries set status='closed';get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Viewer changed enquiry';end if;
 begin
  insert into public.crm_inquiries(workspace_id,customer_id,subject,message,source) values
   ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Viewer','Test','phone');
  raise exception 'Viewer insert accepted';
 exception when insufficient_privilege then null;end;
end $$;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000004';
do $$ declare changed integer;begin
 if exists(select 1 from public.crm_inquiries) then raise exception 'Other tenant can read enquiry';end if;
 update public.crm_inquiries set status='closed';get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Other tenant changed enquiry';end if;
 begin
  insert into public.crm_inquiries(workspace_id,customer_id,subject,message,source) values
   ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Outsider','Test','phone');
  raise exception 'Other tenant insert accepted';
 exception when insufficient_privilege then null;end;
end $$;
set local role anon;
do $$ begin
 begin perform 1 from public.crm_inquiries;raise exception 'Anonymous read accepted';exception when insufficient_privilege then null;end;
 begin delete from public.crm_inquiries;raise exception 'Anonymous delete accepted';exception when insufficient_privilege then null;end;
end $$;
rollback;
