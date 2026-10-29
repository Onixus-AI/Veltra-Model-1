import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
test('daily reports use verified owners, deduplicate email, retain source receipts and enforce ownership at send time',async()=>{
 const db=new PGlite();const w='b3000000-0000-4000-8000-000000000001',owner='a3000000-0000-4000-8000-000000000001',member='a3000000-0000-4000-8000-000000000002',mailbox='c3000000-0000-4000-8000-000000000001';
 const file=async(path:string)=>readFile(new URL('../../../'+path,import.meta.url),'utf8');
 try{
 await db.exec("set timezone='UTC'");
 await db.exec(await file('supabase/tests/revenue-bootstrap.sql'));
 for(const name of ['20261025090000_revenue_core_records.sql','20261025090100_revenue_mail_automation.sql','20261025090200_revenue_journey.sql','20261025120000_revenue_live_relay.sql','20261029193946_business_team_pilot.sql'])await db.exec(await file('supabase/migrations/'+name));
 await db.exec('alter table auth.users add column email_confirmed_at timestamptz;create table workspace_business_events(id uuid primary key default gen_random_uuid(),workspace_id uuid,tool text,status text,created_at timestamptz default now());');
 await db.exec(await file('supabase/migrations/20261029220000_business_daily_reports.sql'));
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())',[owner,'owner@example.com',member,'member@example.com']);
 await db.query("insert into crm_workspaces(id,name,owner_id) values($1,'Reports fixture',$2)",[w,owner]);await db.query("insert into crm_memberships(workspace_id,user_id,role) values($1,$2,'owner'),($1,$3,'member')",[w,owner,member]);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[member]);await assert.rejects(db.query("select workspace_report_settings_set($1,true,'UTC',0)",[w]),/owner required/);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await assert.rejects(db.query("select workspace_report_settings_set($1,true,'Not/AZone',8)",[w]),/Valid timezone/);
 await db.query("select workspace_report_settings_set($1,true,'UTC',0)",[w]);await db.exec("update workspace_report_settings set updated_at=now()-interval '2 days'");
 await db.query("insert into crm_mail_connections(account_id,workspace_id,token_hash,connected_by) values($1,$2,repeat('a',64),$3)",[mailbox,w,owner]);await db.query("insert into revenue_sender_identities(workspace_id,account_id,email,display_name,created_by) values($1,$2,'sender@example.com','Reports sender',$3)",[w,mailbox,owner]);
 await db.query("insert into revenue_jobs(workspace_id,kind,dedupe_key,status,finished_at) values($1,'onboarding.kickoff','source-job','succeeded',date_trunc('day',now())-interval '1 hour')",[w]);
 await db.query("insert into revenue_messages(workspace_id,direction,purpose,status,to_email,subject,idempotency_key,provider_accepted_at) values($1,'outbound','transactional','provider_accepted','customer@example.com','source','source-message',date_trunc('day',now())-interval '1 hour')",[w]);
 assert.equal(Number((await db.query<{hours:number}>("select extract(epoch from (('2026-11-01 08:00'::timestamp at time zone 'America/New_York')-('2026-10-31 08:00'::timestamp at time zone 'America/New_York')))/3600 hours")).rows[0].hours),25);
 assert.equal((await db.query<{n:number}>('select workspace_generate_daily_reports() n')).rows[0].n,1);
 assert.equal((await db.query<{n:number}>('select workspace_generate_daily_reports() n')).rows[0].n,0);
 const report=(await db.query<{report:{mail_provider_accepted:number;mail_delivered:number;reported_model_cost_usd:null};email_message_id:string}>('select report,email_message_id from workspace_daily_reports')).rows[0];assert.equal(report.report.mail_provider_accepted,1);assert.equal(report.report.mail_delivered,0);assert.equal(report.report.reported_model_cost_usd,null);assert.ok(report.email_message_id);
 const messages=await db.query<{to_email:string;status:string}>('select to_email,status from revenue_messages where id=$1',[report.email_message_id]);assert.equal(messages.rows[0].to_email,'owner@example.com');assert.equal(messages.rows[0].status,'queued');
 const gate=async()=>(await db.query<{allowed:boolean}>("select revenue_private.job_gate(j,'fixture') allowed from revenue_jobs j where message_id=$1",[report.email_message_id])).rows[0].allowed;
 await db.query("update revenue_messages set provider_accepted_at=date_trunc('day',now())-interval '1 hour' where id=$1",[report.email_message_id]);
 const repeatData=(await db.query<{data:{mail_provider_accepted:number;source_jobs_active:number}}>("select workspace_report_data($1,date_trunc('day',now())-interval '1 day',date_trunc('day',now())) data",[w])).rows[0].data;assert.equal(repeatData.mail_provider_accepted,1);assert.equal(repeatData.source_jobs_active,0);
 assert.equal(await gate(),true);await db.query("insert into revenue_controls(workspace_id,automation_paused) values($1,true)",[w]);assert.equal(await gate(),false);await db.exec('update revenue_controls set automation_paused=false');
 await db.query('update auth.users set email=$1 where id=$2',['changed@example.com',owner]);assert.equal(await gate(),false);assert.equal((await db.query<{status:string}>('select status from revenue_messages where id=$1',[report.email_message_id])).rows[0].status,'cancelled');
 await db.exec('set role authenticated');await assert.rejects(db.query('select workspace_generate_daily_reports()'),/permission denied/);await assert.rejects(db.query('select workspace_report_queue_email($1)',[report.email_message_id]),/permission denied/);assert.equal((await db.query('select id from workspace_daily_reports')).rows.length,1);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",['a3000000-0000-4000-8000-000000000003']);assert.equal((await db.query('select id from workspace_daily_reports')).rows.length,0);await assert.rejects(db.query('select workspace_report_preview($1)',[w]),/membership required/);
 }finally{await db.close();}
});
