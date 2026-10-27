'use client';
import {useEffect,useRef,useState} from 'react';
import {db} from '@/lib/crm/client';
import {onboardingRpc} from '@/lib/crm/onboarding';
type Member={user_id:string;email:string;role:string};
export default function WorkspaceAccess({workspace}:{workspace:string}){
 const [members,setMembers]=useState<Member[]>([]),[owner,setOwner]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[review,setReview]=useState<Member|null>(null);const lock=useRef(false);
 useEffect(()=>{let live=true;void(async()=>{try{if(!db)return;const {data:a}=await db.auth.getUser();const {data:w,error:e}=await db.from('crm_workspaces').select('owner_id').eq('id',workspace).single();if(e)throw e;if(w.owner_id!==a.user?.id)return;const rows=await onboardingRpc<Member[]>(db,'crm_client_access',{p_workspace:workspace});if(live){setOwner(true);setMembers(rows);}}catch(e){if(live)setError(e instanceof Error?e.message:'Could not read workspace access.');}})();return()=>{live=false;};},[workspace]);
 async function remove(){if(!review||!db||lock.current)return;lock.current=true;setBusy(true);setError('');try{setMembers(await onboardingRpc<Member[]>(db,'crm_client_access',{p_workspace:workspace,p_remove:review.user_id}));setReview(null);}catch(e){setError(e instanceof Error?e.message:'Could not remove access.');}finally{lock.current=false;setBusy(false);}}
 if(!owner&&!error)return null;
 return <section className="crm-panel"><h2>Workspace access</h2>{error&&<p role="alert">{error}</p>}{members.map(m=><div className="crm-row" key={m.user_id}><div><b>{m.email}</b><p>{m.role==='member'?'CRM editing access':m.role==='owner'?'Workspace owner':'Read-only access'}</p></div>{m.role!=='owner'&&<button disabled={busy} onClick={()=>setReview(m)}>Remove access</button>}</div>)}{review&&<div role="group" aria-label="Confirm access removal"><p>Remove {review.email} from this workspace? They will lose access to its CRM records. This does not delete their account.</p><button disabled={busy} onClick={()=>setReview(null)}>Cancel</button><button disabled={busy} onClick={()=>void remove()}>Confirm removal</button></div>}</section>;
}
