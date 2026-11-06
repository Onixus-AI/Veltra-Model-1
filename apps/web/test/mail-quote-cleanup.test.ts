import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MailProviderError} from '../lib/revenue/mail-provider';
import type {ThreadMessage} from '../lib/mail/gmail-actions';
import {backlogQuery, cleanQuoteRequests} from '../lib/mail/quote-cleanup';

const NOW = Date.parse('2026-11-20T15:00:00Z'), DAY = 86_400_000;
const m = (id: string, daysAgo: number, o: Partial<ThreadMessage> = {}): ThreadMessage =>
  ({id, at: NOW - daysAgo * DAY, sent: false, draft: false, from: 'rates@broker.test', subject: 'Rate request NIT to Richmond', ...o});

function harness(due: unknown, threads: Record<string, ThreadMessage[] | Error>, search: string[] = []) {
  const calls: {fn: string; args: Record<string, unknown>}[] = [], trashed: string[] = [], queries: string[] = [];
  const d = {
    accountId: 'acct', token: 'tok', deadline: NOW + 60_000, now: () => NOW,
    rpc: (async (fn: string, args: Record<string, unknown>) => { calls.push({fn, args}); return fn === 'mail_quote_cleanup_due' ? due : {added: (args.p_items as unknown[] | undefined)?.length ?? 0}; }) as never,
    gmail: {
      thread: async (id: string) => { const t = threads[id]; if (t instanceof Error) throw t; return t ?? []; },
      trash: async (id: string) => { trashed.push(id); },
      searchThreads: async (q: string) => { queries.push(q); return search; },
    },
  };
  const results = () => calls.filter(c => c.fn === 'mail_quote_cleanup_result').map(c => [c.args.p_id, c.args.p_status, c.args.p_trashed]);
  return {d, calls, trashed, queries, results};
}

test('off when no cleanup period is set: nothing is read or trashed', async () => {
  const h = harness({days: null, search_backlog: false, threads: []}, {});
  assert.deepEqual(await cleanQuoteRequests(h.d), {off: true});
  assert.equal(h.trashed.length, 0);
});

test('a quiet thread: the broker\'s messages go to Trash, our sent quote stays', async () => {
  const h = harness({days: 10, search_backlog: false, threads: [{id: 'c1', thread_id: 't1'}]},
    {t1: [m('in1', 14), m('out1', 14, {sent: true, from: 'info@onixus.test'}), m('in2', 12), m('d1', 11, {draft: true})]});
  assert.deepEqual(await cleanQuoteRequests(h.d), {trashed: 2, waiting: 0, failed: 0});
  assert.deepEqual(h.trashed, ['in1', 'in2']);
  assert.deepEqual(h.results(), [['c1', 'trashed', 2]]);
});

test('an active thread waits: anything in the last 10 days, from either side, keeps it', async () => {
  const h = harness({days: 10, search_backlog: false, threads: [{id: 'c1', thread_id: 't1'}, {id: 'c2', thread_id: 't2'}]},
    {t1: [m('in1', 20), m('in2', 3)], t2: [m('in3', 20), m('out', 9, {sent: true})]});
  assert.deepEqual(await cleanQuoteRequests(h.d), {trashed: 0, waiting: 2, failed: 0});
  assert.equal(h.trashed.length, 0);
  assert.equal(h.calls.find(c => c.fn === 'mail_quote_cleanup_result')?.args.p_last_message_at, new Date(NOW - 3 * DAY).toISOString());
});

test('a thread deleted in Gmail is kept as done; a Gmail error is retried later', async () => {
  const h = harness({days: 10, search_backlog: false, threads: [{id: 'c1', thread_id: 'gone'}, {id: 'c2', thread_id: 'down'}]},
    {gone: new MailProviderError('rejected', 'The message is no longer in Gmail.', false), down: new MailProviderError('temporary', 'Gmail returned 503', true)});
  assert.deepEqual(await cleanQuoteRequests(h.d), {trashed: 0, waiting: 0, failed: 1});
  assert.deepEqual(h.results(), [['c1', 'kept', 0], ['c2', 'failed', 0]]);
});

test('the backlog search only lists quiet threads with a sender message, and trashes nothing', async () => {
  const h = harness({days: 10, search_backlog: true, threads: []}, {
    old: [m('a', 40, {subject: 'Rate req: 40HC NIT - Charlotte'}), m('b', 39, {sent: true})],
    active: [m('c', 30), m('d', 2)],
    ours: [m('e', 30, {sent: true})],
  }, ['old', 'active', 'ours']);
  const r = await cleanQuoteRequests(h.d);
  assert.equal(r && 'proposed' in r ? r.proposed : undefined, 1);
  assert.equal(h.trashed.length, 0);
  assert.equal(h.queries[0], backlogQuery(10));
  assert.deepEqual(h.calls.find(c => c.fn === 'mail_quote_backlog_add')?.args.p_items,
    [{thread_id: 'old', subject: 'Rate req: 40HC NIT - Charlotte', from_email: 'rates@broker.test', last_message_at: new Date(NOW - 39 * DAY).toISOString()}]);
});

test('out of time mid-search: nothing is recorded, so the search runs again next pass', async () => {
  const ids = Array.from({length: 30}, (_, i) => `t${i}`);
  const h = harness({days: 10, search_backlog: true, threads: []}, Object.fromEntries(ids.map(id => [id, [m(id, 30)]])), ids);
  let clock = NOW;
  h.d.now = () => (clock += 20_000);
  h.d.deadline = NOW + 100_000;
  await cleanQuoteRequests(h.d);
  assert.equal(h.calls.some(c => c.fn === 'mail_quote_backlog_add'), false);
});
