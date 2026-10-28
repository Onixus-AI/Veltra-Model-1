export type SignalAction={type:'onixus.signal.action';id:string;client:string}&({action:'open';target:'mail'|'files'|'calendar'|'connections'}|{action:'signature';signature:string}|{action:'calendar';queue_id:string;title:string;scheduled_for:string;description:string}|{action:'google';kind:'doc'|'sheet';title:string;content:string});
const uuid=(x:unknown):x is string=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
export function signalAction(input:unknown):SignalAction|null{
 if(!input||typeof input!=='object')return null;const x=input as Record<string,unknown>;
 if(x.type!=='onixus.signal.action'||!uuid(x.id)||!uuid(x.client))return null;
 const base={type:'onixus.signal.action' as const,id:x.id,client:x.client};
 if(x.action==='open'&&['mail','files','calendar','connections'].includes(String(x.target)))return {...base,action:'open',target:x.target as 'mail'|'files'|'calendar'|'connections'};
 if(x.action==='signature'&&typeof x.signature==='string'&&x.signature.trim().length>0&&x.signature.length<=200)return {...base,action:x.action,signature:x.signature.trim()};
 if(x.action==='calendar'&&uuid(x.queue_id)&&typeof x.title==='string'&&x.title.trim()&&x.title.length<=200&&typeof x.description==='string'&&x.description.length<=7000&&typeof x.scheduled_for==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(x.scheduled_for)&&Number.isFinite(Date.parse(x.scheduled_for)))return {...base,action:'calendar',queue_id:x.queue_id,title:x.title,description:x.description,scheduled_for:new Date(x.scheduled_for).toISOString()};
 if(x.action==='google'&&['doc','sheet'].includes(String(x.kind))&&typeof x.title==='string'&&x.title.trim().length>0&&x.title.length<=200&&typeof x.content==='string'&&x.content.length<=200000)return {...base,action:x.action,kind:x.kind as 'doc'|'sheet',title:x.title.trim(),content:x.content};
 return null;
}
/** Existing Onixus administrator login and its original business have distinct IDs.
 * Only this verified workspace/account pair resolves to that existing brand. Other clients use their linked ID. */
export function signalBusinessClient(workspace:string,linkedClient:string){
 return workspace==='8350462c-2cca-4541-b299-acbc4c5f1162'&&linkedClient==='cf7fd56a-ef84-48f4-8049-36282dec583b'?'679cae69-806e-4691-9ef3-241a7ab86501':linkedClient;
}
