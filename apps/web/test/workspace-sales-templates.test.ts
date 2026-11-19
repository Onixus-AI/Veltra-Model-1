import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=readFileSync(new URL('../../../supabase/migrations/20261119193000_workspace_owned_sales_templates.sql',import.meta.url),'utf8');
const oldFirst='We Build, We Grow, We Automate. Onixus helps businesses create a clearer path from the first inquiry to the next customer conversation. If following up with new leads is taking too much time, we can map the current handoff and identify one practical improvement. Would a short conversation be useful?';
const oldFollow='We Build, We Grow, We Automate. Following up on the workflow we discussed: a clear owner, a useful customer record, and a timely next step can make it easier to respond to new opportunities. If this is still a priority, we can review the current process together.';
const onixus='8350462c-2cca-4541-b299-acbc4c5f1162';
const zee='58079f40-61b6-41f5-85de-e0491e4dbdf2';
const testSpace='8b2a44cf-db5e-45b6-b65f-d71ca9a21b96';

test('only unchanged client copies are personalized; edited templates and test workspace are preserved',async()=>{
 const db=new PGlite();
 await db.exec(`create schema revenue_private;
 create table public.crm_workspaces(id uuid primary key,name text not null,industry text);
 create table public.revenue_templates(workspace_id uuid,name text,subject text,body text);
 create table public.revenue_pipeline_stages(workspace_id uuid,key text,label text,position int,outcome text,probability int,unique(workspace_id,key));
 create function revenue_private.default_stages() returns table(key text,label text,"position" integer,outcome text,probability integer)
 language sql as $$values ('new','New lead',0,'open',10)$$;`);
 for(const [id,name,industry] of [[onixus,'Onixus','Business consulting'],[zee,'Zee Events','Event Services'],[testSpace,'[TEST ONLY] Workspace','Internal testing']]){
  await db.query('insert into public.crm_workspaces values($1,$2,$3)',[id,name,industry]);
  await db.query('insert into public.revenue_templates values($1,$2,$3,$4)',[id,'First contact — more clients','A clearer path from inquiry to customer',oldFirst]);
  await db.query('insert into public.revenue_templates values($1,$2,$3,$4)',[id,'Follow-up — practical next step','Following up on your workflow',id===zee?'Client-edited follow-up':oldFollow]);
 }
 await db.exec(migration);
 const rows=(await db.query<{workspace_id:string;name:string;subject:string;body:string}>('select * from public.revenue_templates')).rows;
 const first=rows.find(r=>r.workspace_id===zee&&r.name==='First contact — more clients')!;
 assert.match(first.body,/Zee Events/);assert.match(first.body,/Event Services/);assert.doesNotMatch(first.body,/Onixus/);
 assert.equal(rows.find(r=>r.workspace_id===zee&&r.name==='Follow-up — practical next step')!.body,'Client-edited follow-up');
 assert.equal(rows.find(r=>r.workspace_id===testSpace&&r.name==='First contact — more clients')!.body,oldFirst);
 assert.equal(rows.find(r=>r.workspace_id===onixus&&r.name==='First contact — more clients')!.body,oldFirst);
 await db.query("insert into public.crm_workspaces values('11111111-1111-4111-8111-111111111111','Thompsons Mortuary Services','mortuary services')");
 await db.query("insert into public.crm_workspaces values('22222222-2222-4222-8222-222222222222','[TEST ONLY] New','Internal testing')");
 await db.exec(`create trigger revenue_seed_sales_workspace after insert on public.crm_workspaces
 for each row execute function revenue_private.seed_sales_workspace()`);
 await db.query("insert into public.crm_workspaces values('33333333-3333-4333-8333-333333333333','Fresh Client','retail')");
 await db.query("insert into public.crm_workspaces values('44444444-4444-4444-8444-444444444444','[TEST ONLY] Fresh','test')");
 const fresh=(await db.query<{body:string}>("select body from public.revenue_templates where workspace_id='33333333-3333-4333-8333-333333333333' and name='First contact — more clients'")).rows[0];
 assert.match(fresh.body,/Fresh Client/);assert.match(fresh.body,/retail/);
 assert.equal((await db.query("select * from public.revenue_templates where workspace_id='44444444-4444-4444-8444-444444444444'")).rows.length,0);
});
