import {crmUser,crmError} from '@/lib/crm/server';
import {readJson,uuid,noStore} from '@/lib/revenue/server';
export const runtime='nodejs';
export async function POST(request:Request){try{
 if(process.env.SIGNAL_WORKSPACE_SSO_ENABLED!=='true')throw Error('503:Signal is linked, but secure Workspace sign-in is awaiting activation.');
 const origin=request.headers.get('origin');if(!origin||!URL.canParse(origin)||new URL(origin).host!==request.headers.get('host'))throw Error('403:Open Signal from Workspace.');
 const {user}=await crmUser(request);if(!user.email_confirmed_at)throw Error('403:Verify your Workspace email.');
 const body=await readJson(request,1024);if(!uuid(body.workspace))throw Error('400:Choose a business.');
 const publicKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,signalKey=process.env.SIGNAL_SUPABASE_PUBLISHABLE_KEY;
 if(!publicKey||!signalKey)throw Error('503:Signal launch is not configured.');
 const r=await fetch('https://rjwbfkuzgusaoizcmmgf.supabase.co/functions/v1/workspace-signal-launch',{
  method:'POST',headers:{Authorization:request.headers.get('authorization')!,apikey:signalKey,'x-workspace-public-key':publicKey,'Content-Type':'application/json'},
  body:JSON.stringify({workspace:body.workspace}),cache:'no-store',signal:AbortSignal.timeout(20000)});
 const data=await r.json();if(!r.ok)throw Error(`${[400,401,403,503].includes(r.status)?r.status:503}:${data.error||'Signal could not open.'}`);
 if(typeof data.token_hash!=='string'||!uuid(data.client_id))throw Error('503:Signal returned an invalid sign-in receipt.');
 return Response.json(data,{headers:{...noStore,'Referrer-Policy':'no-referrer'}});
 }catch(e){return crmError(e);}}
