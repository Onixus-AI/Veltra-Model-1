/** Framework-independent example. The existing API remains the authorization boundary. */
export async function readBusinessOverview({origin,token,workspace,period='month',fetcher=fetch}){
 let base;
 try{base=new URL(origin);}catch{throw Error('Set the Workspace origin, for example https://workspace.example.');}
 const local=['localhost','127.0.0.1','[::1]'].includes(base.hostname);
 if((base.protocol!=='https:'&&!(local&&base.protocol==='http:'))||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw Error('Use an HTTPS origin without credentials, path or query. HTTP is supported only for local development.');
 if(typeof token!=='string'||!token||/\s/.test(token)||token.startsWith('veltra_sk_'))throw Error('Supply your signed-in Workspace access token, not a gateway API key.');
 if(typeof workspace!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(workspace))throw Error('Choose a valid business workspace ID.');
 if(!['today','week','month'].includes(period))throw Error('Choose today, week or month.');
 const url=new URL('/api/workspace/overview',base);url.searchParams.set('workspace',workspace);url.searchParams.set('period',period);
 let response;
 try{response=await fetcher(url,{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});}catch{throw Error('Workspace could not be reached. Check the origin and connection. No request was retried.');}
 if(!response.ok){
  const messages={400:'Workspace rejected the business or period.',401:'Your session expired or is invalid. Sign in again.',403:'This account does not have access to the selected business.',429:'Workspace is limiting requests. Wait before trying again.'};
  throw Error(messages[response.status]??'The business overview is unavailable. No result was substituted.');
 }
 let data;
 try{if(!response.headers.get('content-type')?.includes('application/json'))throw Error();data=await response.json();}catch{throw Error('Workspace returned an unreadable overview.');}
 if(!data||typeof data!=='object'||Array.isArray(data)||data.workspace!==workspace||data.period!==period||!data.overview||typeof data.overview!=='object'||Array.isArray(data.overview)||!data.overview.metrics||typeof data.overview.metrics!=='object'||Array.isArray(data.overview.metrics))throw Error('Workspace returned an unexpected business or overview.');
 // Missing metrics and optional sections stay missing/null. Never replace unknown values with zero.
 return data;
}
