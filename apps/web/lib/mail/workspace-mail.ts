import {gmailProvider} from '../revenue/gmail-provider';
import {relayAccount, type Rpc} from '../revenue/relay';
import type {ProviderMessage} from '../revenue/mail-provider';
import {brainFromEnv, type Brain} from './brain';
import {actOnApproved, noteNew, sortSome, type Settings} from './employee';
import {gmailActions} from './gmail-actions';
import {tmsQuoteLane} from './tms';

// Mail runs inside Workspace (2026-11): Supabase keeps each mailbox's Google refresh token in Vault
// and starts one single-use pass per mailbox every minute; this module connects Gmail and runs a pass.
// Email text stays untrusted: the pass only records mail and sends what a person approved.

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send', 'openid', 'email'];
export type GoogleClient = {clientId: string; clientSecret: string};

export function googleClient(env: Record<string, string | undefined> = process.env): GoogleClient | null {
  const clientId = env.GOOGLE_CLIENT_ID, clientSecret = env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? {clientId, clientSecret} : null;
}

export const callbackUrl = (origin: string) => `${origin.replace(/\/$/, '')}/api/mail/google/callback`;

export function googleSignInUrl(client: GoogleClient, origin: string, state: string): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({client_id: client.clientId, redirect_uri: callbackUrl(origin), response_type: 'code', scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state}).toString();
  return u.href;
}

/** Exchanges Google's one-time code for a lasting refresh token and the mailbox it belongs to. */
export async function exchangeCode(client: GoogleClient, origin: string, code: string, fetcher: typeof fetch = fetch): Promise<{refreshToken: string; mailbox: string}> {
  const r = await fetcher('https://oauth2.googleapis.com/token', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({code, client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: callbackUrl(origin), grant_type: 'authorization_code'}),
    redirect: 'error', signal: AbortSignal.timeout(15000)});
  const t = await r.json().catch(() => ({})) as {refresh_token?: string; access_token?: string; scope?: string};
  if (!r.ok || !t.access_token) throw new Error('Google sign-in did not complete. Try Connect Gmail again.');
  if (!t.refresh_token) throw new Error('Google did not grant a lasting connection. Remove Onixus from your Google account permissions, then connect again.');
  const granted = (t.scope ?? '').split(' ');
  if (!granted.includes(GMAIL_SCOPES[0]) || !granted.includes(GMAIL_SCOPES[1])) throw new Error('Allow Onixus to read and send Gmail on the Google screen, then connect again.');
  const p = await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/profile', {headers: {Authorization: `Bearer ${t.access_token}`}, redirect: 'error', signal: AbortSignal.timeout(15000)});
  const profile = await p.json().catch(() => ({})) as {emailAddress?: string};
  if (!p.ok || !profile.emailAddress) throw new Error('Gmail did not return a mailbox address.');
  return {refreshToken: t.refresh_token, mailbox: profile.emailAddress.toLowerCase()};
}

type Pass = {account_id: string; workspace_id: string; mailbox: string; refresh_token: string; crm_token: string; settings?: Partial<Settings> | null; business?: {name?: string; industry?: string | null} | null};
const DEFAULTS: Settings = {auto_clean: false, delete_junk: true, unsubscribe: false, auto_send: []};

/** One mailbox pass: redeem the single-use job, sync Gmail, send approved mail, report back. */
export async function runMailPass(o: {rpc: Rpc; client: GoogleClient | null; jobId: string; token: string; workerId: string; fetcher?: typeof fetch; gmailApiUrl?: string; tokenUrl?: string; budgetMs?: number; wait?: (ms: number) => Promise<void>;
  brain?: Brain | null; env?: Record<string, string | undefined>}) {
  const pass = await o.rpc<Pass>('mail_pass_start', {p_job: o.jobId, p_token: o.token});
  const finish = (report: Record<string, unknown>) => o.rpc('mail_pass_finish', {p_job: o.jobId, p_token: o.token, p_report: report});
  if (!o.client) {
    await finish({result: 'error', detail: 'Google sign-in is not configured for Workspace Mail.'});
    return {result: 'error' as const};
  }
  try {
    const mail = gmailProvider({clientId: o.client.clientId, clientSecret: o.client.clientSecret, refreshToken: pass.refresh_token},
      {fetcher: o.fetcher, apiUrl: o.gmailApiUrl, tokenUrl: o.tokenUrl, rateLimitRetries: 3, wait: o.wait});
    // Catch-up after downtime is paced: small pages, position saved after each, and a time budget
    // inside the 60-second function limit. The next minute's pass continues from the saved position.
    const started = Date.now(), budget = o.budgetMs ?? 50_000;
    const seen: ProviderMessage[] = [];
    const r = await relayAccount({rpc: o.rpc, accountId: pass.account_id, token: pass.crm_token, workerId: o.workerId, mail, calendar: null,
      sync: {limit: 20, maxPages: 10, checkpoint: true, deadline: started + Math.round(budget * 0.5), onMessage: m => seen.push(m)}});
    const sent = 'sent' in r.send ? r.send.sent : 0;
    const result = r.sync.status === 'healthy' ? 'healthy' : r.sync.status;
    // The employee part: sort new mail, label it, draft replies, carry out what is approved.
    let employee: Record<string, unknown> = {};
    if (result === 'healthy') {
      const env = o.env ?? process.env;
      const settings: Settings = {...DEFAULTS, ...(pass.settings ?? {})};
      const brain = o.brain === undefined ? brainFromEnv(env) : o.brain;
      const credentials = {clientId: o.client.clientId, clientSecret: o.client.clientSecret, refreshToken: pass.refresh_token};
      const d = {rpc: o.rpc, accountId: pass.account_id, token: pass.crm_token, mailbox: pass.mailbox, settings, brain, mail,
        business: {name: pass.business?.name || 'the business', industry: pass.business?.industry ?? ''},
        gmail: gmailActions(credentials, {fetcher: o.fetcher, apiUrl: o.gmailApiUrl, tokenUrl: o.tokenUrl}),
        quoteLane: tmsQuoteLane({url: env.TMS_API_URL, key: env.TMS_API_KEY, orgId: settings.tms_org_id, fetcher: o.fetcher}),
        deadline: started + budget};
      try {
        const noted = await noteNew(d, seen);
        const acted = await actOnApproved(d);
        const sorted = await sortSome(d);
        employee = {noted, ...sorted, done: acted.done, failed: acted.failed, ...(brain ? {} : {ai: 'not configured'})};
      } catch (e) {
        employee = {error: e instanceof Error ? e.message.slice(0, 200) : 'Mail employee step failed.'};
      }
    }
    await finish({result, detail: r.sync.error ?? '', ingested: r.sync.ingested, sent, employee});
    return {result, ingested: r.sync.ingested, sent, employee};
  } catch (e) {
    await finish({result: 'error', detail: e instanceof Error ? e.message.slice(0, 300) : 'Mail pass failed.'}).catch(() => undefined);
    return {result: 'error' as const};
  }
}
