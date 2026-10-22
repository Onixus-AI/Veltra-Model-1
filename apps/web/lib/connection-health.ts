export type HealthApp='crm'|'mail';
export type ConnectionHealth={state:'checking'|'linked'|'disconnected'|'setup'|'signin'|'denied'|'unavailable';label:string;detail:string};
export function connectionHealth(app:HealthApp,status:number,value:unknown):ConnectionHealth{
 if(status===401)return {state:'signin',label:'Sign in required',detail:'Sign in again, then recheck this connection.'};
 if(status===403)return {state:'denied',label:'Access denied',detail:'Your account cannot access this connection. Ask the workspace owner to review access.'};
 const unavailable:ConnectionHealth={state:'unavailable',label:'Service unavailable',detail:'The connection could not be verified. Recheck shortly; this does not mean your account was disconnected.'};
 if(status<200||status>=300||!value||typeof value!=='object')return unavailable;
 const data=value as Record<string,unknown>;if(typeof data.connected!=='boolean')return unavailable;
 if(app==='crm'){
  if(data.available!==true||typeof data.has_workspace!=='boolean')return unavailable;
  if(!data.has_workspace)return {state:'setup',label:'Workspace needed',detail:'CRM responded, but no accessible business workspace was found. Open CRM to set one up.'};
  return data.connected?{state:'linked',label:'Workspace link verified',detail:'CRM responded and an accessible workspace exists. Saving records and Chat actions still need separate verification.'}:{state:'disconnected',label:'Not connected',detail:'CRM responded and a workspace is available. Connect CRM below to show it in Chat.'};
 }
 if(data.connected&&(!data.mailbox||typeof data.mailbox!=='object'||typeof (data.mailbox as Record<string,unknown>).email!=='string'||!(data.mailbox as {email:string}).email.trim()))return unavailable;
 return data.connected?{state:'linked',label:'Mailbox link verified',detail:'Mail responded with a linked mailbox. Inbox access, drafts and sending still need separate verification.'}:{state:'disconnected',label:'Not connected',detail:'Mail responded without a linked mailbox. Connect Google below to continue.'};
}
