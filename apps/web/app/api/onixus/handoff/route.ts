import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
const ONIXUS_AUTH_URL = 'https://rjwbfkuzgusaoizcmmgf.supabase.co';
const noStore = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };

function reply(error: string, status: number) {
  return Response.json({ error }, { status, headers: noStore });
}

export async function POST(request: Request) {
  const sourceKey = process.env.SIGNAL_SUPABASE_PUBLISHABLE_KEY;
  const workspaceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sourceKey || !workspaceUrl || !serviceKey) return reply('Workspace handoff is not configured.', 503);
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer [^\s]+$/.test(authorization)) return reply('Sign in to Onixus first.', 401);

  const source = createClient(ONIXUS_AUTH_URL, sourceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: identity, error: identityError } = await source.auth.getUser(authorization.slice(7));
  const user = identity.user;
  if (identityError || !user?.email || user.is_anonymous || !user.email_confirmed_at) {
    return reply('Verify your Onixus email before opening Workspace.', 403);
  }
  const { data: profile, error: profileError } = await source.from('client_profiles')
    .select('id,business_name').eq('id', user.id).maybeSingle();
  if (profileError || !profile) return reply('Your Onixus client account is not ready. Refresh Onixus and try again.', 403);

  const admin = createClient(workspaceUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = user.email.toLowerCase().trim();
  const businessName = String(profile.business_name || 'My business').trim().slice(0, 120);
  const { data: existing, error: lookupError } = await admin.from('onixus_workspace_identities')
    .select('workspace_user_id,crm_workspace_id,email').eq('onixus_user_id', user.id).maybeSingle();
  if (lookupError) return reply('Workspace identity linking is unavailable.', 503);
  if (existing && existing.email !== email) return reply('Your Onixus email changed. Contact support to verify this Workspace link.', 409);

  let link = existing;
  if (!link) {
    const slug = `onixus-${user.id}`;
    const { data: org, error: orgError } = await admin.from('organizations')
      .insert({ name: businessName, slug }).select('id').single();
    if (orgError || !org) return reply('Workspace could not reserve your business. Contact support if this persists.', 503);
    let createdUserId: string | null = null;
    let createdWorkspaceId: string | null = null;
    async function undoIncompleteAccount() {
      if (createdWorkspaceId) {
        await admin.from('crm_memberships').delete().eq('workspace_id', createdWorkspaceId);
        await admin.from('crm_workspaces').delete().eq('id', createdWorkspaceId);
      }
      if (createdUserId) await admin.auth.admin.deleteUser(createdUserId);
      await admin.from('organizations').delete().eq('id', org.id);
    }
    // No paid plan or AI allowance is granted merely by signing up.
    const { data: wallet, error: walletError } = await admin.from('credit_wallets').update({
      plan_name: 'Onixus starter access', monthly_price_cents: 0,
      monthly_credit_allowance: 0, credits_remaining: 0,
    }).eq('organization_id', org.id).select('organization_id').single();
    if (walletError || !wallet) {
      await undoIncompleteAccount();
      return reply('Workspace entitlement setup did not complete.', 503);
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, email_confirm: true, password: crypto.randomUUID() + crypto.randomUUID(),
      app_metadata: { organization_id: org.id, onixus_user_id: user.id },
    });
    // Do not take over an existing Workspace account based on an email match.
    if (createError || !created.user) {
      await undoIncompleteAccount();
      return reply('A Workspace account already uses this email or could not be created. Contact support to link it securely.', 409);
    }
    createdUserId = created.user.id;
    const { data: workspace, error: workspaceError } = await admin.from('crm_workspaces')
      .insert({ name: businessName, industry: 'General', owner_id: created.user.id }).select('id').single();
    if (workspaceError || !workspace) {
      await undoIncompleteAccount();
      return reply('Workspace business setup did not complete.', 503);
    }
    createdWorkspaceId = workspace.id;
    const { error: membershipError } = await admin.from('crm_memberships')
      .upsert({ workspace_id: workspace.id, user_id: created.user.id, role: 'owner' }, { onConflict: 'workspace_id,user_id' });
    if (membershipError) {
      await undoIncompleteAccount();
      return reply('Workspace owner access did not complete.', 503);
    }
    const { data: saved, error: saveError } = await admin.from('onixus_workspace_identities')
      .insert({ onixus_user_id: user.id, workspace_user_id: created.user.id,
        organization_id: org.id, crm_workspace_id: workspace.id, email })
      .select('workspace_user_id,crm_workspace_id,email').single();
    if (saveError || !saved) {
      await undoIncompleteAccount();
      return reply('Workspace identity link did not complete.', 503);
    }
    link = saved;
  }

  const { data: claimed, error: claimError } = await admin.rpc('onixus_claim_workspace_handoff', { p_onixus_user: user.id });
  if (claimError) return reply('Workspace handoff is unavailable.', 503);
  if (!claimed) return reply('Please wait a minute before opening Workspace again.', 429);
  const { data: magic, error: magicError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (magicError || !magic?.properties?.hashed_token || magic.user?.id !== link.workspace_user_id) {
    return reply('Workspace sign-in could not be prepared.', 503);
  }
  return Response.json({ token_hash: magic.properties.hashed_token, workspace: link.crm_workspace_id }, { headers: noStore });
}
