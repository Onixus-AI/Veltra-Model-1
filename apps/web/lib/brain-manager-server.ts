import {crmUser,crmError} from './crm/server';
import {agentScope} from './agent-actions';
import {brainPlan,checkBrainScope,recallBrain,runBrain} from './shared-brain';
/** Direct account management, not an AI access grant. All writes reuse reviewed runBrain. */
export function brainManagerHandler(authenticate=crmUser){return async(request:Request)=>{try{
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw Error('403:Open shared brain from your workspace.');
 const raw=await request.text();if(raw.length>16000)throw Error('413:Memory request is too large.');
 let body;try{body=JSON.parse(raw);}catch{throw Error('400:Invalid memory request.');}
 if(!body||typeof body!=='object'||Array.isArray(body)||!['search','propose','approve','correct','forget','confirm'].includes(body.action)||typeof body.business!=='boolean')throw Error('400:Choose a valid memory action and scope.');
 const {client,user}=await authenticate(request),scope=await agentScope(client,user.id,body);
 if(body.business&&!scope.workspace_id)throw Error('400:Select a business conversation or open a connected CRM workspace first.');
 if(!body.business&&scope.workspace_id)throw Error('409:Choose a personal conversation before managing personal memories.');
 if(body.action==='search'){
  if(body.include_expired!==undefined&&typeof body.include_expired!=='boolean')throw Error('400:Check the expiry filter.');
  const plan=brainPlan({action:'search',...(body.query!==undefined&&body.query!==''?{query:body.query}:{})});
  const records=await recallBrain(client,user.id,scope,plan.query,true,Date.now(),body.include_expired===true);
  let can_write=true;try{await checkBrainScope(client,user.id,scope,true);}catch(error){if(error instanceof Error&&error.message.startsWith('403:'))can_write=false;else throw error;}
  return Response.json({records,scope,can_write,limit:30},{headers:{'Cache-Control':'no-store'}});
 }
 if(body.action==='confirm'&&!body.review_id)throw Error('400:Choose a memory review.');
 const result=await runBrain({client,user:user.id,scope,app:'chat',...(body.action==='confirm'?{review_id:body.review_id}:{plan:brainPlan({...body,action:body.action})})});
 return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(error){return crmError(error);}};}
