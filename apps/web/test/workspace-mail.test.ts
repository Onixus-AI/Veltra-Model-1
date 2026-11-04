import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fakeGmail} from './helpers/fake-gmail';
import {exchangeCode, googleSignInUrl, runMailPass, GMAIL_SCOPES} from '../lib/mail/workspace-mail';

const MAILBOX = 'info@onixus-unit.test', ACCOUNT = '00000000-0000-4000-8000-0000000000aa', JOB = '00000000-0000-4000-8000-0000000000bb';
const TOKEN = 'a'.repeat(72);

function fakeRpc(o: {mailState?: unknown} = {}) {
  const calls: {fn: string; args: Record<string, unknown>}[] = [];
  const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
    calls.push({fn, args});
    if (fn === 'mail_pass_start') return {account_id: ACCOUNT, mailbox: MAILBOX, refresh_token: 'fake-refresh', crm_token: 'c'.repeat(72)} as T;
    if (fn === 'revenue_mail_account_state') return {workspace_id: 'w', mail: o.mailState ?? null, calendar: null, sends_waiting: 0} as T;
    if (fn === 'revenue_mail_claim') return {jobs: [], processed: []} as T;
    return {} as T;
  };
  return {rpc, calls};
}

test('a pass redeems its job, syncs Gmail into the CRM with the mailbox token, and reports back', async () => {
  const gmail = fakeGmail({mailbox: MAILBOX, controlledRecipients: []});
  gmail.receive({from: 'owner@smallbiz.test', fromName: 'Pat Owner', subject: 'Need a website', text: 'Can you build our site? What does it cost?'});
  const {rpc, calls} = fakeRpc();
  const r = await runMailPass({rpc, client: {clientId: 'fake-client', clientSecret: 'fake-secret'}, jobId: JOB, token: TOKEN, workerId: 'test',
    fetcher: gmail.fetcher, gmailApiUrl: gmail.options.apiUrl, tokenUrl: gmail.options.tokenUrl});
  assert.equal(r.result, 'healthy');
  assert.equal(calls[0]!.fn, 'mail_pass_start');
  const inbound = calls.filter(c => c.fn === 'revenue_ingest_mail_event' && (c.args.p_event as {type: string}).type === 'message.inbound');
  assert.equal(inbound.length, 1, 'the customer email reaches the CRM');
  assert.ok(inbound.every(c => c.args.p_account === ACCOUNT && c.args.p_token === 'c'.repeat(72)), 'CRM calls use the mailbox token, not the job token');
  assert.ok(calls.some(c => c.fn === 'revenue_mail_claim'), 'approved sends are claimed after the sync');
  const finish = calls.at(-1)!;
  assert.equal(finish.fn, 'mail_pass_finish');
  assert.deepEqual([(finish.args.p_report as {result: string}).result, (finish.args.p_report as {ingested: number}).ingested], ['healthy', 1]);
  assert.equal(gmail.delivered.length, 0, 'nothing is sent without approval');
});

test('a pass with Google sign-in unconfigured reports the problem instead of failing silently', async () => {
  const {rpc, calls} = fakeRpc();
  const r = await runMailPass({rpc, client: null, jobId: JOB, token: TOKEN, workerId: 'test'});
  assert.equal(r.result, 'error');
  assert.match(String((calls.at(-1)!.args.p_report as {detail: string}).detail), /not configured/);
});

test('sign-in asks Google for a lasting Gmail read and send grant, bound to the state', () => {
  const u = new URL(googleSignInUrl({clientId: 'cid', clientSecret: 's'}, 'https://app.test', 'st4te'));
  assert.equal(u.searchParams.get('redirect_uri'), 'https://app.test/api/mail/google/callback');
  assert.deepEqual([u.searchParams.get('access_type'), u.searchParams.get('prompt'), u.searchParams.get('state')], ['offline', 'consent', 'st4te']);
  assert.deepEqual(u.searchParams.get('scope')!.split(' '), GMAIL_SCOPES);
  assert.equal(u.searchParams.get('client_secret'), null, 'the secret never goes to the browser');
});

test('the code exchange refuses a grant without a refresh token or without Gmail send access', async () => {
  const google = {clientId: 'cid', clientSecret: 's'};
  const fake = (token: Record<string, unknown>) => (async (input: RequestInfo | URL) => String(input).includes('oauth2')
    ? Response.json({access_token: 'at', ...token}) : Response.json({emailAddress: 'Info@Onixus-Unit.test'})) as typeof fetch;
  await assert.rejects(exchangeCode(google, 'https://app.test', 'code', fake({scope: GMAIL_SCOPES.join(' ')})), /lasting connection/);
  await assert.rejects(exchangeCode(google, 'https://app.test', 'code', fake({refresh_token: 'r'.repeat(30), scope: GMAIL_SCOPES[0]})), /read and send/);
  assert.deepEqual(await exchangeCode(google, 'https://app.test', 'code', fake({refresh_token: 'r'.repeat(30), scope: GMAIL_SCOPES.join(' ')})),
    {refreshToken: 'r'.repeat(30), mailbox: 'info@onixus-unit.test'});
});
