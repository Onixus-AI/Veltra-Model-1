import {test} from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';
const U='00000000-0000-4000-8000-000000000001',W='00000000-0000-4000-8000-000000000002',C='00000000-0000-4000-8000-000000000003';
test('reconciliation archives only researched unresolved records and retains history with scoped restore',async()=>{
 const db=new PGlite();try{await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table crm_customers(id uuid primary key,workspace_id uuid,email text,source text,identity_review_required boolean,created_at timestamptz default now(),suppressed boolean default false);
 create table crm_memberships(workspace_id uuid,user_id uuid,role text);create table crm_contact_research(workspace_id uuid,customer_id uuid,completed_at timestamptz,last_error text,pages jsonb);
 create table crm_contact_evidence(workspace_id uuid,customer_id uuid);create table crm_deals(workspace_id uuid,customer_id uuid,stage text);create table crm_tasks(workspace_id uuid,customer_id uuid,status text);create table crm_activity(workspace_id uuid,customer_id uuid,kind text,title text);
 insert into crm_customers(id,workspace_id,email,identity_review_required) values('${C}','${W}',null,true);insert into crm_memberships values('${W}','${U}','owner');`);
 await db.exec(readFileSync(resolve('../../supabase/migrations/20261030034217_crm_reconciliation.sql'),'utf8'));
 const archive=()=>db.query('select crm_archive_unresolved($1,$2,$3)',[W,C,'Official pages checked; no published contact found.']);
 await assert.rejects(archive(),/editor required/i);await db.exec(`set test.uid='${U}'`);await assert.rejects(archive(),/source research/i);
 await db.exec(`insert into crm_contact_research values('${W}','${C}',now(),null,'["https://example.test/contact"]');insert into crm_contact_evidence values('${W}','${C}');`);await assert.rejects(archive(),/contact evidence/i);
 await db.exec(`delete from crm_contact_evidence;insert into crm_tasks values('${W}','${C}','open')`);await assert.rejects(archive(),/open work/i);await db.exec('delete from crm_tasks');
 await db.exec(`insert into crm_customers(id,workspace_id,email,source,identity_review_required) values('00000000-0000-4000-8000-000000000004','${W}',null,'https://example.test',false);`);assert.equal((await db.query<any>("select identity_review_required from crm_customers where id='00000000-0000-4000-8000-000000000004'")).rows[0].identity_review_required,true);await db.exec("delete from crm_customers where id='00000000-0000-4000-8000-000000000004'");
 await archive();const row=(await db.query<any>('select * from crm_customers')).rows[0];assert.ok(row.archived_at);assert.equal(row.suppressed,true);assert.equal((await db.query('select * from crm_activity')).rows.length,1);
 await archive();assert.equal((await db.query('select * from crm_activity')).rows.length,1);
 await db.exec("set test.uid='00000000-0000-4000-8000-000000000099'");await assert.rejects(db.query('select crm_restore_archived($1,$2)',[W,C]),/editor required/i);
 await db.exec(`set test.uid='${U}'`);await db.query('select crm_restore_archived($1,$2)',[W,C]);const restored=(await db.query<any>('select * from crm_customers')).rows[0];assert.equal(restored.archived_at,null);assert.equal(restored.suppressed,true);assert.equal((await db.query('select * from crm_customers')).rows.length,1);
 }finally{await db.close();}
});
