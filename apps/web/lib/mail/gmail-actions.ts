import {googleAccessToken, type GoogleCredentials} from '../revenue/google-auth';
import {MailProviderError, type ProviderMessage} from '../revenue/mail-provider';
import {toProviderMessage} from '../revenue/gmail-provider';

// What Mail does to a message in Gmail beyond reading and sending: label it, archive it, move it
// to Trash (Gmail keeps Trash for 30 days, so nothing is deleted for good), and read the headers
// a sender gives for unsubscribing. Uses the gmail.modify scope the mailbox already granted.

export type GmailActions = {
  get(id: string, mailbox: string): Promise<ProviderMessage>;
  unsubscribeHeaders(id: string): Promise<{listUnsubscribe?: string; listUnsubscribePost?: string}>;
  label(id: string, name: string, archive: boolean): Promise<void>;
  trash(id: string): Promise<void>;
};

export const MAIL_LABELS: Record<string, string> = {
  JUNK: 'Onixus/Junk', NEWSLETTER: 'Onixus/Newsletters', COLD_OUTREACH: 'Onixus/Cold pitches', NOTIFICATION: 'Onixus/Notifications',
  QUESTION: 'Onixus/Questions', QUOTE_REQUEST: 'Onixus/Quote requests', DOCUMENT: 'Onixus/Documents', PERSONAL: 'Onixus/Personal', OTHER: 'Onixus/Other',
};

export function gmailActions(credentials: GoogleCredentials, o: {fetcher?: typeof fetch; apiUrl?: string; tokenUrl?: string} = {}): GmailActions {
  const fetcher = o.fetcher ?? fetch;
  const api = (o.apiUrl ?? 'https://gmail.googleapis.com/gmail/v1/users/me').replace(/\/$/, '');
  const token = googleAccessToken(credentials, o);
  const labels = new Map<string, string>();

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await fetcher(api + path, {...init, headers: {Authorization: `Bearer ${await token.get()}`, 'Content-Type': 'application/json'}, signal: AbortSignal.timeout(20000)});
    if (r.ok) return (r.status === 204 ? {} : await r.json()) as T;
    const detail = await r.json().catch(() => ({})) as {error?: {message?: string}};
    if (r.status === 401) { token.reset(); throw new MailProviderError('auth_expired', 'Google connection expired. Reconnect Gmail.', false); }
    if (r.status === 429) throw new MailProviderError('rate_limited', 'Gmail rate limit reached; retrying later.', true);
    if (r.status === 404) throw new MailProviderError('rejected', 'The message is no longer in Gmail.', false);
    throw new MailProviderError(r.status >= 500 ? 'temporary' : 'rejected', detail.error?.message?.slice(0, 200) ?? `Gmail returned ${r.status}`, r.status >= 500);
  }

  async function labelId(name: string): Promise<string> {
    if (!labels.size) for (const l of (await call<{labels?: {id: string; name: string}[]}>('/labels')).labels ?? []) labels.set(l.name, l.id);
    const found = labels.get(name);
    if (found) return found;
    const made = await call<{id: string}>('/labels', {method: 'POST', body: JSON.stringify({name, labelListVisibility: 'labelShow', messageListVisibility: 'show'})});
    labels.set(name, made.id);
    return made.id;
  }

  return {
    async get(id, mailbox) {
      return toProviderMessage(await call<Parameters<typeof toProviderMessage>[0]>(`/messages/${encodeURIComponent(id)}?format=full`), mailbox);
    },
    async unsubscribeHeaders(id) {
      const m = await call<{payload?: {headers?: {name: string; value: string}[]}}>(`/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=List-Unsubscribe&metadataHeaders=List-Unsubscribe-Post`);
      const h = (n: string) => m.payload?.headers?.find(x => x.name.toLowerCase() === n)?.value;
      return {listUnsubscribe: h('list-unsubscribe'), listUnsubscribePost: h('list-unsubscribe-post')};
    },
    async label(id, name, archive) {
      await call(`/messages/${encodeURIComponent(id)}/modify`, {method: 'POST', body: JSON.stringify({addLabelIds: [await labelId(name)], removeLabelIds: archive ? ['INBOX'] : []})});
    },
    async trash(id) {
      await call(`/messages/${encodeURIComponent(id)}/trash`, {method: 'POST'});
    },
  };
}
