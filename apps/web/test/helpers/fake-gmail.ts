// In-memory Gmail REST API (token, profile, messages.send/list/get, history.list) served
// through a fetch function. The real gmailProvider adapter runs on top of it, so the harness
// exercises the same request, MIME and sync code used against Google. Mail can only be
// "delivered" to controlled recipients; anything else is rejected the way Gmail rejects a
// bad To header.

type Header = {name: string; value: string};
type Stored = {id: string; threadId: string; labelIds: string[]; internalDate: string; headers: Header[]; body: string};

const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

export type DeliveredMail = {to: string; from: string; subject: string; body: string; messageId: string; inReplyTo: string | null; references: string | null; replyTo: string | null; threadId: string; gmailId: string};

export function fakeGmail(o: {mailbox: string; controlledRecipients: string[]; sendAs?: {email: string; verified: boolean}[]}) {
  const messages = new Map<string, Stored>();
  const history: {id: number; messageId: string}[] = [];
  let historyId = 1000, seq = 0, revoked = false, minHistory = 0, clock = Date.now();
  const failures: {status: number; message: string}[] = [];
  const delivered: DeliveredMail[] = [];
  const calls: string[] = [];

  const add = (m: Omit<Stored, 'id' | 'internalDate'> & {at?: number}) => {
    const id = `msg${(++seq).toString().padStart(6, '0')}`;
    clock = Math.max(clock + 1, Date.now(), m.at ?? 0);
    messages.set(id, {id, threadId: m.threadId, labelIds: m.labelIds, internalDate: String(clock), headers: m.headers, body: m.body});
    history.push({id: ++historyId, messageId: id});
    return id;
  };
  const header = (m: Stored, name: string) => m.headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
  const asGmail = (m: Stored) => ({id: m.id, threadId: m.threadId, labelIds: m.labelIds, internalDate: m.internalDate,
    payload: {mimeType: 'text/plain', headers: m.headers, body: {data: b64url(m.body), size: m.body.length}}});

  function parseMime(raw: string) {
    const [head, ...rest] = raw.split('\r\n\r\n');
    const headers: Header[] = head.replace(/\r\n[ \t]+/g, ' ').split('\r\n').map(l => ({name: l.slice(0, l.indexOf(':')), value: l.slice(l.indexOf(':') + 1).trim()}));
    const encoded = rest.join('\r\n\r\n').replace(/\r\n/g, '');
    return {headers, body: Buffer.from(encoded, 'base64').toString('utf8')};
  }

  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    if (url.host === 'oauth.fake') return revoked ? json(400, {error: 'invalid_grant'}) : json(200, {access_token: 'fake-access', expires_in: 3600});
    if (url.host !== 'gmail.fake') throw new Error(`unexpected host ${url.host}`);
    if (revoked) return json(401, {error: {message: 'Invalid Credentials'}});
    const path = url.pathname.replace('/gmail/v1/users/me', '');
    if (path === '/profile') return json(200, {emailAddress: o.mailbox, historyId: String(historyId)});
    if (path === '/settings/sendAs') return json(200, {sendAs: [{sendAsEmail: o.mailbox, isPrimary: true, verificationStatus: 'accepted'},
      ...(o.sendAs ?? []).map(a => ({sendAsEmail: a.email, isPrimary: false, verificationStatus: a.verified ? 'accepted' : 'pending'}))]});
    if (path === '/messages/send' && init?.method === 'POST') {
      const failure = failures.shift();
      if (failure) return json(failure.status, {error: {message: failure.message}});
      const {raw, threadId} = JSON.parse(String(init.body)) as {raw: string; threadId?: string};
      const {headers, body} = parseMime(unb64url(raw));
      const h = (n: string) => headers.find(x => x.name.toLowerCase() === n.toLowerCase())?.value ?? null;
      const to = (h('to') ?? '').toLowerCase();
      if (!o.controlledRecipients.includes(to)) return json(400, {error: {message: 'Invalid To header'}});
      const thread = threadId && [...messages.values()].some(m => m.threadId === threadId) ? threadId : `thread${(++seq).toString().padStart(6, '0')}`;
      const id = add({threadId: thread, labelIds: ['SENT'], headers, body});
      delivered.push({to, from: h('from') ?? '', subject: h('subject') ?? '', body, messageId: h('message-id') ?? '', inReplyTo: h('in-reply-to'), references: h('references'), replyTo: h('reply-to'), threadId: thread, gmailId: id});
      return json(200, {id, threadId: thread, labelIds: ['SENT']});
    }
    if (path === '/messages') {
      const q = url.searchParams.get('q') ?? '';
      const wanted = /rfc822msgid:(\S+)/.exec(q)?.[1];
      const list = [...messages.values()].filter(m => !wanted || header(m, 'message-id') === `<${wanted}>`).reverse()
        .slice(0, Number(url.searchParams.get('maxResults') ?? 50));
      return json(200, list.length ? {messages: list.map(m => ({id: m.id, threadId: m.threadId}))} : {resultSizeEstimate: 0});
    }
    const one = /^\/messages\/([^/]+)$/.exec(path);
    if (one) {
      const m = messages.get(one[1]);
      return m ? json(200, asGmail(m)) : json(404, {error: {message: 'Requested entity was not found.'}});
    }
    if (path === '/history') {
      const start = Number(url.searchParams.get('startHistoryId'));
      if (start < minHistory) return json(404, {error: {message: 'Requested entity was not found.'}});
      const max = Number(url.searchParams.get('maxResults') ?? 100);
      const after = history.filter(h => h.id > start);
      const page = after.slice(0, max);
      return json(200, {history: page.map(h => ({id: String(h.id), messagesAdded: [{message: {id: h.messageId}}]})), historyId: String(historyId),
        ...(after.length > max ? {nextPageToken: 'more'} : {})});
    }
    return json(404, {error: {message: `fake gmail has no route ${path}`}});
  };

  return {
    fetcher: fetcher as typeof fetch,
    options: {fetcher: fetcher as typeof fetch, apiUrl: 'https://gmail.fake/gmail/v1/users/me', tokenUrl: 'https://oauth.fake/token'},
    credentials: {clientId: 'fake-client', clientSecret: 'fake-secret', refreshToken: 'fake-refresh'},
    delivered, calls,
    /** A customer (or anyone) writes to the connected mailbox. */
    receive(m: {from: string; fromName?: string; subject: string; text: string; threadId?: string; messageId?: string | null; inReplyTo?: string; references?: string; extraHeaders?: Header[]}) {
      const threadId = m.threadId ?? `thread${(++seq).toString().padStart(6, '0')}`;
      const messageId = m.messageId === undefined ? `<${id0()}@customer.test>` : m.messageId;
      const id = add({threadId, labelIds: ['INBOX', 'UNREAD'], body: m.text, headers: [
        {name: 'From', value: m.fromName ? `"${m.fromName}" <${m.from}>` : m.from}, {name: 'To', value: o.mailbox}, {name: 'Subject', value: m.subject},
        ...(messageId ? [{name: 'Message-ID', value: messageId}] : []), ...(m.inReplyTo ? [{name: 'In-Reply-To', value: m.inReplyTo}] : []),
        ...(m.references ? [{name: 'References', value: m.references}] : []), ...(m.extraHeaders ?? [])]});
      return {id, threadId, messageId};
    },
    bounce(recipient: string, threadId?: string) {
      return this.receive({from: 'mailer-daemon@googlemail.com', subject: 'Delivery Status Notification (Failure)', threadId,
        text: `Reporting-MTA: dns; googlemail.com\nFinal-Recipient: rfc822; ${recipient}\nAction: failed\nStatus: 5.1.1\nDiagnostic-Code: smtp; 550 5.1.1 The email account does not exist.`});
    },
    failNextSend(status: number, message: string) { failures.push({status, message}); },
    revoke() { revoked = true; },
    reconnect() { revoked = false; },
    expireHistory() { minHistory = historyId + 1; },
    sentWithMessageId(key: string) { return [...messages.values()].filter(m => header(m, 'message-id') === `<${key}@onixus.mail>`).length; },
  };
  function id0() { return `c${(++seq).toString(36)}${Math.random().toString(36).slice(2, 8)}`; }
}
