import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {actionChange, cleanHtml, gmailId, listQuery, liveBox, recipients, toRow, toThread} from '../lib/mail/live-box';
import {buildMime} from '../lib/revenue/mail-provider';

// Live Mail: the Gmail-style screen reads folders and threads and sends only what the owner wrote.
const b64 = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const h = (name: string, value: string) => ({name, value});

test('folders, inbox tabs, labels and search map to Gmail list parameters', () => {
  const inbox = new URLSearchParams(listQuery({folder: 'inbox', tab: 'primary'}));
  assert.deepEqual(inbox.getAll('labelIds'), ['INBOX', 'CATEGORY_PERSONAL']);
  assert.equal(inbox.get('includeSpamTrash'), null);
  const trash = new URLSearchParams(listQuery({folder: 'trash'}));
  assert.deepEqual(trash.getAll('labelIds'), ['TRASH']);
  assert.equal(trash.get('includeSpamTrash'), 'true');
  const all = new URLSearchParams(listQuery({folder: 'all', q: '  from:acme  ', pageToken: 'abc'}));
  assert.deepEqual(all.getAll('labelIds'), []);
  assert.equal(all.get('q'), 'from:acme');
  assert.equal(all.get('pageToken'), 'abc');
  assert.deepEqual(new URLSearchParams(listQuery({folder: 'inbox', tab: 'updates', label: 'Label_7'})).getAll('labelIds'), ['Label_7']);
});

test('ids are validated before they reach a Gmail URL', () => {
  assert.equal(gmailId('18c2fa9b0e1d'), true);
  assert.equal(gmailId('../labels'), false);
  assert.equal(gmailId('a/b'), false);
  assert.equal(gmailId(''), false);
  assert.equal(gmailId('x'.repeat(201)), false);
});

test('a row names the latest other sender, and flags unread, star and attachments', () => {
  const row = toRow({id: 't1', snippet: 'Can you quote &amp; confirm?', messages: [
    {id: 'm1', threadId: 't1', labelIds: ['INBOX'], internalDate: '1000', payload: {mimeType: 'multipart/mixed', headers: [h('From', 'Dana Ruiz <dana@acme.test>'), h('Subject', 'Rate for Savannah')]}},
    {id: 'm2', threadId: 't1', labelIds: ['SENT', 'STARRED'], internalDate: '2000', payload: {mimeType: 'text/plain', headers: [h('From', 'Omar <info@onixus.xyz>'), h('Subject', 'Re: Rate for Savannah')]}},
    {id: 'm3', threadId: 't1', labelIds: ['INBOX', 'UNREAD'], internalDate: '3000', payload: {mimeType: 'text/plain', headers: [h('From', 'Dana Ruiz <dana@acme.test>')]}},
  ]}, 'info@onixus.xyz');
  assert.equal(row.fromName, 'Dana Ruiz');
  assert.equal(row.subject, 'Rate for Savannah');
  assert.equal(row.snippet, 'Can you quote & confirm?');
  assert.equal(row.unread, true);
  assert.equal(row.starred, true);
  assert.equal(row.attachment, true);
  assert.equal(row.count, 3);
  assert.equal(row.sent, false);
  assert.equal(row.at, new Date(3000).toISOString());
  const mine = toRow({id: 't2', messages: [{id: 'x', threadId: 't2', labelIds: ['SENT'], internalDate: '5', payload: {headers: [h('From', 'info@onixus.xyz'), h('Subject', 'Hello')]}}]}, 'info@onixus.xyz');
  assert.equal(mine.sent, true);
});

test('a thread carries text, cleaned HTML, threading ids and attachments', () => {
  const t = toThread({id: 't1', messages: [{id: 'm1', threadId: 't1', labelIds: ['INBOX', 'UNREAD'], internalDate: '1000', payload: {mimeType: 'multipart/mixed', headers: [
    h('From', '"Dana" <dana@acme.test>'), h('To', 'info@onixus.xyz'), h('Subject', 'BOL attached'), h('Message-ID', '<abc@acme.test>'), h('References', '<root@acme.test>')], parts: [
    {mimeType: 'multipart/alternative', parts: [{mimeType: 'text/plain', body: {data: b64('Plain body')}}, {mimeType: 'text/html', body: {data: b64('<p onclick="x()">Hi</p><script>steal()</script><a href="javascript:bad()">x</a>')}}]},
    {mimeType: 'application/pdf', filename: 'bol.pdf', body: {attachmentId: 'ATT1', size: 2048}}]}}]});
  const m = t.messages[0]!;
  assert.equal(m.text, 'Plain body');
  assert.equal(m.messageIdHeader, '<abc@acme.test>');
  assert.equal(m.references, '<root@acme.test>');
  assert.equal(m.unread, true);
  assert.deepEqual(m.attachments, [{id: 'ATT1', filename: 'bol.pdf', mimeType: 'application/pdf', size: 2048}]);
  assert.ok(m.html && !/script|onclick|javascript:/i.test(m.html), m.html ?? '');
});

test('email HTML loses scripts, frames, handlers and javascript links', () => {
  const out = cleanHtml('<div onload=go()>ok</div><iframe src="x"></iframe><meta http-equiv="refresh" content="0;url=x"><img src="a.png" onerror="z()"><form action=x><input></form>');
  assert.ok(!/iframe|onload|onerror|meta|form/i.test(out), out);
  assert.match(out, /<img src="a.png">/);
  // Email layout styles are kept (the frame allows inline styles only).
  assert.equal(cleanHtml('<style>p{color:red}</style><p>x</p>'), '<style>p{color:red}</style><p>x</p>');
  assert.equal(cleanHtml('<SCRIPT type="x">a()</SCRIPT >b'), 'b');
});

test('thread actions are recoverable label changes or Trash', () => {
  assert.deepEqual(actionChange('archive'), {add: [], remove: ['INBOX']});
  assert.deepEqual(actionChange('spam'), {add: ['SPAM'], remove: ['INBOX']});
  assert.equal(actionChange('trash'), 'trash');
  assert.deepEqual(actionChange('read'), {add: [], remove: ['UNREAD']});
});

test('recipients must be plain addresses, deduplicated, at most 50', () => {
  assert.equal(recipients('Dana <dana@acme.test>, ops@acme.test; dana@acme.test', 'To', true), 'dana@acme.test, ops@acme.test');
  assert.equal(recipients('', 'Cc'), null);
  assert.throws(() => recipients('', 'To', true), /400:Add at least one To/);
  assert.throws(() => recipients('not-an-address', 'To', true), /is not an email address/);
  assert.throws(() => recipients('a@b.co\r\nBcc: x@y.co', 'To', true), /is not an email address/);
  assert.throws(() => recipients(Array.from({length: 51}, (_, i) => `p${i}@x.co`).join(','), 'To', true), /50 or fewer/);
});

test('Bcc is carried in the MIME so Gmail delivers it (and strips it)', () => {
  const mime = buildMime({idempotencyKey: 'k1', from: 'info@onixus.xyz', to: 'a@x.co', bcc: 'hidden@x.co', subject: 'Hi', body: 'Body'});
  assert.match(mime, /\r\nBcc: hidden@x\.co\r\n/);
});

function fakeApi() {
  const calls: {method: string; path: string; body?: string}[] = [];
  let sentBefore = false;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === 'oauth2.googleapis.com') return Response.json({access_token: 'AT', expires_in: 3600});
    const path = url.pathname.replace('/gmail/v1/users/me', '') + url.search;
    calls.push({method: init?.method ?? 'GET', path, body: init?.body as string | undefined});
    if (path.startsWith('/messages?')) return Response.json(sentBefore ? {messages: [{id: 'old', threadId: 'T'}]} : {});
    if (path === '/settings/sendAs') return Response.json({sendAs: []});
    if (path === '/messages/send') { sentBefore = true; return Response.json({id: 'new', threadId: 'T'}); }
    if (path.startsWith('/threads?')) return Response.json({threads: [{id: 'T1', snippet: 's'}], nextPageToken: 'P2'});
    if (path.startsWith('/threads/T1?')) return Response.json({id: 'T1', messages: [{id: 'm', threadId: 'T1', labelIds: ['INBOX'], internalDate: '1', payload: {headers: [h('From', 'a@x.co'), h('Subject', 'Hey')]}}]});
    if (path.endsWith('/modify') || path.endsWith('/trash')) return Response.json({});
    return new Response('{}', {status: 404});
  }) as typeof fetch;
  return {calls, fetcher};
}
const creds = {clientId: 'c', clientSecret: 's', refreshToken: 'r'};

test('send goes out once per key: a repeated click finds the earlier send and does not send again', async () => {
  const api = fakeApi();
  const box = liveBox(creds, 'info@onixus.xyz', {fetcher: api.fetcher, senderName: 'Omar Harris'});
  const c = {idempotencyKey: '7d1f2c8e-1111-4c4c-8888-123456789abc', to: 'dana@acme.test', subject: 'Quote', body: 'Here you go'};
  const first = await box.send(c);
  assert.equal(first.duplicate, false);
  const raw = JSON.parse(api.calls.find(x => x.path === '/messages/send')!.body!).raw as string;
  const mime = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  assert.match(mime, /From: "Omar Harris" <info@onixus\.xyz>/);
  const again = await box.send(c);
  assert.equal(again.duplicate, true);
  assert.equal(api.calls.filter(x => x.path === '/messages/send').length, 1);
});

test('list returns rows and the next page; actions modify the whole thread', async () => {
  const api = fakeApi();
  const box = liveBox(creds, 'info@onixus.xyz', {fetcher: api.fetcher});
  const page = await box.list({folder: 'inbox', tab: 'primary'});
  assert.equal(page.rows[0]!.subject, 'Hey');
  assert.equal(page.next, 'P2');
  await box.act('T1', 'archive');
  await box.act('T1', 'trash');
  const modify = api.calls.find(x => x.path === '/threads/T1/modify')!;
  assert.deepEqual(JSON.parse(modify.body!), {addLabelIds: [], removeLabelIds: ['INBOX']});
  assert.ok(api.calls.some(x => x.path === '/threads/T1/trash' && x.method === 'POST'));
});

// The database side: only the server may release Gmail access, and only for the business owner.
const W = '00000000-0000-4000-8000-000000000001', OTHER = '00000000-0000-4000-8000-000000000002';
const OWNER = '00000000-0000-4000-8000-0000000000a1', MEMBER = '00000000-0000-4000-8000-0000000000a2', STRANGER = '00000000-0000-4000-8000-0000000000a3';
test('mail_live_access: owner only, active mailbox only, never granted to the browser roles', async () => {
  const db = new PGlite();
  await db.exec(`
   create role anon; create role authenticated; create role service_role;
   create schema vault; create schema crm_private;
   create table vault.secrets(id uuid primary key default gen_random_uuid(), secret text);
   create view vault.decrypted_secrets as select id, secret decrypted_secret from vault.secrets;
   create table public.crm_memberships(workspace_id uuid, user_id uuid, role text);
   create table crm_private.mail_google(account_id uuid primary key default gen_random_uuid(), workspace_id uuid, mailbox text, status text, sender_name text, refresh_secret uuid, connected_at timestamptz default now());
   insert into vault.secrets(id, secret) values ('00000000-0000-4000-8000-00000000f001','refresh-info'),('00000000-0000-4000-8000-00000000f002','refresh-oh');
   insert into crm_memberships values('${W}','${OWNER}','owner'),('${W}','${MEMBER}','member'),('${OTHER}','${STRANGER}','owner');
   insert into crm_private.mail_google(workspace_id, mailbox, status, refresh_secret, connected_at) values
     ('${W}','info@onixus.xyz','active','00000000-0000-4000-8000-00000000f001', now() - interval '2 days'),
     ('${W}','o.harris@onixus.xyz','active','00000000-0000-4000-8000-00000000f002', now() - interval '1 day'),
     ('${W}','old@onixus.xyz','disconnected', null, now());`);
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261125010000_mail_live_access.sql', import.meta.url), 'utf8'));
  const call = async (user: string, mailbox: string | null) => (await db.query<{r: {mailbox: string; refresh_token: string; mailboxes: string[]}}>(
    'select public.mail_live_access($1,$2,$3) r', [user, W, mailbox])).rows[0]!.r;
  const first = await call(OWNER, null);
  assert.equal(first.mailbox, 'info@onixus.xyz');
  assert.equal(first.refresh_token, 'refresh-info');
  assert.deepEqual(first.mailboxes, ['info@onixus.xyz', 'o.harris@onixus.xyz']);
  assert.equal((await call(OWNER, ' O.Harris@onixus.xyz ')).refresh_token, 'refresh-oh');
  await assert.rejects(call(OWNER, 'old@onixus.xyz'), /409:Connect Gmail first/);
  await assert.rejects(call(MEMBER, null), /403:Only the business owner/);
  await assert.rejects(call(STRANGER, null), /404:Workspace not found/);
  const grants = await db.query<{grantee: string}>(`select grantee from information_schema.routine_privileges where routine_name='mail_live_access' order by grantee`);
  const who = grants.rows.map(g => g.grantee);
  assert.ok(who.includes('service_role'));
  assert.ok(!who.includes('anon') && !who.includes('authenticated') && !who.includes('PUBLIC'), who.join(','));
});
