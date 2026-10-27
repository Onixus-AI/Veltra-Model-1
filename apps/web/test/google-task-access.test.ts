import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
test('Google tool grants preserve denial, isolate users and expire with their task',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;grant usage on schema auth to authenticated;`);
 const original=readFileSync(new URL('../../../supabase/task-app-access.sql',import.meta.url),'utf8');
 await db.exec(original.replaceAll(",'google','calendar','brand'",''));
 await db.exec(readFileSync(new URL('../../../supabase/migrations/20261027200448_onyx_google_tool_access.sql',import.meta.url),'utf8'));
 const user='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',task='00000000-0000-4000-8000-000000000003';await db.query('insert into auth.users values($1),($2)',[user,other]);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');await db.query("select public.veltra_task_access('start',$1,'Edit a document')",[task]);
 for(const app of ['google','calendar','brand']){const r=await db.query<any>("select public.veltra_task_access('decide',$1,null,$2,false) as decision",[task,app]);assert.equal(r.rows[0].decision.allowed,false);const retry=await db.query<any>("select public.veltra_task_access('decide',$1,null,$2,true) as decision",[task,app]);assert.equal(retry.rows[0].decision.allowed,false);}
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);assert.equal((await db.query('select * from public.veltra_ai_task_access')).rows.length,0);await assert.rejects(()=>db.query("select public.veltra_task_access('decide',$1,null,'google',true)",[task]),/Task not found/);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.query("select public.veltra_task_access('finish',$1)",[task]);await assert.rejects(()=>db.query("select public.veltra_task_access('decide',$1,null,'google',true)",[task]),/ended/);
 }finally{await db.close();}
});
