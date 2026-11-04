import {NextRequest} from 'next/server';
import {anonStore} from '@/lib/revenue/server';
import {exchangeCode, googleClient} from '@/lib/mail/workspace-mail';
export const runtime = 'nodejs';

// Google returns here after "Connect Gmail". The single-use state proves who started it; the
// refresh token goes straight into Supabase Vault and is never logged or shown.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams, origin = request.nextUrl.origin;
  const back = (result: string, browser?: string | null) =>
    Response.redirect(`${origin}/settings/connections?mail=${result}${browser ? `&state=${encodeURIComponent(browser)}` : ''}`, 303);
  if (q.get('error')) return back('cancelled');
  const code = q.get('code'), state = q.get('state'), google = googleClient();
  if (!code || !state || !google) return back('error');
  try {
    const {refreshToken, mailbox} = await exchangeCode(google, origin, code);
    const r = await anonStore().rpc<{browser: string | null}>('mail_google_complete', {p_state: state, p_refresh_token: refreshToken, p_mailbox: mailbox});
    return back('connected', r.browser);
  } catch {
    return back('error');
  }
}
