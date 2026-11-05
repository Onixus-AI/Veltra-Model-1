import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

// Minimal copy of the production tables crm_finish_contact_job touches (inspected 2026-11-04).
const base=`
create schema crm_private;
create table public.crm_customers(id uuid primary key,workspace_id uuid not null,company text not null,email text,website text default '',suppressed boolean default false,identity_review_required boolean default false);
create table public.crm_contact_evidence(workspace_id uuid,customer_id uuid,email text,source_url text,source_kind text,primary key(workspace_id,customer_id,email,source_url));
create table public.crm_contact_research(id uuid primary key,workspace_id uuid,customer_id uuid,website text,status text,created_at timestamptz default now(),started_at timestamptz,completed_at timestamptz,pages jsonb,last_error text);
create table crm_private.contact_capabilities(job_id uuid,token_hash text,lease_until timestamptz);
`;
const migration=readFileSync(new URL('../../../supabase/migrations/20261104040000_small_business_contact_emails.sql',import.meta.url),'utf8');
const W='00000000-0000-4000-8000-000000000001',C='00000000-0000-4000-8000-0000000000c1',J='00000000-0000-4000-8000-0000000000a1',TOKEN='t'.repeat(72);
const SITE='https://www.bobsplumbing.example';

async function run(contacts:{email:string;page?:string}[]){
 const db=new PGlite();await db.exec(base);await db.exec(migration);
 await db.query(`insert into public.crm_customers(id,workspace_id,company,website) values($1,$2,'Bob''s Plumbing',$3)`,[C,W,SITE]);
 await db.query(`insert into public.crm_contact_research(id,workspace_id,customer_id,website,status) values($1,$2,$3,$4,'running')`,[J,W,C,SITE]);
 await db.query(`insert into crm_private.contact_capabilities values($1,encode(sha256(convert_to($2,'UTF8')),'hex'),now()+interval '5 minutes')`,[J,TOKEN]);
 const page=SITE+'/contact';
 const result={contacts:contacts.map(c=>({email:c.email,source_url:c.page??page,source_kind:'company_website'})),pages:[page]};
 return {db,call:()=>db.query<{r:Record<string,unknown>}>(`select public.crm_finish_contact_job($1,$2,$3) r`,[J,TOKEN,JSON.stringify(result)])};
}
const email=async(db:PGlite)=>(await db.query<{email:string|null}>(`select email from public.crm_customers where id=$1`,[C])).rows[0].email;

test('a Gmail address published on the business site becomes the contact',async()=>{
 const {db,call}=await run([{email:'bobsplumbing@gmail.com'}]);
 assert.equal((await call()).rows[0].r.contact_added,true);
 assert.equal(await email(db),'bobsplumbing@gmail.com');
});
test('an owner-name address at the business domain is accepted',async()=>{
 const {db,call}=await run([{email:'bob@bobsplumbing.example'}]);
 await call();assert.equal(await email(db),'bob@bobsplumbing.example');
});
test('a single role inbox wins when several addresses are published',async()=>{
 const {db,call}=await run([{email:'bob@bobsplumbing.example'},{email:'info@bobsplumbing.example'}]);
 await call();assert.equal(await email(db),'info@bobsplumbing.example');
});
test('two personal addresses stay for review',async()=>{
 const {db,call}=await run([{email:'bob@gmail.com'},{email:'sue@gmail.com'}]);
 await call();assert.equal(await email(db),null);
 assert.equal((await db.query<{n:number}>(`select count(*)::int n from public.crm_contact_evidence`)).rows[0].n,2);
});
test('addresses at other companies, no-reply mailboxes and off-site pages are refused',async()=>{
 for(const bad of [{email:'hello@webdesigner.example'},{email:'no-reply@bobsplumbing.example'},{email:'bob@bobsplumbing.example.evil.test'},{email:'bob@gmail.com',page:'https://evil.example/contact'}]){
  const {db,call}=await run([bad]);
  await assert.rejects(call());
  assert.equal(await email(db),null);
 }
});
