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
    // Existing Workspace users prove ownership with their own live session.
    // Matching email addresses alone never links accounts or changes Signal routing.
    const workspaceAuthorization = request.headers.get('x-workspace-authorization') ?? '';
    if (/^Bearer [^\s]+$/.test(workspaceAuthorization)) {
      const { data: targetIdentity, error: targetError } = await admin.auth.getUser(workspaceAuthorization.slice(7));
      const target = targetIdentity.user;
      const orgId = target?.app_metadata?.organization_id ?? target?.app_metadata?.org_id;
      if (targetError || !target?.email || !target.email_confirmed_at || target.is_anonymous
        || target.email.toLowerCase().trim() !== email
        || typeof orgId !== 'string' || !/^[0-9a-f-]{36}$/i.test(orgId)) {
        return reply('Sign in to your verified Workspace account before linking it.', 403);
      }
      const { data: owned, error: ownedError } = await admin.from('crm_workspaces')
        .select('id').eq('owner_id', target.id);
      if (ownedError) return reply('Workspace ownership could not be checked.', 503);
      const ownedIds = (owned ?? []).map((row) => row.id);
      if (!ownedIds.length) return reply('Your Workspace account does not own a business Workspace.', 409);
      const { data: connected, error: connectedError } = await admin.from('crm_signal_connections')
        .select('workspace_id').eq('signal_client_id', user.id).maybeSingle();
      if (connectedError) return reply('The existing Signal connection could not be checked.', 503);
      const workspaceId = connected?.workspace_id && ownedIds.includes(connected.workspace_id)
        ? connected.workspace_id : ownedIds.length === 1 ? ownedIds[0] : null;
      if (!workspaceId) return reply('More than one Workspace is owned by this account. Contact support to select the correct business.', 409);
      const { data: saved, error: saveError } = await admin.from('onixus_workspace_identities')
        .insert({ onixus_user_id: user.id, workspace_user_id: target.id,
          organization_id: orgId, crm_workspace_id: workspaceId, email })
        .select('workspace_user_id,crm_workspace_id,email').single();
      if (saveError || !saved) return reply('This Workspace is already linked or could not be linked. Contact support to review it.', 409);
      link = saved;
    } else {
      const slug = `onixus-${user.id}`;
      const { data: org, error: orgError } = await admin.from('organizations')
        .insert({ name: businessName, slug }).select('id').single();
      if (orgError || !org) return reply('Workspace could not reserve your business. Contact support if this persists.', 503);
      const orgId = org.id;
      let createdUserId: string | null = null;
      let createdWorkspaceId: string | null = null;
      async function undoIncompleteAccount() {
        if (createdWorkspaceId) {
          await admin.from('crm_signal_connections').delete().eq('workspace_id', createdWorkspaceId);
          await admin.from('crm_memberships').delete().eq('workspace_id', createdWorkspaceId);
          await admin.from('crm_workspaces').delete().eq('id', createdWorkspaceId);
        }
        if (createdUserId) await admin.auth.admin.deleteUser(createdUserId);
        await admin.from('organizations').delete().eq('id', orgId);
      }
      // No paid plan or AI allowance is granted merely by signing up.
      const { data: wallet, error: walletError } = await admin.from('credit_wallets').update({
        plan_name: 'Onixus starter access', monthly_price_cents: 0,
        monthly_credit_allowance: 0, credits_remaining: 0,
      }).eq('organization_id', orgId).select('organization_id').single();
      if (walletError || !wallet) {
        await undoIncompleteAccount();
        return reply('Workspace entitlement setup did not complete.', 503);
      }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email, email_confirm: true, password: crypto.randomUUID() + crypto.randomUUID(),
        app_metadata: { organization_id: orgId, onixus_user_id: user.id },
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
      // The verified Onixus JWT and client profile prove this new Signal link.
      // A pre-existing link for that Signal client must remain untouched.
      const { error: signalError } = await admin.from('crm_signal_connections').insert({
        workspace_id: workspace.id, signal_client_id: user.id,
        business_name: businessName, connected_by: created.user.id,
      });
      if (signalError) {
        await undoIncompleteAccount();
        return reply('Your Signal business is already linked to another Workspace or could not be connected. Contact support to review the existing link.', 409);
      }
      const { data: saved, error: saveError } = await admin.from('onixus_workspace_identities')
        .insert({ onixus_user_id: user.id, workspace_user_id: created.user.id,
          organization_id: orgId, crm_workspace_id: workspace.id, email })
        .select('workspace_user_id,crm_workspace_id,email').single();
      if (saveError || !saved) {
        await undoIncompleteAccount();
        return reply('Workspace identity link did not complete.', 503);
      }
      link = saved;
    }
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
