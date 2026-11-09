import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Sender name per mailbox: only the owner sets it, plain names only, and the mail pass receives it. Supabase pieces
// (Vault, pg_net, auth.uid, pgcrypto) are stubbed as in workspace-mail-database.test.ts.
const W = '00000000-0000-4000-8000-000000000001', OTHER = '00000000-0000-4000-8000-000000000002';
const OWNER = '00000000-0000-4000-8000-0000000000a1', STRANGER = '00000000-0000-4000-8000-0000000000a2';

async function database() {
  const db = new PGlite();
  await db.exec(`
   create role anon; create role authenticated;
   create schema extensions; create schema vault; create schema net; create schema auth; create schema revenue_private;
   create function extensions.digest(b bytea, alg text) returns bytea language sql immutable as $$ select pg_catalog.sha256(b) $$;
   create function extensions.gen_random_bytes(n int) returns bytea language sql volatile as $$ select substring(decode(md5(random()::text)||md5(random()::text)||md5(random()::text),'hex') from 1 for n) $$;
   create table vault.secrets(id uuid primary key default gen_random_uuid(), name text unique, secret text);
   create function vault.create_secret(s text, n text, d text) returns uuid language sql as $$ insert into vault.secrets(name,secret) values(n,s) returning id $$;
   create function vault.update_secret(i uuid, s text) returns void language sql as $$ update vault.secrets set secret=s where id=i $$;
   create view vault.decrypted_secrets as select id, name, secret decrypted_secret from vault.secrets;
   create table net.calls(url text, body jsonb);
   create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $$ insert into net.calls values(url, body); select 1::bigint $$;
   create function auth.uid() returns uuid language sql stable as $$ select nullif(pg_catalog.current_setting('test.uid', true),'')::uuid $$;
   create table crm_workspaces(id uuid primary key, name text, industry text);
   create table crm_memberships(workspace_id uuid, user_id uuid, role text);
   create table crm_mail_connections(account_id uuid not null, workspace_id uuid not null, token_hash text not null unique, connected_by uuid, created_at timestamptz not null default now(), primary key(workspace_id, account_id));
   create table revenue_sync_state(workspace_id uuid, account_id uuid, mailbox text, cursor text);
   create function revenue_private.require_role(w uuid, r text) returns uuid language plpgsql as $$ begin
     if not exists(select 1 from public.crm_memberships where workspace_id=w and user_id=auth.uid() and (role=r or role='owner')) then raise exception '403:Only the workspace owner can do this.'; end if; return auth.uid(); end $$;
   create table crm_customers(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, company text not null, email text, suppressed boolean not null default false,
     archived_at timestamptz, merged_into_id uuid);
   create table crm_activity(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, customer_id uuid not null, kind text not null, title text not null, actor_id uuid, created_at timestamptz default now());
   insert into crm_workspaces values('${W}','Hampton Haulers','Trucking'),('${OTHER}','Other Co','Retail');
   insert into crm_memberships values('${W}','${OWNER}','owner'),('${OTHER}','${OWNER}','owner');`);
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261104150000_mail_runs_in_workspace.sql', import.meta.url), 'utf8'));
  // The CRM token check the Mail RPCs use (defined in an earlier migration).
  await db.exec(`create function crm_private.mail_workspace(p_account uuid,p_token text) returns uuid language plpgsql security definer set search_path='' as $$
    declare w uuid; begin
     select workspace_id into w from public.crm_mail_connections where account_id=p_account and token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
     if w is null then raise exception 'Mail connection is not authorized' using errcode='42501'; end if; return w; end $$;`);
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261105090000_mail_employee.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261105110000_mail_quotes.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261105190000_mail_rate_card_days.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261105210000_mail_second_mailbox.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261106090000_mail_outreach_autopilot.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261106150000_mail_quote_cleanup.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261109090000_mail_sender_name.sql', import.meta.url), 'utf8'));
  await as(db, OWNER);
  const begun = await one<{state: string}>(db, `select public.mail_google_begin($1,null) r`, [W]);
  await db.query(`select public.mail_google_complete($1,$2,'dispatch@hampton.test')`, [begun.state, 'refresh-'.repeat(4)]);
  const job = (await one<{job_id: string; token: string}[]>(db, 'select crm_private.prepare_mail_passes() r'))[0]!;
  const pass = await one<{account_id: string; crm_token: string; settings: Record<string, unknown>; business: {name: string; industry: string}}>(db, 'select public.mail_pass_start($1,$2) r', [job.job_id, job.token]);
  return {db, pass, job};
}
const one = async <T,>(db: PGlite, sql: string, args: unknown[] = []) => (await db.query<{r: T}>(sql, args)).rows[0]!.r;
const as = (db: PGlite, uid: string) => db.exec(`select set_config('test.uid','${uid}',false)`);


test('only the owner sets a sender name; plain names only; blank clears it', async () => {
  const {db} = await database();
  const names = (sql: string, args: unknown[]) => one<{mailbox: string; sender_name: string | null}[]>(db, sql, args);
  assert.deepEqual(await names('select public.mail_sender_names($1) r', [W]), [{mailbox: 'dispatch@hampton.test', sender_name: null}]);
  await as(db, STRANGER);
  await assert.rejects(db.query(`select public.mail_sender_name_set($1,'dispatch@hampton.test','Omar Harris')`, [W]), /owner/);
  await as(db, OWNER);
  assert.deepEqual(await names(`select public.mail_sender_name_set($1,'Dispatch@Hampton.test','  Omar   Harris ') r`, [W]), [{mailbox: 'dispatch@hampton.test', sender_name: 'Omar Harris'}]);
  await assert.rejects(db.query(`select public.mail_sender_name_set($1,'dispatch@hampton.test','Evil <x@y.test>')`, [W]), /plain name/);
  await assert.rejects(db.query(`select public.mail_sender_name_set($1,'nobody@hampton.test','Omar')`, [W]), /not connected/);
  assert.deepEqual(await names(`select public.mail_sender_name_set($1,'dispatch@hampton.test','   ') r`, [W]), [{mailbox: 'dispatch@hampton.test', sender_name: null}]);
  await db.close();
});

test('the mail pass receives the sender name', async () => {
  const {db, pass, job} = await database();
  assert.equal((pass as {sender_name?: unknown}).sender_name, null);
  await db.query(`select public.mail_sender_name_set($1,'dispatch@hampton.test','Omar Harris')`, [W]);
  await db.query('update crm_private.mail_passes set started_at = null, finished_at = null where id = $1', [job.job_id]);
  const again = await one<{sender_name: string}>(db, 'select public.mail_pass_start($1,$2) r', [job.job_id, job.token]);
  assert.equal(again.sender_name, 'Omar Harris');
  await db.close();
});
