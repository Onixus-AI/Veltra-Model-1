import type {SupabaseClient} from '@supabase/supabase-js';

type WorkItem={id:string;status:string;updated_at:string;category?:string;from_email?:string;subject?:string;draft?:string|null;needs_owner?:boolean;owner_reason?:string|null;plan?:{action?:string;headline?:string;needs_review?:boolean;quote_check?:string}|null};
type Snapshot={id:string;updated_at:string;draft:string;plan:string;category:string};
const same=(a:WorkItem,s:Snapshot)=>a.id===s.id&&a.status==='pending'&&a.updated_at===s.updated_at&&a.draft===s.draft&&JSON.stringify(a.plan??null)===s.plan&&(a.category??'')===s.category;
const eligible=(i:WorkItem)=>i.status==='pending'&&i.plan?.action==='reply'&&!i.needs_owner&&!i.plan.needs_review&&typeof i.draft==='string'&&Boolean(i.draft.trim())&&i.draft.length<=8000;

export async function workspaceMailItems(client:SupabaseClient,workspace:string):Promise<WorkItem[]>{
 const {data,error}=await client.rpc('mail_items_list',{p_workspace:workspace,p_status:'pending'});
 if(error||!Array.isArray(data))throw Error('503:Workspace Mail waiting items could not be read.');
 return data as WorkItem[];
}
export function workspaceMailList(items:WorkItem[]){return {source:'Workspace Mail → Waiting for you',shown:items.length,limit:200,truncated:items.length===200,items:items.map(i=>({id:i.id,headline:i.plan?.headline??i.subject,subject:i.subject,from:i.from_email,category:i.category,action:i.plan?.action,needs_owner:!!i.needs_owner,owner_reason:i.owner_reason,needs_review:!!i.plan?.needs_review,quote_check:i.plan?.quote_check,ready_for_bulk:eligible(i)}))};}
export function workspaceMailBatch(items:WorkItem[]){
 const ready=items.filter(eligible).slice(0,20);
 const snapshots:Snapshot[]=ready.map(i=>({id:i.id,updated_at:i.updated_at,draft:i.draft!,plan:JSON.stringify(i.plan??null),category:i.category??''}));
 return {snapshots,review:{source:'Workspace Mail → Waiting for you',eligible_total:items.filter(eligible).length,selected:ready.map(i=>({id:i.id,from:i.from_email,subject:i.subject,category:i.category,action:i.plan?.action,draft:i.draft})),excluded:items.filter(i=>!eligible(i)).map(i=>({id:i.id,subject:i.subject,reason:i.needs_owner?i.owner_reason||'Owner decision required':i.plan?.needs_review?i.plan.quote_check||'Individual review required':'Not a complete reply draft'})),notice:'Confirm approves only these exact reply drafts for the Mail worker. It does not prove sending or delivery. Changed, flagged, unpriced, or missing drafts stay pending. Maximum 20 per review.'}};
}
export async function confirmWorkspaceMailBatch(client:SupabaseClient,workspace:string,snapshots:Snapshot[]){
 const current=await workspaceMailItems(client,workspace),byId=new Map(current.map(i=>[i.id,i]));
 const items:{id:string;status:string;reason?:string}[]=[];
 for(const s of snapshots){
  const item=byId.get(s.id);
  if(!item||!same(item,s)||!eligible(item)){items.push({id:s.id,status:'skipped',reason:'Item changed or is no longer eligible.'});continue;}
  const {data,error}=await client.rpc('mail_item_decide',{p_workspace:workspace,p_id:s.id,p_decision:'approve',p_draft:s.draft});
  items.push(error||data?.status!=='approved'?{id:s.id,status:'failed',reason:error?.message?.slice(0,240)??'No approval receipt.'}:{id:s.id,status:'approved'});
 }
 return {action:'workspace_mail_bulk_approve',status:items.every(i=>i.status==='approved')?'completed':'partial',approved:items.filter(i=>i.status==='approved').length,skipped:items.filter(i=>i.status==='skipped').length,failed:items.filter(i=>i.status==='failed').length,items,notice:'Approved means queued for the Mail worker; provider acceptance and delivery are not verified.'};
}
