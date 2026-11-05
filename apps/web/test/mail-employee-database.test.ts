import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Mail's work items: what it noted, sorted and planned, and what the owner approved. Supabase pieces
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
     if not exists(select 1 from public.crm_memberships where workspace_id=w and user_id=auth.uid() and role=r) then raise exception '403:Only the workspace owner can do this.'; end if; return auth.uid(); end $$;
   insert into crm_workspaces values('${W}','Hampton Haulers','Trucking'),('${OTHER}','Other Co','Retail');
   insert into crm_memberships values('${W}','${OWNER}','owner'),('${OTHER}','${OWNER}','owner');`);
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261104150000_mail_runs_in_workspace.sql', import.meta.url), 'utf8'));
  // The CRM token check the Mail RPCs use (defined in an earlier migration).
  await db.exec(`create function crm_private.mail_workspace(p_account uuid,p_token text) returns uuid language plpgsql security definer set search_path='' as $$
    declare w uuid; begin
     select workspace_id into w from public.crm_mail_connections where account_id=p_account and token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
     if w is null then raise exception 'Mail connection is not authorized' using errcode='42501'; end if; return w; end $$;`);
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261105090000_mail_employee.sql', import.meta.url), 'utf8'));
  await as(db, OWNER);
  const begun = await one<{state: string}>(db, `select public.mail_google_begin($1,null) r`, [W]);
  await db.query(`select public.mail_google_complete($1,$2,'dispatch@hampton.test')`, [begun.state, 'refresh-'.repeat(4)]);
  const job = (await one<{job_id: string; token: string}[]>(db, 'select crm_private.prepare_mail_passes() r'))[0]!;
  const pass = await one<{account_id: string; crm_token: string; settings: Record<string, unknown>; business: {name: string; industry: string}}>(db, 'select public.mail_pass_start($1,$2) r', [job.job_id, job.token]);
  return {db, pass, job};
}
const one = async <T,>(db: PGlite, sql: string, args: unknown[] = []) => (await db.query<{r: T}>(sql, args)).rows[0]!.r;
const as = (db: PGlite, uid: string) => db.exec(`select set_config('test.uid','${uid}',false)`);
const item = (id: string, category: string, plan: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({provider_message_id: id, thread_id: 't-' + id, from_email: 'Broker@Example.test', from_name: 'Broker', subject: 'Rate?', category, confidence: 0.95,
    summary: 's', priority: 'NORMAL', needs_owner: false, plan, draft: null, ...extra});

test('the pass gets the business and settings; new mail is noted once and sorted a few at a time', async () => {
  const {db, pass} = await database();
  assert.deepEqual(pass.business, {name: 'Hampton Haulers', industry: 'Trucking'});
  assert.deepEqual(pass.settings, {auto_clean: false, delete_junk: true, unsubscribe: false, auto_send: []}, 'autopilot starts off');
  const a = [pass.account_id, pass.crm_token];
  const notes = [{provider_message_id: 'm1', from_email: 'a@x.test', subject: 'one'}, {provider_message_id: 'm2', from_email: 'b@x.test', subject: 'two'}];
  assert.equal((await one<{noted: number}>(db, 'select public.mail_items_note($1,$2,$3) r', [...a, JSON.stringify(notes)])).noted, 2);
  assert.equal((await one<{noted: number}>(db, 'select public.mail_items_note($1,$2,$3) r', [...a, JSON.stringify(notes)])).noted, 0, 'noting is idempotent');
  assert.deepEqual((await one<{provider_message_id: string}[]>(db, 'select public.mail_items_unsorted($1,$2,1) r', a)).map(x => x.provider_message_id), ['m1']);
  await assert.rejects(db.query('select public.mail_items_note($1,$2,$3)', [pass.account_id, 'x'.repeat(72), '[]']), /not authorized/);
  // Three failed sorts and the email goes to the owner as failed instead of looping forever.
  const m2 = (await one<{id: string; provider_message_id: string}[]>(db, 'select public.mail_items_unsorted($1,$2,5) r', a)).find(x => x.provider_message_id === 'm2')!;
  for (let i = 0; i < 3; i++) await db.query('select public.mail_item_attempt($1,$2,$3,$4)', [...a, m2.id, 'model down']);
  assert.deepEqual((await one<{provider_message_id: string}[]>(db, 'select public.mail_items_unsorted($1,$2,5) r', a)).map(x => x.provider_message_id), ['m1']);
  assert.equal(await one<string>(db, `select status r from crm_private.mail_items where provider_message_id='m2'`), 'failed');
  await db.close();
});

test('nothing runs on the model\'s say-so: items wait for the owner unless the owner turned that kind on', async () => {
  const {db, pass} = await database();
  const a = [pass.account_id, pass.crm_token];
  const rec = async (it: unknown) => one<{status: string; id: string; duplicate: boolean}>(db, 'select public.mail_item_record($1,$2,$3) r', [...a, JSON.stringify(it)]);
  assert.equal((await rec(item('j1', 'JUNK', {action: 'trash', unsubscribe: false}))).status, 'pending');
  assert.equal((await rec(item('q1', 'QUOTE_REQUEST', {action: 'reply'}, {draft: 'Rate is $500.'}))).status, 'pending');
  assert.equal((await rec(item('p1', 'PERSONAL', {action: 'none'}))).status, 'info');
  await as(db, OWNER);
  await db.query('select public.mail_settings($1,$2)', [W, JSON.stringify({auto_clean: true, delete_junk: true, unsubscribe: false, auto_send: ['QUOTE_REQUEST']})]);
  assert.equal((await rec(item('j2', 'JUNK', {action: 'trash', unsubscribe: false}))).status, 'approved', 'cleanup on autopilot');
  assert.equal((await rec(item('j3', 'JUNK', {action: 'trash'}, {needs_owner: true}))).status, 'pending', 'never on autopilot when the owner was alerted');
  assert.equal((await rec(item('q2', 'QUOTE_REQUEST', {action: 'reply'}, {draft: 'Rate is $500.'}))).status, 'approved');
  assert.equal((await rec(item('q3', 'QUOTE_REQUEST', {action: 'reply', needs_review: true}, {draft: 'A rate will follow.'}))).status, 'pending', 'no price → a person reviews');
  assert.equal((await rec(item('q4', 'QUESTION', {action: 'reply'}, {draft: 'Yes.'}))).status, 'pending', 'questions were not put on autopilot');
  assert.equal((await rec(item('j2', 'NEWSLETTER', {action: 'archive'}))).duplicate, true, 'a sorted item is never re-sorted');
  await assert.rejects(db.query('select public.mail_settings($1,$2)', [W, JSON.stringify({auto_clean: true, delete_junk: true, unsubscribe: false, auto_send: ['JUNK']})]), /Invalid/);
  await db.close();
});

test('the owner approves (with an edited reply) or skips; the pass carries out approved items once', async () => {
  const {db, pass} = await database();
  const a = [pass.account_id, pass.crm_token];
  const q = await one<{id: string}>(db, 'select public.mail_item_record($1,$2,$3) r', [...a, JSON.stringify(item('q1', 'QUOTE_REQUEST', {action: 'reply'}, {draft: 'draft'}))]);
  const j = await one<{id: string}>(db, 'select public.mail_item_record($1,$2,$3) r', [...a, JSON.stringify(item('j1', 'JUNK', {action: 'trash'}))]);
  await as(db, STRANGER);
  await assert.rejects(db.query(`select public.mail_item_decide($1,$2,'approve',null)`, [W, q.id]), /owner/);
  await assert.rejects(db.query(`select public.mail_items_list($1,null)`, [W]), /owner/);
  await as(db, OWNER);
  assert.equal((await one<unknown[]>(db, `select public.mail_items_list($1,'pending') r`, [W])).length, 2);
  assert.equal((await one<unknown[]>(db, `select public.mail_items_list($1,null) r`, [OTHER])).length, 0, 'each workspace sees only its own mail');
  await db.query(`select public.mail_item_decide($1,$2,'approve','Edited: $650 all-in.')`, [W, q.id]);
  await db.query(`select public.mail_item_decide($1,$2,'skip',null)`, [W, j.id]);
  await assert.rejects(db.query(`select public.mail_item_decide($1,$2,'approve',null)`, [W, j.id]), /already handled/);
  const due = await one<{id: string; draft: string}[]>(db, 'select public.mail_items_due($1,$2,10) r', a);
  assert.deepEqual(due.map(d => [d.id, d.draft]), [[q.id, 'Edited: $650 all-in.']]);
  assert.equal((await one<{ok: boolean}>(db, 'select public.mail_item_done($1,$2,$3,true,$4) r', [...a, q.id, '{"sent":{}}'])).ok, true);
  assert.equal((await one<{ok: boolean}>(db, 'select public.mail_item_done($1,$2,$3,true,$4) r', [...a, q.id, '{}'])).ok, false, 'done only once');
  assert.deepEqual(await one<unknown[]>(db, 'select public.mail_items_due($1,$2,10) r', a), []);
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from crm_private.mail_items'), /permission denied/);
  await assert.rejects(db.query(`select public.mail_items_list($1,null)`, [W]), /permission denied/);
  await db.exec('reset role');
  await db.close();
});

test('the pass report keeps what the employee did', async () => {
  const {db, job} = await database();
  await db.query('select public.mail_pass_finish($1,$2,$3)', [job.job_id, job.token, {result: 'healthy', ingested: 4, sent: 0, employee: {sorted: 3, done: 1, failed: 0}}]);
  assert.deepEqual(await one<unknown>(db, `select last_report->'employee' r from crm_private.mail_google`), {sorted: 3, done: 1, failed: 0});
  await db.close();
});
