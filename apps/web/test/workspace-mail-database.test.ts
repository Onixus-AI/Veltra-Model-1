import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Supabase pieces the migration relies on (Vault, pg_net, auth.uid, pgcrypto) are stubbed with the same signatures.
const W = '00000000-0000-4000-8000-000000000001', OTHER = '00000000-0000-4000-8000-000000000002';
const OWNER = '00000000-0000-4000-8000-0000000000a1', STRANGER = '00000000-0000-4000-8000-0000000000a2';
const OLD_ACCOUNT = '00000000-0000-4000-8000-0000000000c1';

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
   create table crm_workspaces(id uuid primary key);
   create table crm_memberships(workspace_id uuid, user_id uuid, role text);
   create table crm_mail_connections(account_id uuid not null, workspace_id uuid not null, token_hash text not null unique, connected_by uuid, created_at timestamptz not null default now(), primary key(workspace_id, account_id));
   create table revenue_sync_state(workspace_id uuid, account_id uuid, mailbox text, cursor text);
   create function revenue_private.require_role(w uuid, r text) returns uuid language plpgsql as $$ begin
     if not exists(select 1 from public.crm_memberships where workspace_id=w and user_id=auth.uid() and role=r) then raise exception '403:Only the workspace owner can do this.'; end if; return auth.uid(); end $$;
   insert into crm_workspaces values('${W}'),('${OTHER}');
   insert into crm_memberships values('${W}','${OWNER}','owner'),('${OTHER}','${OWNER}','owner');
   -- The mailbox Railway Mail had connected: its account id and Gmail sync position must survive.
   insert into crm_mail_connections(account_id,workspace_id,token_hash) values('${OLD_ACCOUNT}','${W}',repeat('0',64));
   insert into revenue_sync_state values('${W}','${OLD_ACCOUNT}','info@onixus.test','98765');`);
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261104150000_mail_runs_in_workspace.sql', import.meta.url), 'utf8'));
  return db;
}
const one = async <T,>(db: PGlite, sql: string, args: unknown[] = []) => (await db.query<{r: T}>(sql, args)).rows[0]!.r;
const as = (db: PGlite, uid: string) => db.exec(`select set_config('test.uid','${uid}',false)`);
const sha = async (db: PGlite, s: string) => one<string>(db, `select encode(sha256(convert_to($1,'UTF8')),'hex') r`, [s]);

test('connecting Gmail keeps the existing mailbox account, stores tokens only in Vault, and each sign-in state works once', async () => {
  const db = await database();
  await as(db, OWNER);
  assert.equal(await one<string>(db, 'select public.mail_google_home() r'), W, 'the workspace that already has a mailbox is the home');
  const begun = await one<{state: string}>(db, `select public.mail_google_begin($1,'browser-check-1') r`, [W]);
  assert.equal(begun.state.length, 72);
  const done = await one<{mailbox: string; browser: string}>(db, `select public.mail_google_complete($1,$2,'Info@Onixus.test') r`, [begun.state, 'refresh-'.repeat(4)]);
  assert.deepEqual([done.mailbox, done.browser], ['info@onixus.test', 'browser-check-1']);
  const g = (await db.query<{account_id: string; status: string}>('select account_id, status from crm_private.mail_google')).rows;
  assert.deepEqual(g, [{account_id: OLD_ACCOUNT, status: 'active'}], 'reconnecting resumes the same account and its saved sync position');
  assert.equal((await db.query(`select 1 from vault.secrets where secret like 'refresh-%'`)).rows.length, 1);
  assert.equal(await one<number>(db, `select count(*)::int r from crm_private.mail_google where refresh_secret is null`), 0);
  await assert.rejects(db.query(`select public.mail_google_complete($1,$2,'info@onixus.test')`, [begun.state, 'refresh-'.repeat(4)]), /expired/, 'a state is single-use');
  await as(db, STRANGER);
  await assert.rejects(db.query(`select public.mail_google_begin($1,null)`, [W]), /owner/);
  await db.close();
});

test('every minute each active mailbox gets one single-use pass that carries its Gmail and CRM tokens', async () => {
  const db = await database();
  await as(db, OWNER);
  const begun = await one<{state: string}>(db, `select public.mail_google_begin($1,null) r`, [W]);
  await db.query(`select public.mail_google_complete($1,$2,'info@onixus.test')`, [begun.state, 'refresh-'.repeat(4)]);
  await db.exec(`update crm_private.mail_runtime set pass_url='https://app.test/api/mail/pass'`);
  await db.exec('select crm_private.dispatch_mail_passes()');
  await db.exec('select crm_private.dispatch_mail_passes()');
  const calls = (await db.query<{url: string; body: {job_id: string; token: string}}>('select * from net.calls')).rows;
  assert.equal(calls.length, 1, 'no second pass while one is open');
  const {job_id, token} = calls[0]!.body;
  const pass = await one<{account_id: string; refresh_token: string; crm_token: string}>(db, 'select public.mail_pass_start($1,$2) r', [job_id, token]);
  assert.deepEqual([pass.account_id, pass.refresh_token], [OLD_ACCOUNT, 'refresh-'.repeat(4)]);
  assert.equal(await one<string>(db, `select token_hash r from crm_mail_connections where account_id=$1`, [OLD_ACCOUNT]), await sha(db, pass.crm_token),
    'the CRM token in the pass is the one the mail RPCs accept');
  await assert.rejects(db.query('select public.mail_pass_start($1,$2)', [job_id, token]), /unavailable/, 'a pass cannot be redeemed twice');
  await assert.rejects(db.query('select public.mail_pass_finish($1,$2,$3)', [job_id, 'x'.repeat(72), {result: 'healthy'}]), /unavailable/);
  await db.query('select public.mail_pass_finish($1,$2,$3)', [job_id, token, {result: 'healthy', ingested: 3, sent: 0}]);
  assert.equal(await one<string>(db, `select last_report->>'result' r from crm_private.mail_google`), 'healthy');
  await db.exec('select crm_private.dispatch_mail_passes()');
  assert.equal(await one<number>(db, 'select count(*)::int r from net.calls'), 2, 'the next minute gets a fresh pass');
  await db.close();
});

test('an expired Google connection stops passes, disconnect revokes the CRM token, and callers cannot reach the dispatcher', async () => {
  const db = await database();
  await as(db, OWNER);
  const begun = await one<{state: string}>(db, `select public.mail_google_begin($1,null) r`, [W]);
  await db.query(`select public.mail_google_complete($1,$2,'info@onixus.test')`, [begun.state, 'refresh-'.repeat(4)]);
  const job = (await one<{job_id: string; token: string}[]>(db, 'select crm_private.prepare_mail_passes() r'))[0]!;
  await db.query('select public.mail_pass_start($1,$2)', [job.job_id, job.token]);
  await db.query('select public.mail_pass_finish($1,$2,$3)', [job.job_id, job.token, {result: 'expired'}]);
  assert.equal(await one<string>(db, 'select status r from crm_private.mail_google'), 'expired');
  assert.deepEqual(await one<unknown[]>(db, 'select crm_private.prepare_mail_passes() r'), [], 'no passes until Gmail is reconnected');
  const before = await one<string>(db, 'select token_hash r from crm_mail_connections');
  await db.query('select public.mail_google_disconnect($1)', [W]);
  assert.notEqual(await one<string>(db, 'select token_hash r from crm_mail_connections'), before);
  assert.equal(await one<string>(db, `select secret r from vault.secrets where name like 'mail_google_refresh:%'`), 'disconnected');
  await db.exec('set role anon');
  await assert.rejects(db.query('select crm_private.prepare_mail_passes()'), /permission denied/);
  await assert.rejects(db.query('select count(*) from crm_private.mail_google'), /permission denied/);
  await db.exec('reset role');
  await db.close();
});
