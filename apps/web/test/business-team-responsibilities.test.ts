import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyResponsibilities,responsibilityHref,responsibilitiesForIndustry} from '../lib/business-team/responsibilities';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
test('daily duties cover operations, recovery, measurement and building without claiming autonomous support',()=>{
 assert.equal(new Set(dailyResponsibilities.map(t=>t.key)).size,dailyResponsibilities.length);
 assert.deepEqual(new Set(dailyResponsibilities.map(t=>t.group)),new Set(['Build','Grow','Automate']));
 assert.match(responsibilitiesForIndustry('Mortuary Services').find(t=>t.key==='records')!.check,/patient and family information/);
 for(const task of dailyResponsibilities)assert.equal(task.owner,({Build:'onyx',Grow:'onixa',Automate:'onixelia'} as const)[task.group]);
 assert.equal(dailyResponsibilities.find(t=>t.key==='recovery')?.owner,'onyx');
 assert.equal(dailyResponsibilities.find(t=>t.key==='community')?.owner,'onixa');
 assert.equal(dailyResponsibilities.find(t=>t.key==='delivery')?.owner,'onixelia');
 assert.equal(dailyResponsibilities.find(t=>t.key==='build')?.execution,'not_implemented');
 assert.equal(dailyResponsibilities.find(t=>t.key==='playbook')?.execution,'not_implemented');
 for(const task of dailyResponsibilities){assert.ok(task.done);assert.ok(responsibilityHref(task.tool,'business').startsWith('/'));}
});
test('daily assignments require an owner, are idempotent and isolate businesses',async()=>{
 const db=new PGlite();const user='10000000-0000-4000-8000-000000000001',member='10000000-0000-4000-8000-000000000002',workspace='20000000-0000-4000-8000-000000000001';
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table crm_workspaces(id uuid primary key);create table crm_memberships(user_id uuid,workspace_id uuid,role text);grant usage on schema auth to authenticated;grant select on crm_memberships to authenticated;`);
 await db.exec(await readFile(new URL('../../../supabase/migrations/20261029211000_team_responsibilities.sql',import.meta.url),'utf8'));
 await db.query('insert into crm_workspaces values($1)',[workspace]);await db.query("insert into crm_memberships values($1,$2,'owner'),($3,$2,'member')",[user,workspace,member]);
 await db.exec(await readFile(new URL('../../../supabase/migrations/20261029211500_team_build_grow_automate.sql',import.meta.url),'utf8'));
 const assign=()=>db.query<{n:number}>('select workspace_team_assign_responsibilities($1,$2::jsonb) n',[workspace,JSON.stringify(dailyResponsibilities)]);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[member]);await assert.rejects(assign(),/owner required/);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);assert.equal((await assign()).rows[0].n,dailyResponsibilities.length);assert.equal((await assign()).rows[0].n,dailyResponsibilities.length);
 await assert.rejects(db.query('select workspace_team_assign_responsibilities($1,null)',[workspace]),/Invalid task set/);
 await assert.rejects(db.query('select workspace_team_assign_responsibilities($1,$2::jsonb)',[workspace,JSON.stringify([{...dailyResponsibilities[0],key:'wrong_lane',owner:'onixa',group:'Build'}])]),/team_role_lane/);
 await db.exec('set role authenticated');assert.equal((await db.query('select * from workspace_team_responsibilities')).rows.length,dailyResponsibilities.length);
 await assert.rejects(db.exec("update workspace_team_responsibilities set owner='onixa'"),/permission denied/);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",['10000000-0000-4000-8000-000000000003']);assert.equal((await db.query('select * from workspace_team_responsibilities')).rows.length,0);
 }finally{await db.close();}
});
