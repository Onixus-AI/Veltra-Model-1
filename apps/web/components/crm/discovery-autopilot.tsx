'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {db} from '@/lib/crm/client';
import {categories,registries,type Category} from '@/lib/crm/discovery-source';
const regions={
 'Hampton Roads, Virginia':[36.55,-76.8,37.2,-75.9],
 'Richmond, Virginia':[37.2,-77.9,37.85,-77.1],
 'Charlotte, North Carolina':[34.9,-81.2,35.6,-80.4],
 'Northern New Jersey':[40.4,-74.6,41,-73.9],
 'Custom service area':null
} as const;
type Source={id:string;provider:string;label:string;category:string;enabled:boolean;phase:number;imported:number;duplicates:number;enriched:number;last_error:string|null;last_run_at:string|null;exhausted_at:string|null;next_run_at:string};
export default function DiscoveryAutopilot({workspace,preview}:{workspace:string;preview:boolean}){
 const [enrichEnabled,setEnrichEnabled]=useState(false);
 const [sources,setSources]=useState<Source[]>([]),[provider,setProvider]=useState('fmcsa'),[region,setRegion]=useState<keyof typeof regions>('Hampton Roads, Virginia'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){if(!db||preview)return;const {data,error}=await db.from('crm_discovery_sources').select('id,provider,label,category,enabled,phase,imported,duplicates,enriched,last_error,last_run_at,exhausted_at,next_run_at').eq('workspace_id',workspace).order('created_at',{ascending:false}).limit(100);if(error)throw Error(error.message);setSources(data??[]);const settings=await db.from('crm_enrichment_settings').select('enabled').eq('workspace_id',workspace).maybeSingle();if(settings.error)throw Error(settings.error.message);setEnrichEnabled(settings.data?.enabled===true);}
 useEffect(()=>{setSources([]);setError('');let live=true;const refresh=()=>{if(live)void load().catch(e=>{if(live)setError(e.message);});};refresh();const timer=setInterval(refresh,30000);return()=>{live=false;clearInterval(timer);};},[workspace,preview]);
 async function toggle(source:Source){if(!db)return;setBusy(true);setError('');try{const {error}=await db.from('crm_discovery_sources').update({enabled:!source.enabled}).eq('id',source.id).eq('workspace_id',workspace).select('id').single();if(error)throw error;await load();}catch(e){setError(e instanceof Error?e.message:'Source could not be changed.');}finally{setBusy(false);}}
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!db||preview)return;const form=e.currentTarget,f=new FormData(form);setBusy(true);setError('');try{
  const bounds=provider==='openstreetmap'?(regions[region]??['south','west','north','east'].map(key=>Number(f.get(key)))):null;
  const {checkedBounds}=await import('@/lib/crm/discovery-source');if(provider==='openstreetmap')checkedBounds(bounds);
  const category=provider==='openstreetmap'?String(f.get('category')) as Category:'logistics';
  const {data,error}=await db.from('crm_discovery_sources').insert({workspace_id:workspace,provider,category,label:provider==='openstreetmap'?(region==='Custom service area'?String(f.get('label')??'Custom service area'):region):registries[provider as keyof typeof registries].name,bounds}).select('id').single();if(error)throw error;
  const {error:startError}=await db.from('crm_discovery_sources').update({enabled:true}).eq('id',data.id).select('id').single();if(startError)throw startError;
  await load();
 }catch(e){setError(e instanceof Error?e.message:'Discovery could not be started.');}finally{setBusy(false);}}
 return <section className="crm-panel"><h2>Continuous business discovery</h2>
 <p>Find companies in your service area using free public company registries and open-map data. Sources run in pages, resume after interruptions, skip known records and check for new companies daily after catching up. Public-source availability and shared rate limits affect timing.</p>
 <p>New companies keep their source evidence and need identity review before campaign enrollment. Discovery does not send email.</p>
 <label className="crm-check"><input type="checkbox" checked={enrichEnabled} disabled={busy||preview} onChange={e=>{const enabled=e.target.checked;setBusy(true);void db?.rpc('crm_set_contact_enrichment',{p_workspace:workspace,p_enabled:enabled}).then(({error})=>{if(error)setError('Only the owner can change scheduled enrichment.');else setEnrichEnabled(enabled);setBusy(false);});}}/>Research missing business contacts from recorded company websites automatically</label><p>Up to 30 website jobs per shared day. Websites without published inboxes are checked again after a day. Turning this off stops new automatic jobs; already queued requests can finish.</p>
 <form onSubmit={submit}><label>Source<select value={provider} onChange={e=>setProvider(e.target.value)}><option value="fmcsa">FMCSA transport companies · United States</option><option value="fmcsa_contacts">FMCSA published organizational inboxes · United States</option><option value="ny_registry">New York business registry · All industries</option><option value="openstreetmap">OpenStreetMap · Local businesses</option></select></label>{provider!=='openstreetmap'&&<p>Import company identities from the official registry. Registration does not establish current authority, a contact address or permission to send a campaign.</p>}{provider==='openstreetmap'&&<><label>Businesses<select name="category">{Object.keys(categories).map(c=><option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}</select></label>
 <label>Service area<select value={region} onChange={e=>setRegion(e.target.value as keyof typeof regions)}>{Object.keys(regions).map(r=><option key={r}>{r}</option>)}</select></label>
 {region==='Custom service area'&&<><label>Area name<input name="label" required maxLength={160}/></label><p>Enter the boundaries of your service area, up to two degrees wide. These are area boundaries, not customer addresses.</p>{['south','west','north','east'].map(c=><label key={c}>{c}<input name={c} required type="number" step="any" min={c==='south'||c==='north'?-85:-180} max={c==='south'||c==='north'?85:180}/></label>)}</>}
 </>}<button disabled={busy||preview||!db}>Start recurring discovery</button></form>
 {error&&<p role="alert">{error}</p>}
 {sources.map(s=><article className="crm-panel" key={s.id}><h3>{s.label} · {s.category}</h3><p>{s.exhausted_at?'Caught up · checking for new companies daily':s.enabled?'Running on schedule':'Paused'} · {s.imported} companies added · {s.duplicates} known records revisited · {s.enriched} missing contacts added</p>
 {s.last_run_at&&<p>Last checked: {new Date(s.last_run_at).toLocaleString()}</p>}{s.last_error&&<p role="alert">{s.last_error} The current page will be retried.</p>}
 {!s.exhausted_at&&<button disabled={busy||preview} onClick={()=>void toggle(s)}>{s.enabled?'Pause discovery':'Resume discovery'}</button>}</article>)}
 <p>Sources: <a href="https://data.transportation.gov/Trucking-and-Motorcoaches/Company-Census-File/az4n-8mr2" target="_blank" rel="noreferrer">FMCSA</a>, <a href="https://data.ny.gov/Economic-Development/Active-Corporations-Beginning-1800/n9v6-gdp6" target="_blank" rel="noreferrer">New York Department of State</a>, <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL</a>. Public business details may be incomplete or outdated.</p></section>;
}
