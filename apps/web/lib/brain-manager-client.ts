import {gatewayAuthorizationHeaders} from './client-session';
import type {BrainScope} from './shared-brain';
export type BrainManagerContext={conversation_id?:string;crm_scope?:BrainScope};
export type ManagedMemory={id:string;content:string;kind:string;source_app:string;source_ref:string;status:string;revision:number;expires_at:string|null;updated_at:string;workspace_id:string|null;customer_id:string|null};
export type BrainList={records:ManagedMemory[];scope:BrainScope;can_write:boolean;limit:number};
export type BrainReview={kind:'preview'|'result';reply:string;review_id?:string;details?:unknown;changed?:boolean};
export type BrainManagerRequest=(body:Record<string,unknown>,signal?:AbortSignal)=>Promise<BrainList|BrainReview>;
export const brainManagerRequest:BrainManagerRequest=async(body,signal)=>{
 const response=await fetch('/api/brain',{method:'POST',headers:{...await gatewayAuthorizationHeaders(),'Content-Type':'application/json'},body:JSON.stringify(body),signal,cache:'no-store'});
 const result=await response.json();if(!response.ok)throw Error(result.error??'Shared brain could not be loaded.');return result;
};
export function memorySourceUrl(source:string){try{const url=new URL(source);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}}
export function memoryReviewView(review:BrainReview){
 const value=review.details;if(!value||typeof value!=='object')return null;const details=value as Record<string,unknown>;
 const actions:Record<string,string>={brain_propose:'Add proposed memory',brain_approve:'Approve for Chat recall',brain_correct:'Correct and request reapproval',brain_forget:'Forget saved memory'};
 const action=typeof details.action==='string'&&Object.hasOwn(actions,details.action)?actions[details.action]:undefined;
 const before=details.before&&typeof details.before==='object'?details.before as Record<string,unknown>:null;
 if(!action||typeof details.scope!=='string'||(details.action!=='brain_propose'&&typeof before?.content!=='string'))return null;
 if(['brain_propose','brain_correct'].includes(String(details.action))&&typeof details.content!=='string')return null;
 return {action,scope:details.scope,before:typeof before?.content==='string'?before.content:null,
  content:typeof details.content==='string'?details.content:null,
  source:typeof details.source==='string'?details.source:typeof before?.source_ref==='string'?before.source_ref:'Not supplied',
  expires:details.expires_at===null?'No expiry':typeof details.expires_at==='string'?details.expires_at:typeof before?.expires_at==='string'?before.expires_at:'No expiry'};
}
