export const businessTeam = [
 {id:'onyx',name:'Onyx',role:'Build · Repair & improvement',engine:'Onixus',description:'Owns system health, repairs, quality, new capabilities and the verified improvement loop.'},
 {id:'onixa',name:'Onixa',role:'Grow · Sales & marketing',engine:'Signal / CRM / Jev decision support',description:'Owns sales acquisition, email campaigns, Signal, outreach and community growth.'},
 {id:'onixelia',name:'Onixelia',role:'Automate · Workflows & delivery',engine:'Hermes',description:'Owns workflows, schedules, handoffs and keeping permitted work moving to completion.'},
] as const;
export type TeamMember = typeof businessTeam[number]['id'];
export function memberName(id:unknown):string{return businessTeam.find(m=>m.id===id)?.name??'Unassigned';}
export const pilotScope='internal_daily_plan';
export const pilotLimits={maxTasks:8,maxSnapshotBytes:16000,maxOutputBytes:20000,maxRunSeconds:40};
export type PilotTask={title:string;owner:TeamMember;reason:string;source:string};
export function validatePlan(value:unknown):PilotTask[]{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid plan');
 const tasks=(value as {tasks?:unknown}).tasks;
 if(!Array.isArray(tasks)||tasks.length>pilotLimits.maxTasks)throw Error('Plan needs at most eight tasks');
 return tasks.map(raw=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid task');const t=raw as Record<string,unknown>;
  for(const key of ['title','reason','source'])if(typeof t[key]!=='string'||!t[key].trim()||(t[key] as string).length>(key==='reason'?600:250))throw Error('Invalid task '+key);
  if(!businessTeam.some(m=>m.id===t.owner))throw Error('Unknown team member');
  return {title:(t.title as string).trim(),owner:t.owner as TeamMember,reason:(t.reason as string).trim(),source:(t.source as string).trim()};
 });
}
export function teamRuntime(){return {hermes:process.env.ONIXELIA_URL&&process.env.ONIXELIA_TOKEN&&process.env.ONIXELIA_TOKEN.length>=32?'configured':'not_connected',scope:pilotScope,recurring:false};}
export const businessTeamPolicy='\nWhen discussing the Onixus business team, use Build. Grow. Automate. '+businessTeam.map(member=>member.name+' owns '+member.role+': '+member.description).join(' ')+' Onyx remains the interactive assistant and can route reviewed requests across the tools. Responsibility ownership does not mean a worker is connected, a daily job is scheduled, or an action has executed. Check current capabilities and actual actor receipts before claiming named-agent execution. Preserve all existing business permissions, exact-action reviews, publishing policies and spending limits. Jev is decision support, not proof that an agent executed a job. Repairs and reusable learning belong to Onyx; do not silently modify production, train shared models or share private client data.\n';
