import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Outreach autopilot: when a queued first email may go, and who is never emailed. Supabase pieces
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
  await as(db, OWNER);
  const begun = await one<{state: string}>(db, `select public.mail_google_begin($1,null) r`, [W]);
  await db.query(`select public.mail_google_complete($1,$2,'dispatch@hampton.test')`, [begun.state, 'refresh-'.repeat(4)]);
  const job = (await one<{job_id: string; token: string}[]>(db, 'select crm_private.prepare_mail_passes() r'))[0]!;
  const pass = await one<{account_id: string; crm_token: string; settings: Record<string, unknown>; business: {name: string; industry: string}}>(db, 'select public.mail_pass_start($1,$2) r', [job.job_id, job.token]);
  return {db, pass, job};
}
const one = async <T,>(db: PGlite, sql: string, args: unknown[] = []) => (await db.query<{r: T}>(sql, args)).rows[0]!.r;
const as = (db: PGlite, uid: string) => db.exec(`select set_config('test.uid','${uid}',false)`);

// Fri 2026-11-06 10:00 Eastern (EST, UTC-5) unless a test moves the clock.
const at = (db: PGlite, iso: string) => db.exec(`create or replace function crm_private.mail_now() returns timestamptz language sql stable set search_path='' as $$ select '${iso}'::timestamptz $$`);
const FRI_10AM = '2026-11-06T15:00:00Z';

async function queue(db: PGlite, accountId: string, rows: {to: string; customer?: string | null; draft?: string | null}[]) {
  for (const [i, r] of rows.entries()) await db.query(`insert into crm_private.mail_outreach(workspace_id, account_id, customer_id, to_email, subject, body, gmail_draft_id, created_at)
    values($1,$2,$3,$4,'Freight for your trucks',$5,$6, now() + make_interval(secs => $7))`, [W, accountId, r.customer ?? null, r.to, r.draft ? null : 'Body', r.draft ?? null, i]);
}
const next = (db: PGlite, a: string[]) => one<{id?: string; to_email?: string; reason?: string; gmail_draft_id?: string}>(db, 'select public.mail_outreach_next($1,$2) r', a);
const done = (db: PGlite, a: string[], id: string, status = 'sent') => db.query('select public.mail_outreach_done($1,$2,$3,$4,$5,$6)', [...a, id, status, '', 'gm-' + id]);

test('outreach is off until the owner turns it on, and only for that mailbox', async () => {
  const {db, pass} = await database();
  const a = [pass.account_id, pass.crm_token];
  await at(db, FRI_10AM);
  await queue(db, pass.account_id, [{to: 'info@carrier.test'}]);
  assert.equal((await next(db, a)).reason, 'off');
  await as(db, STRANGER);
  await assert.rejects(db.query(`select public.mail_outreach_set($1,'dispatch@hampton.test',true,10)`, [W]), /owner/);
  await as(db, OWNER);
  await assert.rejects(db.query(`select public.mail_outreach_set($1,'dispatch@hampton.test',true,26)`, [W]), /between 1 and 25/);
  await assert.rejects(db.query(`select public.mail_outreach_set($1,'nobody@hampton.test',true,10)`, [W]), /not connected/);
  const st = await one<{mailbox: string; enabled: boolean; daily_limit: number; queued: number}[]>(db, `select public.mail_outreach_set($1,'Dispatch@Hampton.test',true,10) r`, [W]);
  assert.deepEqual(st.map(b => [b.mailbox, b.enabled, b.daily_limit, b.queued]), [['dispatch@hampton.test', true, 10, 1]]);
  assert.equal((await next(db, a)).to_email, 'info@carrier.test');
  await db.close();
});

test('weekdays 9 to 4 Eastern only, spaced out, and never more than the daily number', async () => {
  const {db, pass} = await database();
  const a = [pass.account_id, pass.crm_token];
  await db.query(`select public.mail_outreach_set($1,'dispatch@hampton.test',true,2)`, [W]);
  await queue(db, pass.account_id, [{to: 'a@one.test'}, {to: 'b@two.test'}, {to: 'c@three.test'}]);
  await at(db, '2026-11-06T13:59:00Z'); // 8:59 Friday
  assert.equal((await next(db, a)).reason, 'outside hours');
  await at(db, '2026-11-07T15:00:00Z'); // Saturday
  assert.equal((await next(db, a)).reason, 'outside hours');
  await at(db, '2026-11-06T21:00:00Z'); // 4:00pm Friday
  assert.equal((await next(db, a)).reason, 'outside hours');
  await at(db, FRI_10AM);
  const first = await next(db, a);
  assert.equal(first.to_email, 'a@one.test');
  assert.equal((await next(db, a)).reason, 'spacing', 'one being sent counts: no second send right behind it');
  await done(db, a, first.id!);
  await at(db, '2026-11-06T18:00:00Z'); // 1:00pm: only 3 hours later, 2 a day are 210 minutes apart
  assert.equal((await next(db, a)).reason, 'spacing');
  await at(db, '2026-11-06T18:30:00Z'); // 1:30pm: 3.5 hours later, allowed
  const second = await next(db, a);
  assert.equal(second.to_email, 'b@two.test');
  await done(db, a, second.id!);
  await at(db, '2026-11-06T20:30:00Z');
  assert.equal((await next(db, a)).reason, 'daily limit reached');
  await at(db, '2026-11-09T14:30:00Z'); // Monday 9:30
  assert.equal((await next(db, a)).to_email, 'c@three.test');
  await db.close();
});

test('a send is recorded once and logged on the company; a claimed email is never handed out twice', async () => {
  const {db, pass} = await database();
  const a = [pass.account_id, pass.crm_token];
  await at(db, FRI_10AM);
  await db.query(`select public.mail_outreach_set($1,'dispatch@hampton.test',true,10)`, [W]);
  const c = await one<string>(db, `insert into crm_customers(workspace_id, company, email) values($1,'Carrier','info@carrier.test') returning id r`, [W]);
  await queue(db, pass.account_id, [{to: 'info@carrier.test', customer: c, draft: 'r123'}]);
  const n = await next(db, a);
  assert.equal(n.gmail_draft_id, 'r123');
  await done(db, a, n.id!);
  await assert.rejects(done(db, a, n.id!), /already handled/);
  assert.equal(await one<string>(db, `select title r from crm_activity where customer_id=$1`, [c]), 'Outreach sent to info@carrier.test: Freight for your trucks');
  await assert.rejects(db.query(`insert into crm_private.mail_outreach(workspace_id, account_id, to_email, body) values($1,$2,'INFO@carrier.test','x')`, [W, pass.account_id]), /duplicate/, 'one email per address per mailbox');
  await assert.rejects(db.query('select public.mail_outreach_next($1,$2)', [pass.account_id, 'x'.repeat(72)]), /not authorized/);
  await db.close();
});

test('suppressed companies and anyone who already wrote to us are skipped, not emailed', async () => {
  const {db, pass} = await database();
  const a = [pass.account_id, pass.crm_token];
  await at(db, FRI_10AM);
  await db.query(`select public.mail_outreach_set($1,'dispatch@hampton.test',true,10)`, [W]);
  const sup = await one<string>(db, `insert into crm_customers(workspace_id, company, suppressed) values($1,'Gone',true) returning id r`, [W]);
  await db.query('select public.mail_items_note($1,$2,$3)', [...a, JSON.stringify([{provider_message_id: 'in1', from_email: 'Owner@Talking.test', subject: 'Rate?'}])]);
  await db.query('select public.mail_items_note($1,$2,$3)', [...a, JSON.stringify([{provider_message_id: 'in2', from_email: 'friend@gmail.com', subject: 'hi'}])]);
  await queue(db, pass.account_id, [{to: 'info@gone.test', customer: sup}, {to: 'dispatch@talking.test'}, {to: 'other@gmail.com'}]);
  assert.equal((await next(db, a)).to_email, 'other@gmail.com', 'a shared provider domain is not "the same company"');
  const skipped = (await db.query<{to_email: string; detail: string}>(`select to_email, detail from crm_private.mail_outreach where status='skipped' order by to_email`)).rows;
  assert.deepEqual(skipped.map(r => r.to_email), ['dispatch@talking.test', 'info@gone.test']);
  assert.match(skipped[0]!.detail, /already written to us/);
  await db.close();
});

test('a reply stops outreach to that company; "no thanks" and bounces suppress it in the CRM', async () => {
  const {db, pass} = await database();
  const a = [pass.account_id, pass.crm_token];
  await at(db, FRI_10AM);
  await db.query(`select public.mail_outreach_set($1,'dispatch@hampton.test',true,10)`, [W]);
  const ids = await Promise.all(['Yes Co', 'No Co', 'Dead Co'].map(n => one<string>(db, `insert into crm_customers(workspace_id, company) values($1,$2) returning id r`, [W, n])));
  await queue(db, pass.account_id, [{to: 'info@yes.test', customer: ids[0]}, {to: 'info@no.test', customer: ids[1]}, {to: 'info@dead.test', customer: ids[2]}]);
  await db.query(`update crm_private.mail_outreach set status='sent', sent_at=now()`);
  await db.query('select public.mail_outreach_replies($1,$2,$3)', [...a, JSON.stringify([
    {from_email: 'joe@yes.test', opt_out: false}, {from_email: 'info@no.test', opt_out: true}, {bounce_recipient: 'info@dead.test'}])]);
  const rows = (await db.query<{to_email: string; status: string; suppressed: boolean}>(`select o.to_email, o.status, c.suppressed from crm_private.mail_outreach o join crm_customers c on c.id=o.customer_id order by o.to_email`)).rows;
  assert.deepEqual(rows.map(r => [r.to_email, r.status, r.suppressed]), [['info@dead.test', 'bounced', true], ['info@no.test', 'replied', true], ['info@yes.test', 'replied', false]]);
  await db.close();
});
