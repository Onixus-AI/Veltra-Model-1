import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

test('mail ingestion keeps one pending review per customer, preserves events and allows new work after completion',async()=>{
 const db=new PGlite();
 const workspace=randomUUID(),account=randomUUID();
 try{
 await db.exec(`create role anon;create role authenticated;create schema crm_private;
 create table crm_customers(id uuid primary key default gen_random_uuid(),workspace_id uuid,company text,email text,source text);
 create table crm_tasks(id uuid primary key default gen_random_uuid(),workspace_id uuid,customer_id uuid,title text,due_at timestamptz,status text default 'open');
 create table crm_activity(workspace_id uuid,customer_id uuid,kind text,title text,created_at timestamptz);
 create table crm_private.mail_receipts(account_id uuid,event_id uuid,customer_id uuid,primary key(account_id,event_id));
 create table crm_mail_threads(account_id uuid,thread_id text,workspace_id uuid,customer_id uuid,subject text,last_event_at timestamptz,unique(workspace_id,account_id,thread_id));
 create function crm_private.mail_workspace(uuid,text) returns uuid language plpgsql as $$begin if $2<>'fixture' then raise exception 'Unauthorized';end if;return '${workspace}'::uuid;end$$;`);
 await db.exec(await readFile(new URL('../../../supabase/tms-operations-events.sql',import.meta.url),'utf8'));
 const receive=(event:string,email='one@example.org',kind='email.received',token='fixture')=>db.query('select crm_ingest_mail($1,$2,$3,$4,$5,$6,$7,now())',[account,token,event,kind,email,'Customer question','thread-'+email]);
 const first=randomUUID();await receive(first);await receive(randomUUID());await receive(first);
 assert.equal((await db.query('select * from crm_tasks')).rows.length,1);
 assert.equal((await db.query('select * from crm_activity')).rows.length,2);
 assert.equal((await db.query('select * from crm_private.mail_receipts')).rows.length,2);
 await db.exec("update crm_tasks set status='done'");await receive(randomUUID());
 assert.equal((await db.query("select * from crm_tasks where status='open'")).rows.length,1);
 await receive(randomUUID(),'two@example.org');
 assert.equal((await db.query("select * from crm_tasks where status='open'")).rows.length,2);
 await receive(randomUUID(),'one@example.org','email.replied');
 assert.equal((await db.query('select * from crm_tasks')).rows.length,3);
 await assert.rejects(()=>receive(randomUUID(),'one@example.org','email.received','wrong'),/Unauthorized/);
 assert.equal((await db.query('select * from crm_activity')).rows.length,5);
 }finally{await db.close();}
});
