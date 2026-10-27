export type SignalReceipt={client_id:string;organization_id:string|null;business_name:string;email:string;workspace_id:string};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
export async function verifySignalCode(code:string,workspace:string,email:string,options:{url:string;key:string;fetcher?:typeof fetch}):Promise<SignalReceipt>{
 if(!/^[a-f0-9]{64}$/.test(code)||!uuid(workspace))throw Error('400:Enter a valid Signal connection code and workspace.');
 // Fixed provider configuration, never a caller-controlled URL. Tokens and codes are never logged.
 if(new URL(options.url).origin!=='https://rjwbfkuzgusaoizcmmgf.supabase.co')throw Error('503:Signal verification is not configured for the Onixus project.');
 const response=await (options.fetcher??fetch)(options.url+'/rest/v1/rpc/signal_consume_workspace_code',{method:'POST',headers:{apikey:options.key,'Content-Type':'application/json'},body:JSON.stringify({p_code:code,p_workspace:workspace,p_email:email.toLowerCase().trim()}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('409:Signal could not verify this code. Check the login email and workspace, then create a new code.');
 const data=await response.json() as SignalReceipt;
 if(!uuid(data?.client_id)||(data.organization_id!==null&&!uuid(data.organization_id))||data.workspace_id!==workspace||data.email!==email.toLowerCase().trim()||typeof data.business_name!=='string'||!data.business_name.trim()||data.business_name.length>500)throw Error('409:Signal returned an invalid connection receipt.');
 return data;
}
