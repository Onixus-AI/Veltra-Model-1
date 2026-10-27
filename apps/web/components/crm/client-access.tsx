
'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {db} from '@/lib/crm/client';
import {onboardingRpc,invitationStatus,type ClientInvitation} from '@/lib/crm/onboarding';
export default function ClientAccess(){
 const [rows,setRows]=useState<ClientInvitation[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const lock=useRef(false);
 async function load(){if(db)setRows(await onboardingRpc<ClientInvitation[]>(db,'crm_client_invitations'));}
 useEffect(()=>{void load().catch(e=>setError(e.message));},[]);
 async function run(fn:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await fn();await load();}catch(e){setError(e instanceof Error?e.message:'Could not update invitations.');}finally{lock.current=false;setBusy(false);}}
 function invite(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);void run(async()=>{await onboardingRpc(db!,'crm_client_invite',{p_email:String(f.get('email')),p_name:String(f.get('name')),p_industry:String(f.get('industry'))});setNotice('Invitation prepared. Copy its link and share it with the client. No email has been sent.');});}
 return <section className="crm-panel"><h2>Client access</h2><p>Invite a client to own their Workspace and connect their own Mail. When they accept, your account receives CRM editing access. They can choose an existing workspace to avoid duplicates.</p>
 <form className="crm-client-invite-form" onSubmit={invite}><fieldset disabled={busy}><label>Business name<input name="name" required maxLength={120}/></label><label>Industry<input name="industry" required maxLength={120}/></label><label>Client login email<input name="email" type="email" required maxLength={254}/></label><button className="primary">Prepare client invitation</button></fieldset></form>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}<div className="crm-actions"><a href="/workspace/join">View invitations for my email</a><button disabled={busy} onClick={()=>void run(load)}>Refresh invitations</button></div>
 {rows.filter(i=>!i.incoming).map(i=><article className="crm-row" key={i.id}><div><b>{i.business_name}</b><p>{i.email}</p><small>{invitationStatus(i)} · Expires {new Date(i.expires_at).toLocaleString()}</small></div>
 <div className="crm-actions">{invitationStatus(i)==='Pending acceptance'&&<><button disabled={busy} onClick={()=>void navigator.clipboard.writeText(new URL('/workspace/join?invite='+i.id,location.origin).href).then(()=>setNotice('Invitation link copied. No email has been sent.')).catch(()=>setError('Clipboard unavailable. Open the invitation link and copy its address.'))}>Copy invitation link</button><a href={'/workspace/join?invite='+i.id}>Open invitation link</a><button disabled={busy} onClick={()=>void run(async()=>{await onboardingRpc(db!,'crm_client_invitation_revoke',{p_invitation:i.id});setNotice('Invitation revoked.');})}>Revoke invitation</button></>}{i.workspace_id&&<a href={'/crm?view=Connections&workspace='+i.workspace_id}>Open client workspace</a>}</div></article>)}
 </section>;
}
