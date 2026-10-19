'use client';
import {useEffect,useState} from 'react';
import {gatewayAuthorizationHeaders} from '@/lib/client-session';
type Outcome={status:string;reason:string;reason_source:string;evidence:string;source_message_id:string|null;updated_at:string};
type Row={thread_id:string;subject:string;quote_outcome:Outcome};
export default function QuoteOutcomes({workspace}:{workspace:string}){
 const [items,setItems]=useState<Row[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[version,setVersion]=useState(0);
 useEffect(()=>{let active=true;setLoading(true);setItems([]);setError('');void(async()=>{
  try{const r=await fetch('/api/crm/quote-outcomes?workspace='+encodeURIComponent(workspace),{headers:await gatewayAuthorizationHeaders(),cache:'no-store'}),data=await r.json();if(!r.ok)throw new Error(data.error||'Quote outcomes could not load.');if(active)setItems(data.items);}
  catch(e){if(active)setError(e instanceof Error?e.message:'Quote outcomes could not load.');}finally{if(active)setLoading(false);}
 })();return()=>{active=false;};},[workspace,version]);
 return <section className="crm-panel"><h2>Quote outcomes & customer feedback</h2><p>Latest 50 synced Mail quote threads. Silence stays unknown. Customer statements and owner assessments are separate.</p><button disabled={loading} onClick={()=>setVersion(v=>v+1)}>Refresh quote outcomes</button>{loading&&<p role="status">Loading quote outcomes…</p>}{error&&<p role="alert">{error}</p>}{!loading&&!error&&!items.length&&<p>No synced quote outcomes yet. Connect Mail above and review outcomes in Mail.</p>}{items.map(row=><article className="crm-row" key={row.thread_id}><div><strong>{row.subject}</strong><p>{row.quote_outcome.status} · {row.quote_outcome.reason} · {row.quote_outcome.reason_source}</p>{row.quote_outcome.evidence&&<blockquote>{row.quote_outcome.evidence}</blockquote>}<small>{new Date(row.quote_outcome.updated_at).toLocaleString()}</small></div></article>)}</section>;
}
