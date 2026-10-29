import {PGlite} from '@electric-sql/pglite';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
test('team planning jobs enforce ownership, replay, daily cap and member read isolation',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table crm_workspaces(id uuid primary key);create table crm_memberships(user_id uuid,workspace_id uuid,role text);grant usage on schema auth to authenticated;grant select on crm_memberships to authenticated;`);
 await db.exec(await readFile(new URL('../../../supabase/migrations/20261029193946_business_team_pilot.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../../supabase/migrations/20261029203000_team_daily_schedule.sql',import.meta.url),'utf8'));
 const user='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',workspace='20000000-0000-4000-8000-000000000001',key='30000000-0000-4000-8000-000000000001';
 await db.query('insert into crm_workspaces values($1)',[workspace]);await db.query('insert into crm_memberships values($1,$2,$3)',[user,workspace,'owner']);await db.query('insert into crm_memberships values($1,$2,$3)',[other,workspace,'member']);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);await assert.rejects(db.query('select workspace_team_start($1,$2)',[workspace,key]),/owner required/);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
 const start=async(k:string)=>(await db.query<{job:{id:string;replayed:boolean}}>('select workspace_team_start($1,$2) job',[workspace,k])).rows[0].job;
 await db.query('select workspace_team_schedule_set($1,true)',[workspace]);
 const daily=(await db.query<{job:{id:string}}> ('select workspace_team_daily_start($1) job',[workspace])).rows[0].job;assert.ok(daily.id);assert.equal((await db.query<{job:null}>('select workspace_team_daily_start($1) job',[workspace])).rows[0].job,null);await db.exec('delete from workspace_team_jobs');
 await db.query('select workspace_team_schedule_set($1,false)',[workspace]);
 assert.equal((await db.query<{job:null}>('select workspace_team_daily_start($1) job',[workspace])).rows[0].job,null);
 const first=await start(key);assert.equal(first.replayed,false);assert.equal((await start(key)).id,first.id);assert.equal((await start(key)).replayed,true);
 await assert.rejects(start('30000000-0000-4000-8000-000000000002'),/already running/);
 await db.exec("update workspace_team_jobs set status='completed'");await start('30000000-0000-4000-8000-000000000002');await db.exec("update workspace_team_jobs set status='completed'");await start('30000000-0000-4000-8000-000000000003');await db.exec("update workspace_team_jobs set status='completed'");
 await assert.rejects(start('30000000-0000-4000-8000-000000000004'),/Daily pilot limit/);
 await db.exec('set role authenticated');await assert.rejects(db.query('select workspace_team_daily_start($1)',[workspace]),/permission denied/);assert.equal((await db.query('select id from workspace_team_jobs')).rows.length,3);
 await assert.rejects(db.exec("update workspace_team_jobs set status='failed'"),/permission denied/);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",['10000000-0000-4000-8000-000000000003']);assert.equal((await db.query('select id from workspace_team_jobs')).rows.length,0);
 }finally{await db.close();}
});
