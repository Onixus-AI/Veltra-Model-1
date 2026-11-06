import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Rate request cleanup: which threads are looked at, and nothing from the backlog without the owner. Supabase pieces
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
  await as(db, OWNER);
  const begun = await one<{state: string}>(db, `select public.mail_google_begin($1,null) r`, [W]);
  await db.query(`select public.mail_google_complete($1,$2,'dispatch@hampton.test')`, [begun.state, 'refresh-'.repeat(4)]);
  const job = (await one<{job_id: string; token: string}[]>(db, 'select crm_private.prepare_mail_passes() r'))[0]!;
  const pass = await one<{account_id: string; crm_token: string; settings: Record<string, unknown>; business: {name: string; industry: string}}>(db, 'select public.mail_pass_start($1,$2) r', [job.job_id, job.token]);
  return {db, pass, job};
}
const one = async <T,>(db: PGlite, sql: string, args: unknown[] = []) => (await db.query<{r: T}>(sql, args)).rows[0]!.r;
const as = (db: PGlite, uid: string) => db.exec(`select set_config('test.uid','${uid}',false)`);


const due = (db: PGlite, a: string[]) => one<{days: number | null; search_backlog: boolean; threads: {id: string; thread_id: string}[]}>(db, 'select public.mail_quote_cleanup_due($1,$2,15) r', a);
const setDays = (db: PGlite, days: number | null) => db.query(`update crm_private.mail_google set settings = settings || jsonb_build_object('quote_cleanup_days', $1::int)`, [days]);
async function quoteItem(db: PGlite, a: string[], id: string, thread: string, daysAgo: number, category = 'QUOTE_REQUEST') {
  await db.query('select public.mail_items_note($1,$2,$3)', [...a, JSON.stringify([{provider_message_id: id, thread_id: thread, from_email: 'rates@broker.test', subject: 'Rate request'}])]);
  await db.query(`update crm_private.mail_items set category=$2, created_at = now() - make_interval(days => $3) where provider_message_id=$1`, [id, category, daysAgo]);
}

test('off until a cleanup period is set; the setting only takes the offered periods', async () => {
  const {db, pass} = await database();
  const a = [pass.account_id, pass.crm_token];
  await quoteItem(db, a, 'm1', 't1', 20);
  assert.deepEqual(await due(db, a), {days: null, search_backlog: false, threads: []});
  const ok = await one<boolean>(db, `select crm_private.mail_settings_valid('{"auto_clean":false,"delete_junk":true,"unsubscribe":false,"auto_send":[],"quote_cleanup_days":10}') r`);
  const bad = await one<boolean>(db, `select crm_private.mail_settings_valid('{"auto_clean":false,"delete_junk":true,"unsubscribe":false,"auto_send":[],"quote_cleanup_days":1}') r`);
  assert.deepEqual([ok, bad], [true, false]);
  await db.close();
});

test('only rate requests older than the period are picked up, once per thread', async () => {
  const {db, pass} = await database();
  const a = [pass.account_id, pass.crm_token];
  await setDays(db, 10);
  await quoteItem(db, a, 'm1', 't1', 12);
  await quoteItem(db, a, 'm2', 't1', 11);
  await quoteItem(db, a, 'm3', 't2', 4);
  await quoteItem(db, a, 'm4', 't3', 30, 'QUESTION');
  const d = await due(db, a);
  assert.deepEqual([d.days, d.search_backlog, d.threads.map(t => t.thread_id)], [10, true, ['t1']]);
  await assert.rejects(db.query('select public.mail_quote_cleanup_due($1,$2,15)', [pass.account_id, 'x'.repeat(72)]), /not authorized/);
  await db.close();
});

test('an active thread comes back once it has been quiet for the period; trashed threads never come back', async () => {
  const {db, pass} = await database();
  const a = [pass.account_id, pass.crm_token];
  await setDays(db, 10);
  await quoteItem(db, a, 'm1', 't1', 15);
  const [t] = (await due(db, a)).threads;
  await db.query('select public.mail_quote_cleanup_result($1,$2,$3,$4,$5,$6,$7)', [...a, t!.id, 'waiting', new Date(Date.now() - 2 * 86_400_000).toISOString(), 0, 'Still active']);
  assert.deepEqual((await due(db, a)).threads, [], 'not again until 10 days after the last message');
  const after = await one<string>(db, `select (check_after - now())::text r from crm_private.mail_quote_cleanup where id=$1`, [t!.id]);
  assert.match(after, /^7 days 23:5/);
  await db.query(`update crm_private.mail_quote_cleanup set check_after = now() - interval '1 minute'`);
  await db.query('select public.mail_quote_cleanup_result($1,$2,$3,$4,$5,$6,$7)', [...a, t!.id, 'trashed', null, 2, 'Moved to Trash.']);
  assert.deepEqual((await due(db, a)).threads, []);
  await assert.rejects(db.query('select public.mail_quote_cleanup_result($1,$2,$3,$4,$5,$6,$7)', [...a, t!.id, 'trashed', null, 1, 'again']), /already handled/);
  await db.close();
});

test('backlog finds are proposals: never handed out until the owner approves; "keep" leaves them alone', async () => {
  const {db, pass} = await database();
  const a = [pass.account_id, pass.crm_token];
  await setDays(db, 10);
  await db.query('select public.mail_quote_backlog_add($1,$2,$3)', [...a, JSON.stringify([
    {thread_id: 'b1', subject: 'Rate req NIT', from_email: 'x@broker.test', last_message_at: '2026-09-01T00:00:00Z'},
    {thread_id: 'b2', subject: 'Quote please', from_email: 'y@broker.test', last_message_at: '2026-09-02T00:00:00Z'},
    {thread_id: 'b3', subject: 'RFQ', from_email: 'z@broker.test', last_message_at: '2026-09-03T00:00:00Z'}])]);
  const d = await due(db, a);
  assert.deepEqual([d.search_backlog, d.threads], [false, []], 'searched once; proposals are not due');
  const list = await one<{proposed: {id: string; subject: string}[]}>(db, 'select public.mail_quote_cleanup_list($1) r', [W]);
  assert.deepEqual(list.proposed.map(p => p.subject), ['RFQ', 'Quote please', 'Rate req NIT']);
  await as(db, STRANGER);
  await assert.rejects(db.query('select public.mail_quote_cleanup_decide($1,null,true)', [W]), /owner/);
  await as(db, OWNER);
  await db.query('select public.mail_quote_cleanup_decide($1,$2,false)', [W, [list.proposed[0]!.id]]);
  await db.query('select public.mail_quote_cleanup_decide($1,null,true)', [W]);
  assert.deepEqual((await due(db, a)).threads.map(t => t.thread_id).sort(), ['b1', 'b2']);
  await db.close();
});
