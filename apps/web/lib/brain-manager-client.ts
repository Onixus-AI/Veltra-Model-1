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
