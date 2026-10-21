import {taskAccessEnabled} from '@/lib/task-access-config';
import {crmUser,crmError} from '@/lib/crm/server';
import {ACCESS_APPS,requireTaskAccess,type AccessApp} from '@/lib/task-access';
export const runtime='nodejs';
export async function POST(request:Request){try{
 if(!taskAccessEnabled())return Response.json({enabled:false},{headers:{'Cache-Control':'no-store'}});
 const raw=await request.text();if(raw.length>4000)throw Error('413:Task permission request is too large.');let b;try{b=JSON.parse(raw);}catch{throw Error('400:Invalid task permission request.');}
 if(!b||typeof b!=='object'||typeof b.task_id!=='string'||!(/^[a-f0-9-]{36}$/i.test(b.task_id)))throw Error('400:Choose a valid task.');
 if(b.action==='check'){if(!ACCESS_APPS.includes(b.app))throw Error('400:Unknown app.');return await requireTaskAccess(request,b.task_id,[b.app as AccessApp])??Response.json({allowed:true},{headers:{'Cache-Control':'no-store'}});}
 if(!['start','decide','finish'].includes(b.action))throw Error('400:Unknown permission action.');
 if(b.action==='decide'&&(!ACCESS_APPS.includes(b.app)||typeof b.allowed!=='boolean'))throw Error('400:Choose Allow or Deny for the named app.');
 if(b.action==='start'&&(typeof b.purpose!=='string'||!b.purpose.trim()||b.purpose.length>1000))throw Error('400:Describe the current task.');
 const {client}=await crmUser(request);const {data,error}=await client.rpc('veltra_task_access',{p_action:b.action,p_task:b.task_id,p_purpose:b.action==='start'?b.purpose:null,p_app:b.action==='decide'?b.app:null,p_allowed:b.action==='decide'?b.allowed:null});if(error)throw Error('409:Task permission could not be recorded. Refresh and start a new task.');return Response.json(data,{headers:{'Cache-Control':'no-store'}});
}catch(e){return crmError(e);}}
