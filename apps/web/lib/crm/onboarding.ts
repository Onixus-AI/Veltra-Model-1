import type {SupabaseClient} from '@supabase/supabase-js';
export type ClientInvitation={id:string;email:string;business_name:string;industry:string;expires_at:string;accepted_at:string|null;revoked_at:string|null;workspace_id:string|null;incoming:boolean;inviter_email:string};
export async function onboardingRpc<T>(client:SupabaseClient,fn:string,args:Record<string,unknown>={}){
 const {data,error}=await client.rpc(fn,args);
 if(error)throw Error(['PGRST202','42P01','42883'].includes(error.code)?'Client onboarding is not enabled on this server yet. Ask your administrator to apply the onboarding migration.':error.message);
 return data as T;
}
export function invitationStatus(i:ClientInvitation){return i.accepted_at?'Accepted':i.revoked_at?'Revoked':Date.parse(i.expires_at)<=Date.now()?'Expired':'Pending acceptance';}
