// Isolated UI fixture. This file is never imported by production code.
const incoming=new URLSearchParams(location.search).get('client')==='1';
const user={id:incoming?'client':'agency',email:incoming?'client@example.test':'agency@example.test'};
let invitations=[{id:'22222222-2222-4222-8222-222222222222',email:'client@example.test',business_name:'Example client business',industry:'Services',expires_at:new Date(Date.now()+86400000).toISOString(),accepted_at:null as string|null,revoked_at:null as string|null,workspace_id:null,incoming,inviter_email:'agency@example.test'}];
let members=[{user_id:user.id,email:user.email,role:'owner'},{user_id:'other-agency',email:'agent@example.test',role:'member'}];
export const db={
 auth:{getUser:async()=>({data:{user}}),getSession:async()=>({data:{session:{access_token:'fixture-only'}}})},
 async rpc(fn:string,args:any={}){
  if(fn==='crm_client_invitations')return {data:invitations};
  if(fn==='crm_client_invite'){invitations=[{...invitations[0],email:args.p_email,business_name:args.p_name,industry:args.p_industry}];return {data:invitations[0].id};}
  if(fn==='crm_client_invitation_revoke'){invitations[0].revoked_at=new Date().toISOString();return {data:null};}
  if(fn==='crm_client_access'){if(args.p_remove)members=members.filter(m=>m.user_id!==args.p_remove);return {data:members};}
  return {error:{message:'Unsupported fixture action'}};
 },
 from(table:string){const chain:any={select(_c:string){return chain;},eq(){return chain;},single:async()=>({data:{id:'11111111-1111-4111-8111-111111111111',owner_id:user.id}}),maybeSingle:async()=>({data:null}),then(resolve:any){resolve({data:table==='crm_workspaces'?[{id:'11111111-1111-4111-8111-111111111111',name:'Existing client business'}]:[]});}};return chain;}
};
export const browserSupabase=()=>db;
