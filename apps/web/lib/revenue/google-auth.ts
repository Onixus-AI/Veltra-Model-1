import {MailProviderError} from './mail-provider';

// Access tokens from the Onixus Mail Google OAuth client's refresh token. One refresh token serves
// Gmail and Calendar; which APIs work depends on the scopes the person granted. Never logged.

export type GoogleCredentials = {clientId: string; clientSecret: string; refreshToken: string};

export function googleAccessToken(credentials: GoogleCredentials, o: {fetcher?: typeof fetch; tokenUrl?: string} = {}) {
  const fetcher = o.fetcher ?? fetch;
  let access: {token: string; until: number} | null = null;
  return {
    async get(): Promise<string> {
      if (access && access.until > Date.now() + 30_000) return access.token;
      const response = await fetcher(o.tokenUrl ?? 'https://oauth2.googleapis.com/token', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({client_id: credentials.clientId, client_secret: credentials.clientSecret, refresh_token: credentials.refreshToken, grant_type: 'refresh_token'}), signal: AbortSignal.timeout(15000)});
      const data = await response.json().catch(() => ({})) as {access_token?: string; expires_in?: number; error?: string};
      if (!response.ok || !data.access_token) {
        if (data.error === 'invalid_grant' || response.status === 400 || response.status === 401) throw new MailProviderError('auth_expired', 'Google connection expired or was revoked. Reconnect Google in Onixus Mail.', false);
        throw new MailProviderError('temporary', 'Google sign-in is temporarily unavailable.', true);
      }
      access = {token: data.access_token, until: Date.now() + (data.expires_in ?? 3600) * 1000};
      return access.token;
    },
    reset() { access = null; },
  };
}
