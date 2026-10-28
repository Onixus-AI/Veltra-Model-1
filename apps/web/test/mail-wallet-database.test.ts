import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
test('wallet reservations are atomic, tenant-bound, idempotent and refund only unused credits',async()=>{
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create table organizations(id uuid primary key);create table crm_workspaces(id uuid primary key);create table credit_wallets(organization_id uuid primary key,credits_remaining integer,updated_at timestamptz);create table usage_logs(organization_id uuid,category text,model_used text,tokens_consumed integer,credits_deducted integer);create table credit_transactions(organization_id uuid,amount integer,description text);`);
 await db.exec(await readFile(new URL('../../../supabase/migrations/20261028043419_mail_wallet_receipts.sql',import.meta.url),'utf8'));
 const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002',w='00000000-0000-4000-8000-000000000003',r='00000000-0000-4000-8000-000000000004';
 await db.query('insert into organizations values($1),($2);',[a,b]);await db.query('insert into crm_workspaces values($1)',[w]);await db.query('insert into credit_wallets values($1,10000,now()),($2,10000,now())',[a,b]);
 const reserve=(org:string,budget=8000)=>db.query<{receipt:{status:string}}>('select reserve_mail_credits($1,$2,$3,$4,$5,$6) as receipt',[r,a,w,org,'digest',budget]);
 assert.equal((await reserve(a)).rows[0]!.receipt.status,'reserved');assert.equal((await reserve(a)).rows[0]!.receipt.status,'claimed');await assert.rejects(()=>reserve(b),/identity mismatch/);
 const finish=()=>db.query("select finish_mail_credits($1,1500,'fixture',$2,'succeeded')",[r,{id:'provider'}]);await finish();await finish();
 const wallets=(await db.query('select credits_remaining from credit_wallets order by organization_id')).rows;assert.deepEqual(wallets.map((x:any)=>x.credits_remaining),[8500,10000]);assert.equal((await db.query('select * from usage_logs')).rows.length,1);assert.equal((await reserve(a)).rows[0]!.receipt.status,'succeeded');
 await db.exec('set role authenticated');await assert.rejects(()=>reserve(a),/permission denied/);await db.exec('reset role');await db.close();
});
