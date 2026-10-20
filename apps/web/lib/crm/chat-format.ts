const clean=(v:unknown)=>String(v??'').replace(/[\r\n<>\[\]`*_\\|]/g,' ').slice(0,2000);
const actions:Record<string,string>={create_customer:'Add customer',create_task:'Add task',create_deal:'Add opportunity',propose_memory:'Propose customer memory',complete_task:'Complete task',update_stage:'Change opportunity stage',suppress:'Stop outreach to this customer',pause_campaign:'Pause campaign',activate_campaign:'Activate approved campaign delivery'};
function record(value:unknown):string{
 if(!value||typeof value!=='object')return clean(value);
 const row=value as Record<string,unknown>;
 const parts=['company','name','email','title','content','subject','body','stage','status','due_at','source','kind','created_at'].filter(key=>row[key]!==undefined&&row[key]!==null&&row[key]!=='').map(key=>`${key==='due_at'?'Due':key==='created_at'?'Recorded':key.replaceAll('_',' ')}: ${clean(row[key])}`);
 if(typeof row.value_cents==='number')parts.push(`Value: ${(row.value_cents/100).toFixed(2)} ${clean(row.currency??'USD')}`);
 if(row.suppressed===true)parts.push('Outreach stopped');
 return parts.join(' · ')||'Saved record';
}
export function formatCrmReply(result:{kind:string;reply:string;details?:unknown}):string{
 const details=result.details;if(!details)return result.reply;
 if(result.kind==='preview'&&typeof details==='object'){
  const d=details as Record<string,unknown>,lines=[actions[String(d.action)]??'Review CRM change'];
  for(const key of ['company','name','email','title','content','due_at','stage'])if(d[key])lines.push(`${key==='due_at'?'Due':key}: ${clean(d[key])}`);
  if(typeof d.value_cents==='number')lines.push(`Value: ${(d.value_cents/100).toFixed(2)} ${clean(d.currency??'USD')}`);
  if(d.before)lines.push('Current record: '+record(d.before));
  return result.reply+'\n\n'+lines.join('\n');
 }
 if(Array.isArray(details))return result.reply+'\n\n'+(details.length?details.slice(0,25).map(record).join('\n\n')+(details.length>25?`\n\nShowing 25 of ${details.length} returned records.`:''):'No matching records.');
 if(typeof details==='object'){
  const d=details as Record<string,unknown>,groups=Object.entries(d).filter(([,value])=>Array.isArray(value));
  if(groups.length)return result.reply+'\n\n'+groups.map(([name,value])=>name+':\n'+((value as unknown[]).slice(0,15).map(record).join('\n')||'None recorded.')+((value as unknown[]).length>15?'\nMore records are available.':'')).join('\n\n');
  return result.reply+'\n\n'+record(d);
 }
 return result.reply;
}
