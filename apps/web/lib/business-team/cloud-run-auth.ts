import {getVercelOidcToken} from '@vercel/oidc';

type AuthOptions = {
  env?: Record<string,string|undefined>;
  transport?: typeof fetch;
  oidc?: () => Promise<string>;
};

/** Server-only: obtain a fresh Google ID token without a service-account key. */
export async function cloudRunHeaders(endpoint: URL, options: AuthOptions = {}): Promise<Record<string,string>> {
  const env = options.env ?? process.env;
  const isCloudRun = endpoint.hostname.endsWith('.run.app');
  if (!isCloudRun && !env.HERMES_GCP_PROVIDER) return {};
  const provider = env.HERMES_GCP_PROVIDER;
  const account = env.HERMES_GCP_INVOKER;
  if (!isCloudRun || endpoint.protocol !== 'https:' || endpoint.port || endpoint.pathname !== '/' ||
      !provider || !/^projects\/\d+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/.test(provider) ||
      !account || !/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(account) ||
      env.VERCEL_ENV !== 'production') {
    throw Error('503:Private Hermes authentication is not configured for this deployment.');
  }
  const transport = options.transport ?? fetch;
  const signal = AbortSignal.timeout(10000);
  const post = async (url: string, body: unknown, headers: Record<string,string> = {}) => {
    const response = await transport(url, {method:'POST', headers:{'Content-Type':'application/json', ...headers},
      body:JSON.stringify(body), redirect:'error', cache:'no-store', signal});
    if (!response.ok) throw Error('Authentication rejected');
    return response.json();
  };
  try {
    const subjectToken = await (options.oidc ?? getVercelOidcToken)();
    if (!subjectToken) throw Error('Missing identity');
    const exchanged = await post('https://sts.googleapis.com/v1/token', {
      grantType:'urn:ietf:params:oauth:grant-type:token-exchange',
      audience:'//iam.googleapis.com/'+provider,
      scope:'https://www.googleapis.com/auth/cloud-platform',
      requestedTokenType:'urn:ietf:params:oauth:token-type:access_token',
      subjectTokenType:'urn:ietf:params:oauth:token-type:jwt', subjectToken,
    });
    if (typeof exchanged.access_token !== 'string' || !exchanged.access_token) throw Error('Missing access token');
    const identity = await post('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'+account+':generateIdToken',
      {audience:endpoint.origin, includeEmail:true}, {Authorization:'Bearer '+exchanged.access_token});
    if (typeof identity.token !== 'string' || !identity.token) throw Error('Missing identity token');
    // Cloud Run consumes this header; the application Authorization token remains separate.
    return {'X-Serverless-Authorization':'Bearer '+identity.token};
  } catch {
    // Never surface provider bodies, token values or SDK diagnostics to users/logs.
    throw Error('503:Private Hermes authentication failed. No planning request was sent.');
  }
}
