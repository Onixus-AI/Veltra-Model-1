import type {SupabaseClient} from '@supabase/supabase-js';
import type {Customer} from './domain';
/** Bounded, workspace/RLS-scoped audience lookup; never download the CRM to build a campaign. */
export async function searchAudience(client:SupabaseClient,workspace:string,query:string,signal:AbortSignal,initial?:string):Promise<Customer[]>{
 let request=client.from('crm_customers').select('*').eq('workspace_id',workspace).not('email','is',null).eq('suppressed',false).eq('identity_review_required',false);
 const term=query.replace(/[^\p{L}\p{N}\s@.-]/gu,' ').trim().slice(0,120);
 if(initial)request=request.eq('id',initial);
 else if(term)request=request.or(['company','name','industry','location','email'].map(field=>`${field}.ilike.%${term}%`).join(','));
 const {data,error}=await request.order('company').order('id').limit(100).abortSignal(signal);
 if(error)throw Error('Audience search could not load. Retry before selecting recipients.');
 return (data??[]) as Customer[];
}
