'use client';
import type {CSSProperties} from 'react';
import {ChevronRight} from 'lucide-react';
import {stages,type Snapshot,type Stage} from '@/lib/crm/domain';
export type PipelineFilter='all'|Stage;
const labels:Record<Stage,string>={new:'New',qualified:'Qualified',meeting:'Meeting',proposal:'Proposal',won:'Won',lost:'Lost'};
const accents:Record<Stage,string>={new:'#00e5ef',qualified:'#be80ff',meeting:'#f5ff3d',proposal:'#ff4bda',won:'#baff32',lost:'#ff8a1f'};
function money(cents:number,currency:string){try{return new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:0}).format(cents/100)+' '+currency;}catch{return (cents/100).toLocaleString('en-US')+' '+currency;}}
export default function PipelineBoard({data,filter,onFilter,onCustomer}:{data:Snapshot;filter:PipelineFilter;onFilter:(value:PipelineFilter)=>void;onCustomer:(id:string)=>void}){
 const visible=stages.filter(stage=>filter==='all'||stage===filter);
 return <section className="crm-pipeline" aria-label="Opportunity pipeline"><div className="crm-pipeline-toolbar"><p>{data.deals.length} {data.deals.length===1?'opportunity':'opportunities'} · Values remain in their recorded currency.</p><label>Pipeline stage<select aria-label="Pipeline stage" value={filter} onChange={event=>onFilter(event.target.value as PipelineFilter)}><option value="all">All stages</option>{stages.map(stage=><option key={stage} value={stage}>{labels[stage]}</option>)}</select></label></div><div className="crm-pipeline-grid">{visible.map(stage=>{
 const deals=data.deals.filter(deal=>deal.stage===stage),totals=new Map<string,number>();for(const deal of deals)totals.set(deal.currency,(totals.get(deal.currency)??0)+deal.value_cents);
 return <section className="crm-pipeline-stage" key={stage} style={{'--stage-accent':accents[stage]} as CSSProperties} aria-label={`${labels[stage]} stage`}><header><h2>{labels[stage]}</h2><span>{deals.length}</span></header>{deals.length>0&&<p className="crm-stage-value">{[...totals].map(([currency,value])=><span key={currency}>{money(value,currency)}</span>)}</p>}{deals.map(deal=>{
 const customer=data.customers.find(c=>c.id===deal.customer_id);
 return <button className="crm-pipeline-deal" key={deal.id} data-crm-record={`deal:${deal.id}`} disabled={!customer} onClick={()=>onCustomer(deal.customer_id)} aria-label={`Open ${deal.title} for ${customer?.company||'unavailable customer'}`}><span><small>{customer?.company||'Customer unavailable'}</small><b>{deal.title}</b><span>{money(deal.value_cents,deal.currency)}</span><small>View customer and opportunity</small></span><ChevronRight size={17}/></button>;
 })}{!deals.length&&<p className="crm-pipeline-empty">No opportunities in {labels[stage].toLowerCase()}.</p>}</section>;
 })}</div></section>;
}
