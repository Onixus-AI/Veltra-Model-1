import {NextRequest} from 'next/server';
import {crmUser, crmError} from '@/lib/crm/server';
import {googleClient, googleSignInUrl} from '@/lib/mail/workspace-mail';
export const runtime = 'nodejs';

// Workspace Mail connection (Mail runs inside Workspace since 2026-11; Railway is retired).
// GET: is Gmail connected for the owner's workspace? POST: start Google sign-in. DELETE: disconnect.
type Status = {mailbox: string; status: string; last_pass_at: string | null; last_result: string | null}[];

async function home(client: Awaited<ReturnType<typeof crmUser>>['client'], requested: unknown) {
  if (typeof requested === 'string' && /^[a-f0-9-]{36}$/i.test(requested)) return requested;
  const {data, error} = await client.rpc('mail_google_home');
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const {client} = await crmUser(request);
    const workspace = await home(client, request.nextUrl.searchParams.get('workspace'));
    if (!workspace) return Response.json({connected: false, mailbox: null, mail_url: '', choose_workspace: true}, {headers: {'Cache-Control': 'no-store'}});
    const {data, error} = await client.rpc('mail_google_status', {p_workspace: workspace});
    if (error) throw new Error(error.message);
    const active = (data as Status).find(m => m.status === 'active') ?? (data as Status)[0];
    return Response.json({connected: active?.status === 'active', mailbox: active ? {email: active.mailbox} : null, status: active?.status ?? null,
      last_pass_at: active?.last_pass_at ?? null, last_result: active?.last_result ?? null, mail_url: '', workspace_id: workspace}, {headers: {'Cache-Control': 'no-store'}});
  } catch (e) { return crmError(e); }
}

export async function POST(request: NextRequest) {
  try {
    const {client} = await crmUser(request);
    const body = await request.json().catch(() => ({})) as {browser?: unknown; workspace_id?: unknown};
    const google = googleClient();
    if (!google) return Response.json({error: 'Gmail sign-in is not set up for Workspace yet.'}, {status: 503});
    const workspace = await home(client, body.workspace_id);
    if (!workspace) return Response.json({error: 'Choose which business this mailbox belongs to, then connect Gmail.'}, {status: 409});
    const browser = typeof body.browser === 'string' ? body.browser : null;
    const {data, error} = await client.rpc('mail_google_begin', {p_workspace: workspace, p_browser: browser});
    if (error) throw new Error(error.message);
    return Response.json({url: googleSignInUrl(google, request.nextUrl.origin, (data as {state: string}).state)}, {headers: {'Cache-Control': 'no-store'}});
  } catch (e) { return crmError(e); }
}

export async function DELETE(request: NextRequest) {
  try {
    const {client} = await crmUser(request);
    const workspace = await home(client, request.nextUrl.searchParams.get('workspace'));
    if (!workspace) return Response.json({ok: true});
    const {error} = await client.rpc('mail_google_disconnect', {p_workspace: workspace});
    if (error) throw new Error(error.message);
    return Response.json({ok: true});
  } catch (e) { return crmError(e); }
}
