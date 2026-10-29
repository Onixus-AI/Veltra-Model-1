import {PGlite} from '@electric-sql/pglite';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
test('search quota and atomic reviewed bulk import isolation',async()=>{
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table public.crm_conversations(id uuid primary key,user_id uuid,workspace_id uuid,customer_id uuid,revision int default 0,messages jsonb,updated_at timestamptz);create table crm_memberships(user_id uuid,workspace_id uuid,role text);create table crm_customers(id uuid default gen_random_uuid(),workspace_id uuid,company text,name text,email text,phone text,website text,industry text,location text,source text);`);
await db.exec(await readFile(new URL('../../../supabase/migrations/20261029170000_workspace_tools.sql',import.meta.url),'utf8'));
const user='10000000-0000-4000-8000-000000000001',business='20000000-0000-4000-8000-000000000001',review='30000000-0000-4000-8000-000000000001';
await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[user]);await db.query('insert into crm_memberships values($1,$2,$3)',[user,business,'owner']);
const payload={type:'crm_bulk_import_review',expires_at:Date.now()+600000,rows:[{company:'One',email:'one@example.org',source:'provided.csv'},{company:'Two',email:'two@example.org',source:'provided.csv'}]};
await db.query('insert into crm_conversations(id,user_id,workspace_id,messages) values($1,$2,$3,$4)',[review,user,business,JSON.stringify([{content:JSON.stringify(payload)}])]);
const first=(await db.query('select crm_confirm_bulk_import($1) as result',[review])).rows[0].result;assert.equal(first.imported,2);assert.equal(first.messages_sent,0);
const replay=(await db.query('select crm_confirm_bulk_import($1) as result',[review])).rows[0].result;assert.deepEqual(replay,first);assert.equal((await db.query('select count(*)::int n from crm_customers')).rows[0].n,2);
await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,['10000000-0000-4000-8000-000000000002']);await assert.rejects(db.query('select crm_confirm_bulk_import($1)',[review]),/not found/);
await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[user]);for(let i=0;i<20;i++)assert.equal((await db.query('select workspace_claim_web_search() ok')).rows[0].ok,true);assert.equal((await db.query('select workspace_claim_web_search() ok')).rows[0].ok,false);
await db.query(`select set_config('request.jwt.claim.sub','',false)`);await assert.rejects(db.query('select workspace_claim_web_search()'),/Sign in/);
await db.close();});
