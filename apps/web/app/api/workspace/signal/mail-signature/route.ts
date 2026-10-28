import {signalBusinessClient} from '@/lib/signal-actions';
import {createHash} from 'node:crypto';
import {crmUser,crmError} from '@/lib/crm/server';
import {uuid,noStore} from '@/lib/revenue/server';
export const runtime='nodejs';
export const maxDuration=60;
const fingerprint=(business:unknown)=>createHash('sha256').update(JSON.stringify(business)).digest('hex');
async function access(request:Request,workspace:unknown,signalClient:unknown){
 if(!uuid(workspace))throw Error('400:Choose a business.');
 const {client,user}=await crmUser(request);if(!user.email_confirmed_at)throw Error('403:Verify your Workspace email.');
 const {data:business,error}=await client.from('crm_workspaces').select('id').eq('id',workspace).eq('owner_id',user.id).maybeSingle();
 if(error||!business)throw Error('403:Only the Workspace owner can update this Mail signature.');
 const {data:signal}=await client.from('crm_signal_connections').select('workspace_id,signal_client_id').eq('workspace_id',workspace).maybeSingle();if(!signal)throw Error('409:Connect this business to Signal first.');if(signalBusinessClient(workspace,signal.signal_client_id)!==signalClient)throw Error('403:Choose the Signal business linked to this Workspace.');
 const base=process.env.VELTRA_MAIL_URL;if(!base)throw Error('503:Onixus Mail is not configured.');
 async function mail(path:string,method='GET',body?:unknown){const r=await fetch(base!.replace(/\/$/,'')+path,{method,headers:{authorization:request.headers.get('authorization')!,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});const d=await r.json();if(!r.ok)throw Error(`${[401,403,409].includes(r.status)?r.status:503}:${d.error||'Mail could not complete this action.'}`);return d;}
 const link=await mail('/chat/crm');if(!link.connected||link.workspace_id!==workspace)throw Error('409:Connect this business to the same Mail account before applying a signature.');
 const {account}=await mail('/chat/platform/api/me');if(!account?.business||!uuid(account.id))throw Error('503:Mail account details could not be verified.');
 return {mail,account};
}
export async function GET(request:Request){try{const {account}=await access(request,new URL(request.url).searchParams.get('workspace'),new URL(request.url).searchParams.get('client'));return Response.json({account_id:account.id,name:account.business.name,email:account.mailbox?.email||account.login_email,signature:account.business.signature||'',fingerprint:fingerprint(account.business)},{headers:noStore});}catch(e){return crmError(e);}}
export async function POST(request:Request){try{
 const origin=request.headers.get('origin');if(!origin||!URL.canParse(origin)||new URL(origin).host!==request.headers.get('host'))throw Error('403:Review this signature in Workspace.');
 const raw=await request.text();if(raw.length>2048)throw Error('413:Signature request is too large.');let b:any;try{b=JSON.parse(raw);}catch{throw Error('400:Invalid signature request.');}
 if(b.confirmed!==true||typeof b.signature!=='string'||!b.signature.trim()||b.signature.length>200||typeof b.fingerprint!=='string')throw Error('400:Review a signature of up to 200 characters.');
 const {mail,account}=await access(request,b.workspace,b.client);if(fingerprint(account.business)!==b.fingerprint)throw Error('409:Mail business settings changed. Review the signature again.');
 const signature=b.signature.trim(),out=await mail('/chat/platform/api/business','PUT',{...account.business,signature});
 if(out.account?.id!==account.id||out.account?.business?.signature!==signature)throw Error('503:Mail did not return a matching saved signature. Check Mail settings before retrying.');
 return Response.json({saved:true,account_id:account.id,signature,message:'Signature saved to the connected Onixus Mail business profile.'},{headers:noStore});
 }catch(e){return crmError(e);}}
