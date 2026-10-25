import {createHash, randomBytes} from 'node:crypto';
import {revenueUser, readJson, uuid, noStore} from '@/lib/revenue/server';
import {RevenueError, revenueResponse} from '@/lib/revenue/store';
import type {CustomerContext} from '@/lib/revenue/context';
import {dealHealth, nextBestActions} from '@/lib/revenue/insights';
import {draftReply, summarizeThread} from '@/lib/revenue/drafts';
import {createCheckoutSession} from '@/lib/revenue/stripe';

export const runtime = 'nodejs';
type Context = {params: Promise<{path: string[]}>};

// User-callable RPCs and the arguments each accepts. Every one re-checks the caller's workspace
// role inside the database; this list only limits the surface exposed over HTTP.
const actions: Record<string, string[]> = {
  revenue_upsert_customer: ['p_customer'], revenue_merge_customers: ['p_survivor', 'p_merged'], revenue_unmerge_customers: ['p_merge'],
  revenue_resolve_review: ['p_review', 'p_decision', 'p_survivor'], revenue_assign: ['p_target', 'p_id', 'p_owner'], revenue_save_stages: ['p_stages'],
  revenue_create_deal: ['p_customer', 'p_title', 'p_value_cents', 'p_currency', 'p_stage', 'p_source'], revenue_move_deal: ['p_deal', 'p_stage', 'p_reason'],
  revenue_create_task: ['p_customer', 'p_title', 'p_due', 'p_kind', 'p_deal', 'p_owner'], revenue_complete_task: ['p_task'],
  revenue_record_memory: ['p_customer', 'p_content', 'p_kind', 'p_source', 'p_source_ref', 'p_confidence', 'p_visibility', 'p_expires', 'p_source_event'],
  revenue_decide_memory: ['p_memory', 'p_decision', 'p_reason', 'p_corrected'], revenue_record_consent: ['p_customer', 'p_channel', 'p_purpose', 'p_status', 'p_source', 'p_evidence'],
  revenue_draft_message: ['p_draft'], revenue_update_draft: ['p_message', 'p_subject', 'p_body'], revenue_approve_message: ['p_message'],
  revenue_cancel_message: ['p_message', 'p_reason'], revenue_retry_message: ['p_message'], revenue_thread_action: ['p_account', 'p_thread', 'p_action', 'p_value'],
  revenue_schedule_follow_up: ['p_message', 'p_run_at', 'p_body'], revenue_save_template: ['p_id', 'p_name', 'p_subject', 'p_body', 'p_archived'],
  revenue_save_sender_identity: ['p_email', 'p_display_name', 'p_reply_to', 'p_signature', 'p_shared', 'p_account'], revenue_suppress: ['p_email', 'p_reason', 'p_detail'],
  revenue_unsuppress: ['p_email', 'p_reason'], revenue_set_controls: ['p_paused', 'p_reason', 'p_daily_send_limit', 'p_daily_spend_limit_cents'],
  revenue_set_workflow: ['p_key', 'p_enabled', 'p_auto_send', 'p_settings'], revenue_job_action: ['p_job', 'p_action', 'p_reason'], revenue_revoke_integration: ['p_integration'],
  revenue_book_meeting: ['p_customer', 'p_deal', 'p_title', 'p_starts', 'p_ends'],
  revenue_create_proposal: ['p_customer', 'p_deal', 'p_title', 'p_amount_cents', 'p_currency', 'p_rule', 'p_deposit_percent', 'p_line_items'],
  revenue_mark_proposal_sent: ['p_proposal', 'p_checkout_reference', 'p_checkout_url'], revenue_cancel_proposal: ['p_proposal', 'p_reason'],
};

const ok = (data: unknown) => Response.json(data, {headers: noStore});
const must = <T>(r: {data: T | null; error: unknown}) => { if (r.error) throw r.error; return r.data as T; };
const search = (q: string | null) => (q ?? '').replace(/[^\p{L}\p{N} @._-]/gu, '').trim().slice(0, 80);

async function handle(request: Request, context: Context) {
  try {
    const {path} = await context.params;
    const {client, store, user} = await revenueUser(request);
    const url = new URL(request.url);
    const w = url.searchParams.get('w');
    const view = path.join('/');

    if (request.method === 'GET') {
      if (view === 'workspaces') {
        const memberships = must(await client.from('crm_memberships').select('workspace_id,role').eq('user_id', user.id)) as {workspace_id: string; role: string}[];
        const workspaces = memberships.length ? must(await client.from('crm_workspaces').select('id,name,environment').in('id', memberships.map(m => m.workspace_id))) as {id: string}[] : [];
        return ok({user_id: user.id, workspaces: workspaces.map(x => ({...x, role: memberships.find(m => m.workspace_id === x.id)?.role}))});
      }
      if (!uuid(w)) throw new RevenueError(400, 'Choose a workspace.');
      if (view === 'overview') {
        const from = url.searchParams.get('from'), to = url.searchParams.get('to');
        const [overview, priorities] = await Promise.all([store.rpc('revenue_overview', {p_workspace: w, p_from: from || null, p_to: to || null}), store.rpc('revenue_priorities', {p_workspace: w, p_limit: 25})]);
        return ok({overview, priorities});
      }
      if (view === 'proposal') {
        const id = url.searchParams.get('id');
        if (!uuid(id)) throw new RevenueError(400, 'Choose a proposal.');
        return ok(await store.rpc('revenue_proposal_status', {p_workspace: w, p_proposal: id}));
      }
      if (view === 'pipeline') return ok(await store.rpc('revenue_pipeline', {p_workspace: w}));
      if (view === 'customers') {
        let query = client.from('crm_customers').select('id,company,name,email,source,owner_id,identity_review_required,suppressed,created_at').eq('workspace_id', w).is('merged_into_id', null);
        const term = search(url.searchParams.get('q'));
        if (term) query = query.or(`company.ilike.*${term}*,name.ilike.*${term}*,email.ilike.*${term}*`);
        return ok({customers: must(await query.order('created_at', {ascending: false}).limit(100))});
      }
      if (view === 'customer') {
        const id = url.searchParams.get('id');
        if (!uuid(id)) throw new RevenueError(400, 'Choose a customer.');
        const ctx = await store.rpc<CustomerContext & {merged_into?: string}>('revenue_customer_context', {p_workspace: w, p_customer: id});
        if (ctx.merged_into) return ok({merged_into: ctx.merged_into});
        return ok({context: ctx, health: ctx.deals.map(d => dealHealth(ctx, d.id)), actions: nextBestActions(ctx)});
      }
      if (view === 'mail') {
        const status = url.searchParams.get('status');
        let messages = client.from('revenue_messages').select('id,customer_id,direction,purpose,status,to_email,from_email,subject,thread_id,account_id,ai_generated,approval_source,failure,created_at,updated_at,approved_at,queued_at,provider_accepted_at,delivered_at,replied_at,failed_at,untrusted').eq('workspace_id', w);
        if (status && /^[a-z_]{3,20}$/.test(status)) messages = messages.eq('status', status);
        const [m, threads, sync, identities, templates] = await Promise.all([
          messages.order('updated_at', {ascending: false}).limit(100),
          client.from('crm_mail_threads').select('account_id,thread_id,customer_id,subject,state,assigned_to,labels,reply_lock_by,reply_lock_until,last_inbound_at,last_outbound_at,unanswered_questions,last_event_at').eq('workspace_id', w).order('last_event_at', {ascending: false}).limit(60),
          client.from('revenue_sync_state').select('account_id,provider,mailbox,status,last_synced_at,last_attempt_at,last_error,messages_synced').eq('workspace_id', w),
          client.from('revenue_sender_identities').select('id,email,display_name,reply_to,signature,is_shared,account_id').eq('workspace_id', w),
          client.from('revenue_templates').select('id,name,subject,body,archived').eq('workspace_id', w).eq('archived', false).limit(50)]);
        return ok({messages: must(m), threads: must(threads), sync: must(sync), identities: must(identities), templates: must(templates)});
      }
      if (view === 'thread') {
        const account = url.searchParams.get('account'), thread = url.searchParams.get('thread');
        if (!uuid(account) || !thread) throw new RevenueError(400, 'Choose a conversation.');
        const [m, comments] = await Promise.all([
          client.from('revenue_messages').select('id,direction,status,subject,body,from_email,to_email,occurred_at,untrusted,ai_generated,failure').eq('workspace_id', w).eq('account_id', account).eq('thread_id', thread).order('occurred_at', {ascending: true}).limit(100),
          client.from('revenue_thread_comments').select('id,author_id,body,created_at').eq('workspace_id', w).eq('account_id', account).eq('thread_id', thread).order('created_at', {ascending: true})]);
        const messages = must(m) as {direction: string; body: string; occurred_at: string}[];
        return ok({messages, comments: must(comments), summary: summarizeThread(messages.map(x => ({direction: x.direction, text: x.body, occurred_at: x.occurred_at})))});
      }
      if (view === 'automation') {
        const [jobs, workflows, controls] = await Promise.all([
          client.from('revenue_jobs').select('id,kind,workflow_key,status,attempts,max_attempts,run_at,last_error,cancel_reason,chain_depth,customer_id,message_id,created_at,updated_at,finished_at').eq('workspace_id', w).order('updated_at', {ascending: false}).limit(100),
          client.from('revenue_workflows').select('key,enabled,auto_send_authorized,authorized_at,settings,updated_at').eq('workspace_id', w),
          client.from('revenue_controls').select('automation_paused,pause_reason,paused_at,daily_send_limit,daily_spend_limit_cents').eq('workspace_id', w).maybeSingle()]);
        const job = url.searchParams.get('job');
        const runs = uuid(job) ? must(await client.from('revenue_job_runs').select('attempt,worker,started_at,finished_at,outcome,error,detail').eq('workspace_id', w).eq('job_id', job).order('started_at', {ascending: true})) : null;
        return ok({jobs: must(jobs), workflows: must(workflows), controls: must(controls), runs});
      }
      if (view === 'reviews') {
        const reviews = must(await client.from('revenue_identity_reviews').select('id,customer_id,candidate_ids,reason,evidence,created_at').eq('workspace_id', w).eq('status', 'open').order('created_at', {ascending: true}).limit(50)) as {customer_id: string; candidate_ids: string[]}[];
        const ids = [...new Set(reviews.flatMap(r => [r.customer_id, ...r.candidate_ids]))];
        const customers = ids.length ? must(await client.from('crm_customers').select('id,company,name,email,phone,source,created_at').eq('workspace_id', w).in('id', ids)) : [];
        return ok({reviews, customers});
      }
      if (view === 'integrations') {
        const [integrations, merges, calendars] = await Promise.all([
          client.from('revenue_integrations').select('id,provider,label,status,created_at,last_success_at,last_error').eq('workspace_id', w),
          client.from('revenue_merges').select('id,survivor_id,merged_id,merged_at,reverted_at').eq('workspace_id', w).order('merged_at', {ascending: false}).limit(20),
          client.from('revenue_calendar_sync_state').select('account_id,provider,calendar_id,status,last_synced_at,last_attempt_at,last_error,events_synced').eq('workspace_id', w)]);
        return ok({integrations: integrations.error ? [] : integrations.data, merges: merges.error ? [] : merges.data, calendars: calendars.error ? [] : calendars.data});
      }
      throw new RevenueError(404, 'Not found.');
    }

    if (request.method !== 'POST') return Response.json({error: 'Method not allowed'}, {status: 405});
    const body = await readJson(request);
    const workspace = body.workspace_id;
    if (!uuid(workspace)) throw new RevenueError(400, 'Choose a workspace.');

    if (path[0] === 'rpc' && path.length === 2) {
      const allowed = actions[path[1]];
      if (!allowed) throw new RevenueError(404, 'Unknown action.');
      const args = (body.args ?? {}) as Record<string, unknown>;
      const extra = Object.keys(args).filter(k => !allowed.includes(k));
      if (extra.length) throw new RevenueError(400, `Unexpected fields: ${extra.join(', ')}`);
      return ok(await store.rpc(path[1], {p_workspace: workspace, ...args}));
    }
    if (view === 'draft-reply') {
      const {customer, account, thread} = body as Record<string, string>;
      if (!uuid(customer) || !uuid(account) || typeof thread !== 'string') throw new RevenueError(400, 'Choose a conversation.');
      const ctx = await store.rpc<CustomerContext>('revenue_customer_context', {p_workspace: workspace, p_customer: customer});
      const rows = must(await client.from('revenue_messages').select('direction,body,occurred_at,subject').eq('workspace_id', workspace).eq('account_id', account).eq('thread_id', thread).order('occurred_at', {ascending: true}).limit(30)) as {direction: string; body: string; occurred_at: string; subject: string}[];
      const identity = must(await client.from('revenue_sender_identities').select('display_name,signature').eq('workspace_id', workspace).order('is_shared', {ascending: false}).limit(1)) as {display_name: string; signature: string}[];
      const subject = rows.find(r => r.direction === 'inbound')?.subject ?? rows[0]?.subject ?? '';
      return ok({draft: draftReply(ctx, {subject, messages: rows.map(r => ({direction: r.direction, text: r.body, occurred_at: r.occurred_at}))}, {name: identity[0]?.display_name ?? 'Our team', signature: identity[0]?.signature})});
    }
    if (view === 'integrations') {
      const provider = body.provider, label = typeof body.label === 'string' ? body.label.slice(0, 120) : '';
      if (!['form', 'stripe', 'calendar'].includes(String(provider)) || !label.trim()) throw new RevenueError(400, 'Choose a provider and a label.');
      const token = randomBytes(32).toString('hex');
      const created = await store.rpc<{integration_id: string}>('revenue_create_integration', {p_workspace: workspace, p_provider: provider, p_label: label, p_token_hash: createHash('sha256').update(token).digest('hex')});
      return ok({...created, token, note: 'Copy this token now. Onixus stores only its hash and cannot show it again.'});
    }
    if (view === 'checkout') {
      const proposalId = body.proposal_id;
      if (!uuid(proposalId)) throw new RevenueError(400, 'Choose a proposal.');
      const key = process.env.STRIPE_RESTRICTED_KEY;
      if (!key) throw new RevenueError(503, 'Stripe is not configured. Send the proposal without a payment link, or ask an owner to connect Stripe.');
      const proposal = must(await client.from('revenue_proposals').select('id,title,amount_cents,currency,workspace_id,customer_id,status').eq('workspace_id', workspace).eq('id', proposalId).single()) as {id: string; title: string; amount_cents: number; currency: string; workspace_id: string; customer_id: string; status: string};
      if (!['draft', 'sent', 'payment_failed'].includes(proposal.status)) throw new RevenueError(409, 'This proposal already has a payment.');
      const customer = must(await client.from('crm_customers').select('email').eq('id', proposal.customer_id).single()) as {email: string | null};
      const origin = new URL(request.url).origin;
      const session = await createCheckoutSession({secretKey: key, proposal, customerEmail: customer.email, idempotencyKey: `onixus-proposal-${proposal.id}-${proposal.status}`,
        successUrl: `${origin}/revenue/paid?w=${workspace}&proposal=${proposal.id}`, cancelUrl: `${origin}/revenue/paid?w=${workspace}&proposal=${proposal.id}&cancelled=1`}).catch(e => { throw new RevenueError(409, String(e instanceof Error ? e.message : e).replace(/^\d{3}:/, '')); });
      await store.rpc('revenue_mark_proposal_sent', {p_workspace: workspace, p_proposal: proposal.id, p_checkout_reference: session.id, p_checkout_url: session.url});
      return ok({checkout_url: session.url, livemode: session.livemode});
    }
    throw new RevenueError(404, 'Not found.');
  } catch (e) {
    return revenueResponse(e);
  }
}

export const GET = handle;
export const POST = handle;
