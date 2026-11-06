import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {ProviderMessage} from '../lib/revenue/mail-provider';
import {MailProviderError} from '../lib/revenue/mail-provider';
import {gmailActions} from '../lib/mail/gmail-actions';
import {noteOutreachReplies, optedOut, OutreachSkip, sendOutreach} from '../lib/mail/outreach';

const msg = (o: Partial<ProviderMessage>): ProviderMessage => ({providerMessageId: 'm', threadId: 't', direction: 'inbound', from: 'dispatch@carrier.test', fromName: '',
  to: 'o.harris@onixus.test', subject: 'Re: Freight for your trucks', text: 'Sounds good, we run dry van.', occurredAt: '2026-11-06T15:00:00Z', messageIdHeader: null,
  inReplyTo: null, references: null, automated: false, attachments: [], ...o});

function harness(next: unknown, o: {sendDraft?: () => Promise<{providerMessageId: string; providerThreadId: string}>; send?: () => Promise<{providerMessageId: string; providerThreadId: string}>} = {}) {
  const calls: {fn: string; args: Record<string, unknown>}[] = [], sent: unknown[] = [];
  const d = {
    accountId: 'acct', token: 'tok', mailbox: 'o.harris@onixus.test', deadline: Date.now() + 60_000,
    rpc: (async (fn: string, args: Record<string, unknown>) => { calls.push({fn, args}); return fn === 'mail_outreach_next' ? next : {updated: 1}; }) as never,
    mail: {name: 'Gmail', address: async () => 'o.harris@onixus.test', changes: async () => ({messages: [], cursor: '', more: false}),
      send: o.send ?? (async (m: unknown) => { sent.push(m); return {providerMessageId: 'new-1', providerThreadId: 't'}; })} as never,
    gmail: {sendDraft: o.sendDraft ?? (async (id: string) => { sent.push(`draft ${id}`); return {providerMessageId: 'from-draft', providerThreadId: 't'}; })},
  };
  const done = () => calls.find(c => c.fn === 'mail_outreach_done')?.args;
  return {d, calls, sent, done};
}

test('nothing is sent when the database says not now', async () => {
  const h = harness({reason: 'outside hours'});
  assert.deepEqual(await sendOutreach(h.d), {sent: 0, reason: 'outside hours'});
  assert.equal(h.sent.length, 0);
  assert.equal(h.done(), undefined);
});

test('a queued Gmail draft is sent as it is, and recorded as sent', async () => {
  const h = harness({id: 'o1', to_email: 'info@carrier.test', subject: 'Freight for your trucks', body: null, gmail_draft_id: 'r123'});
  assert.deepEqual(await sendOutreach(h.d), {sent: 1});
  assert.deepEqual(h.sent, ['draft r123']);
  assert.deepEqual([h.done()?.p_status, h.done()?.p_provider_message_id], ['sent', 'from-draft']);
});

test('without a draft the queued text is sent once, with an idempotency key', async () => {
  const h = harness({id: 'o2', to_email: 'info@carrier.test', subject: 'Hi', body: 'Body', gmail_draft_id: null});
  await sendOutreach(h.d);
  assert.deepEqual(h.sent, [{idempotencyKey: 'mail-outreach-o2', from: 'o.harris@onixus.test', to: 'info@carrier.test', subject: 'Hi', body: 'Body'}]);
});

test('a draft deleted or re-addressed in Gmail is skipped, not retried; other errors are failed, never resent', async () => {
  const gone = harness({id: 'o3', to_email: 'a@c.test', gmail_draft_id: 'r1'}, {sendDraft: async () => { throw new MailProviderError('rejected', 'The message is no longer in Gmail.', false); }});
  assert.deepEqual(await sendOutreach(gone.d), {sent: 0, skipped: 'a@c.test'});
  assert.deepEqual([gone.done()?.p_status, gone.done()?.p_detail], ['skipped', 'The draft was deleted in Gmail.']);
  const moved = harness({id: 'o4', to_email: 'a@c.test', gmail_draft_id: 'r1'}, {sendDraft: async () => { throw new OutreachSkip('The draft in Gmail is no longer addressed to this company only.'); }});
  await sendOutreach(moved.d);
  assert.equal(moved.done()?.p_status, 'skipped');
  const down = harness({id: 'o5', to_email: 'a@c.test', body: 'x', gmail_draft_id: null}, {send: async () => { throw new MailProviderError('temporary', 'Gmail returned 503', true); }});
  assert.deepEqual(await sendOutreach(down.d), {sent: 0, failed: 'Gmail returned 503'});
  assert.equal(down.done()?.p_status, 'failed');
});

test('"no thanks" is read from the reply itself, not from our quoted email', () => {
  assert.equal(optedOut('No thanks, we are booked up.'), true);
  assert.equal(optedOut('Please remove me from your list'), true);
  assert.equal(optedOut('Not interested'), true);
  assert.equal(optedOut('Yes! We run 2 dry vans out of Norfolk.\n\nOn Fri, Nov 6, 2026 Omar wrote:\n> Not interested? Reply "no thanks" and I won\'t email you again.'), false);
  assert.equal(optedOut('Call me at 555-1212\n> Reply "no thanks"'), false);
});

test('replies, opt-outs and bounces are reported; machines and our own mail are not', async () => {
  const h = harness(null);
  await noteOutreachReplies(h.d, [
    msg({from: 'Dispatch@Carrier.test'}),
    msg({from: 'ops@other.test', text: 'No thanks.'}),
    msg({from: 'mailer-daemon@googlemail.com', automated: true, bounce: {recipient: 'Info@Dead.test', status: '5.1.1', diagnostic: 'no such user'}}),
    msg({from: 'alerts@bank.test', automated: true}),
    msg({from: 'o.harris@onixus.test'}),
    msg({from: 'x@y.test', direction: 'outbound'}),
  ]);
  assert.deepEqual(h.calls[0]?.args.p_items, [{from_email: 'dispatch@carrier.test', opt_out: false}, {from_email: 'ops@other.test', opt_out: true}, {bounce_recipient: 'info@dead.test'}]);
});

test('sendDraft sends only a draft still addressed to that one company', async () => {
  const requests: string[] = [];
  const draftTo = (to: string) => async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url); requests.push(`${init?.method ?? 'GET'} ${u.replace('https://gmail.googleapis.com/gmail/v1/users/me', '')}`);
    if (u.includes('oauth2')) return Response.json({access_token: 'at', expires_in: 3600});
    if (u.endsWith('/drafts/send')) return Response.json({id: 'sent-9', threadId: 'th-9'});
    return Response.json({message: {payload: {headers: [{name: 'To', value: to}, {name: 'Subject', value: 'Freight'}]}}});
  };
  const creds = {clientId: 'c', clientSecret: 's', refreshToken: 'r'};
  const ok = gmailActions(creds, {fetcher: draftTo('Info@Carrier.test') as typeof fetch, tokenUrl: 'https://oauth2.test/token'});
  assert.deepEqual(await ok.sendDraft('r1', 'info@carrier.test'), {providerMessageId: 'sent-9', providerThreadId: 'th-9'});
  assert.ok(requests.includes('POST /drafts/send'));
  requests.length = 0;
  const changed = gmailActions(creds, {fetcher: draftTo('Someone Else <boss@elsewhere.test>') as typeof fetch, tokenUrl: 'https://oauth2.test/token'});
  await assert.rejects(changed.sendDraft('r1', 'info@carrier.test'), OutreachSkip);
  const added = gmailActions(creds, {fetcher: draftTo('info@carrier.test, boss@elsewhere.test') as typeof fetch, tokenUrl: 'https://oauth2.test/token'});
  await assert.rejects(added.sendDraft('r1', 'info@carrier.test'), OutreachSkip);
  assert.ok(!requests.includes('POST /drafts/send'), 'a changed draft is never sent');
});
