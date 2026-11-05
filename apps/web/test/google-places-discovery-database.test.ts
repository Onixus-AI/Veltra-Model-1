import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

// Minimal copy of the production tables the discovery functions touch (inspected 2026-11-03).
const base=`
create role anon;create role authenticated;
create schema crm_private;
create table public.crm_customers(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,company text not null,email text,website text default '',phone text default '',location text default '',industry text default '',source text,identity_review_required boolean default false,created_at timestamptz default now(),
 constraint crm_customers_email_check check(email is null or (email=lower(trim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$')));
create table public.crm_discovery_sources(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,provider text not null,category text not null,label text not null,bounds jsonb,enabled boolean default false,phase integer default 0,cursor_id bigint default 0,next_run_at timestamptz default now(),imported integer default 0,duplicates integer default 0,failures integer default 0,last_error text,last_run_at timestamptz,exhausted_at timestamptz,created_at timestamptz default now(),enriched integer default 0,
 constraint crm_discovery_sources_provider_check check(provider = any(array['openstreetmap','fmcsa','fmcsa_contacts','ny_registry'])),
 constraint crm_discovery_sources_category_check check(category = any(array['logistics','warehouses','manufacturers','retailers','offices'])),
 unique nulls not distinct (workspace_id,provider,category,bounds));
create table public.crm_discovery_imports(workspace_id uuid,source_key text,customer_id uuid,source_url text,primary key(workspace_id,source_key));
create table public.crm_contact_evidence(workspace_id uuid,customer_id uuid,email text,source_url text,source_kind text,primary key(workspace_id,customer_id,email,source_url));
create table crm_private.discovery_runs(id uuid primary key default gen_random_uuid(),source_id uuid not null,token_hash text not null,status text not null,lease_until timestamptz not null,created_at timestamptz default now(),completed_at timestamptz);
`;
const migrations=['20261103230000_google_places_discovery.sql','20261104030000_places_monthly_recheck.sql','20261104031000_places_unique_per_search.sql'].map(f=>readFileSync(new URL('../../../supabase/migrations/'+f,import.meta.url),'utf8'));
const W='00000000-0000-4000-8000-000000000001';
const lead=(id:string,extra:Record<string,unknown>={})=>({source_key:'google_places/'+id,source_url:'https://www.google.com/maps/place/?q=place_id:'+id,company:'Biz '+id,email:null,website:'',phone:'(954) 555-0100',location:'Fort Lauderdale, FL',...extra});

async function setup(){
 const db=new PGlite();await db.exec(base);for(const m of migrations)await db.exec(m);
 const src=(await db.query<{id:string}>(`insert into public.crm_discovery_sources(workspace_id,provider,category,label,search_text,enabled) values($1,'google_places','local_businesses','plumbers in Broward County, FL','plumbers in Broward County, FL',true) returning id`,[W])).rows[0].id;
 return {db,src};
}
async function job(db:PGlite){
 const prepared=(await db.query<{j:{job_id:string;token:string}|null}>(`select crm_private.prepare_discovery() j`)).rows[0].j;
 assert.ok(prepared,'a job is dispatched');
 const started=(await db.query<{s:Record<string,unknown>|null}>(`select public.crm_start_discovery_job($1,$2) s`,[prepared!.job_id,prepared!.token])).rows[0].s;
 return {...prepared!,started};
}

test('a Places source must carry its search and the worker receives it',async()=>{
 const {db}=await setup();
 await assert.rejects(db.query(`insert into public.crm_discovery_sources(workspace_id,provider,category,label,enabled) values($1,'google_places','local_businesses','x',true)`,[W]));
 const {started}=await job(db);
 assert.equal(started?.provider,'google_places');assert.equal(started?.search_text,'plumbers in Broward County, FL');
});

test('Places businesses are saved once, keep no-website leads, and the source rests 30 days',async()=>{
 const {db,src}=await setup();
 const j=await job(db);
 const page={leads:[lead('ChIJAAAAAAAAAAAA',{website:'https://a.example/'}),lead('ChIJBBBBBBBBBBBB')],next_phase:3,next_cursor:0,exhausted:true};
 const r=(await db.query<{r:Record<string,unknown>}>(`select public.crm_finish_discovery_job($1,$2,$3) r`,[j.job_id,j.token,JSON.stringify(page)])).rows[0].r;
 assert.deepEqual([r.imported,r.duplicates,r.exhausted],[2,0,true]);
 const rows=(await db.query<{company:string;website:string;industry:string;email:string|null}>(`select company,website,industry,email from public.crm_customers order by company`)).rows;
 assert.deepEqual(rows.map(x=>[x.company,x.website,x.email]),[['Biz ChIJAAAAAAAAAAAA','https://a.example/',null],['Biz ChIJBBBBBBBBBBBB','',null]]);
 assert.equal(rows[0].industry,'plumbers in Broward County, FL');
 const s=(await db.query<{phase:number;rested:boolean}>(`select phase,next_run_at>now()+interval '29 days' and next_run_at<now()+interval '31 days' rested from public.crm_discovery_sources where id=$1`,[src])).rows[0];
 assert.deepEqual([s.phase,s.rested],[3,true]);
 // The next day, the same businesses are duplicates, not new customers.
 await db.exec(`update public.crm_discovery_sources set next_run_at=now()-interval '1 minute'`);
 const k=await job(db);
 const again=(await db.query<{r:Record<string,unknown>}>(`select public.crm_finish_discovery_job($1,$2,$3) r`,[k.job_id,k.token,JSON.stringify(page)])).rows[0].r;
 assert.deepEqual([again.imported,again.duplicates],[0,2]);
});

test('Places pages cannot smuggle email or forged evidence',async()=>{
 const {db}=await setup();
 for(const bad of [lead('ChIJAAAAAAAAAAAA',{email:'info@a.example'}),lead('ChIJAAAAAAAAAAAA',{source_url:'https://evil.example/'}),lead('short')]){
  const j=await job(db);
  await assert.rejects(db.query(`select public.crm_finish_discovery_job($1,$2,$3)`,[j.job_id,j.token,JSON.stringify({leads:[bad],next_phase:3,next_cursor:0,exhausted:true})]));
  await db.exec(`update crm_private.discovery_runs set status='expired';update public.crm_discovery_sources set next_run_at=now()-interval '1 minute'`);
 }
 assert.equal((await db.query<{n:number}>(`select count(*)::int n from public.crm_customers`)).rows[0].n,0);
});

test('at most ten Places runs are dispatched per 24 hours',async()=>{
 const {db,src}=await setup();
 await db.query(`insert into crm_private.discovery_runs(source_id,token_hash,status,lease_until) select $1,md5(g::text),'completed',now() from generate_series(1,10) g`,[src]);
 assert.equal((await db.query<{j:unknown}>(`select crm_private.prepare_discovery() j`)).rows[0].j,null);
});

test('existing registry sources still save (no behavior change for FMCSA)',async()=>{
 const {db}=await setup();
 await db.exec(`update public.crm_discovery_sources set enabled=false`);
 await db.query(`insert into public.crm_discovery_sources(workspace_id,provider,category,label,enabled,cursor_id) values($1,'fmcsa_contacts','logistics','FMCSA',true,100)`,[W]);
 const j=await job(db);
 const page={leads:[{source_key:'fmcsa/101',source_url:'https://data.transportation.gov/resource/az4n-8mr2.json?dot_number=101',company:'Carrier',email:'info@carrier.example',website:'',phone:'',location:'FL'}],next_phase:0,next_cursor:101,exhausted:false};
 const r=(await db.query<{r:Record<string,unknown>}>(`select public.crm_finish_discovery_job($1,$2,$3) r`,[j.job_id,j.token,JSON.stringify(page)])).rows[0].r;
 assert.equal(r.imported,1);
});

test('registry sources that catch up still recheck after 24 hours, not 30 days',async()=>{
 const {db}=await setup();
 await db.exec(`update public.crm_discovery_sources set enabled=false`);
 await db.query(`insert into public.crm_discovery_sources(workspace_id,provider,category,label,enabled,cursor_id) values($1,'fmcsa','logistics','FMCSA',true,100)`,[W]);
 const j=await job(db);
 await db.query(`select public.crm_finish_discovery_job($1,$2,$3)`,[j.job_id,j.token,JSON.stringify({leads:[],next_phase:3,next_cursor:100,exhausted:true})]);
 const s=(await db.query<{ok:boolean}>(`select next_run_at between now()+interval '23 hours' and now()+interval '25 hours' ok from public.crm_discovery_sources where provider='fmcsa'`)).rows[0];
 assert.equal(s.ok,true);
});

test('a workspace can hold many Places searches, but not the same search twice or a second copy of a map source',async()=>{
 const {db}=await setup();
 const add=(text:string)=>db.query(`insert into public.crm_discovery_sources(workspace_id,provider,category,label,search_text,enabled) values($1,'google_places','local_businesses',$2,$2,true)`,[W,text]);
 await add('barber shops in Chicago, IL');
 await add('hair salons in Chicago, IL');
 await assert.rejects(add('Barber Shops in Chicago, IL'));
 const osm=()=>db.query(`insert into public.crm_discovery_sources(workspace_id,provider,category,label,bounds) values($1,'openstreetmap','retailers','x','[1,1,2,2]')`,[W]);
 await osm();await assert.rejects(osm());
 const fmcsa=()=>db.query(`insert into public.crm_discovery_sources(workspace_id,provider,category,label) values($1,'fmcsa','logistics','x')`,[W]);
 await fmcsa();await assert.rejects(fmcsa());
});
