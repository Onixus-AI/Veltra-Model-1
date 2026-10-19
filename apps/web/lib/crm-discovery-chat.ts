import type {SupabaseClient} from '@supabase/supabase-js';
export type DiscoveryIntent={action:'list'}|{action:'start';provider:'fmcsa'|'ny_registry'|'all'}|{action:'control';id:string;enabled:boolean};
export function discoveryIntent(text:string):DiscoveryIntent|null{
 const value=text.trim();if(value.length>250)return null;
 if(/^(?:please )?(?:show|list|check) (?:my |our )?(?:crm )?discovery (?:sources|progress|status)[.!?]?$/i.test(value))return {action:'list'};
 const start=/^(?:please )?(?:start|enable) (?:recurring |continuous )?(?:company |business |crm )?discovery(?: from)? (fmcsa|new york|all sources)[.!]?$/i.exec(value);
 if(start)return {action:'start',provider:start[1].toLowerCase()==='fmcsa'?'fmcsa':start[1].toLowerCase()==='new york'?'ny_registry':'all'};
 const control=/^(?:please )?(pause|resume) discovery ([a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})[.!]?$/i.exec(value);
 return control?{action:'control',id:control[2],enabled:control[1].toLowerCase()==='resume'}:null;
}
export async function executeDiscoveryIntent(client:SupabaseClient,user:string,workspace:string,intent:DiscoveryIntent){
 if(intent.action==='list'){
  const {data,error}=await client.from('crm_discovery_sources').select('id,label,enabled,imported,duplicates,last_error,exhausted_at,next_run_at').eq('workspace_id',workspace).order('created_at',{ascending:false}).limit(100);
  if(error)throw Error('503:Continuous discovery is not available in this CRM workspace yet.');
  return 'CRM discovery sources\n\n'+(data?.length?data.map(s=>'- '+s.label+': '+(s.enabled?(s.exhausted_at?'caught up; checks for new companies daily':'enabled'):'paused')+'; '+s.imported+' companies added, '+s.duplicates+' known records skipped. Source ID: '+s.id+(s.last_error?' · Last attempt needs retry.':'')).join('\n'):'No sources are configured. Try “Start company discovery from FMCSA” or “Start company discovery from New York”.')+'\n\nThese are discovery receipts, not campaign sends.';
 }
 const {data:owner,error:ownerError}=await client.from('crm_workspaces').select('id').eq('id',workspace).eq('owner_id',user).maybeSingle();
 if(ownerError||!owner)throw Error('403:Only this business owner can start or pause continuous discovery.');
 if(intent.action==='control'){
  const {data,error}=await client.from('crm_discovery_sources').update({enabled:intent.enabled}).eq('workspace_id',workspace).eq('id',intent.id).select('id,label,enabled').maybeSingle();
  if(error)throw Error('503:Discovery could not be changed.');if(!data)throw Error('404:Discovery source not found in this business.');
  return 'CRM discovery '+(data.enabled?'resumed':'paused')+': '+data.label+'.\nSource ID: '+data.id+'\nNo campaign was sent.';
 }
 const providers=intent.provider==='all'?['fmcsa','ny_registry']:[intent.provider],receipts=[];
 for(const provider of providers){
  let {data:source,error}=await client.from('crm_discovery_sources').select('id,label').eq('workspace_id',workspace).eq('provider',provider).is('bounds',null).eq('category','logistics').maybeSingle();
  if(error)throw Error('503:Continuous discovery is not available in this CRM workspace yet.');
  if(!source){
   const created=await client.from('crm_discovery_sources').insert({workspace_id:workspace,provider,category:'logistics',label:provider==='fmcsa'?'FMCSA transport companies':'New York business registry',bounds:null}).select('id,label').single();
   if(created.error)throw Error('503:Discovery source could not be saved. Check Sources before retrying.');source=created.data;
  }
  const {data:enabled,error:enableError}=await client.from('crm_discovery_sources').update({enabled:true}).eq('workspace_id',workspace).eq('id',source!.id).select('id').single();
  if(enableError||!enabled)throw Error('503:The source was saved but could not be enabled. Open CRM Sources to resume it.');
  receipts.push(source!.label+' · source '+source!.id);
 }
 return 'Recurring company discovery enabled:\n'+receipts.map(r=>'- '+r).join('\n')+'\n\nThe scheduled worker will import source-backed company records and report progress. New identities require review before campaign enrollment. This receipt confirms the schedule setting, not completed imports. No campaign was sent.';
}
