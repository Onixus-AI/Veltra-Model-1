const clean=(v:unknown)=>String(v??'').replace(/[\r\n<>\[\]`*_\\|]/g,' ').slice(0,5000);
const actions:Record<string,string>={brain_propose:'Propose shared memory',brain_approve:'Approve shared memory for recall',brain_correct:'Correct shared memory and request approval again',brain_forget:'Forget saved memory',create_customer:'Add customer',create_task:'Add task',create_deal:'Add opportunity',propose_memory:'Propose customer memory',complete_task:'Complete task',update_stage:'Change opportunity stage',suppress:'Stop outreach to this customer',pause_campaign:'Pause campaign',activate_campaign:'Activate approved campaign delivery'};
function record(value:unknown):string{
 if(!value||typeof value!=='object')return clean(value);
 const row=value as Record<string,unknown>;
 const parts=['company','name','email','title','content','subject','body','stage','status','due_at','source','kind','provider_id','sent_at','last_error','customer_id','source_app','source_ref','revision','expires_at','created_at'].filter(key=>row[key]!==undefined&&row[key]!==null&&row[key]!=='').map(key=>`${key==='due_at'?'Due':key==='created_at'?'Recorded':key.replaceAll('_',' ')}: ${clean(row[key])}`);
 if(row.id)parts.unshift((row.source_app?'Memory ID: ':'Record ID: ')+clean(row.id));
 if(typeof row.value_cents==='number')parts.push(`Value: ${(row.value_cents/100).toFixed(2)} ${clean(row.currency??'USD')}`);
 if(row.suppressed===true)parts.push('Outreach stopped');
 if(row.delivery&&typeof row.delivery==='object'){const d=row.delivery as Record<string,unknown>;parts.push(`Delivery state: ${clean(d.reason)}${d.window_opens_at?' · Next schedule window: '+clean(d.window_opens_at):''}${d.note?' · '+clean(d.note):''}`);}
 return parts.join(' · ')||'Saved record';
}
export function formatCrmReply(result:{kind:string;reply:string;details?:unknown;observed_at?:string}):string{
 const reply=result.reply+(result.observed_at?'\nObserved: '+clean(result.observed_at):'');const details=result.details;if(!details)return reply;
 if(result.kind==='preview'&&typeof details==='object'){
  const d=details as Record<string,unknown>,lines=[actions[String(d.action)]??'Review CRM change'];
  for(const key of ['company','name','email','title','content','kind','source','scope','expires_at','due_at','stage'])if(d[key])lines.push(`${key==='due_at'?'Due':key}: ${clean(d[key])}`);
  if(typeof d.value_cents==='number')lines.push(`Value: ${(d.value_cents/100).toFixed(2)} ${clean(d.currency??'USD')}`);
  if(d.before)lines.push('Current record: '+record(d.before));
  return reply+'\n\n'+lines.join('\n');
 }
 if(Array.isArray(details))return reply+'\n\n'+(details.length?details.slice(0,25).map(record).join('\n\n')+(details.length>25?`\n\nShowing 25 of ${details.length} returned records.`:''):'No matching records.');
 if(typeof details==='object'){
  const d=details as Record<string,unknown>,groups=Object.entries(d).filter(([,value])=>Array.isArray(value));
  if(groups.length){const worker=d.worker as Record<string,unknown>|undefined,daily=d.daily as Record<string,unknown>|undefined;const health=worker?`\n\nWorker checked: ${clean(worker.last_checked_at)}; successful pass: ${clean(worker.last_success_at)}; error: ${clean(worker.last_error??'none')}. Provider-accepted total: ${clean(daily?.provider_accepted_total??'unavailable')}; approved and due: ${clean(daily?.approved_due??'unavailable')}. Approval is not delivery.`:'';return reply+health+'\n\n'+groups.map(([name,value])=>name+':\n'+((value as unknown[]).slice(0,15).map(record).join('\n')||'None recorded.')+((value as unknown[]).length>15?'\nMore records are available.':'')).join('\n\n');}
  return reply+'\n\n'+record(d);
 }
 return reply;
}
