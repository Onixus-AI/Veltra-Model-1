'use client';
import {Mail,Users,ShoppingBag,ArrowUpRight} from 'lucide-react';
import ToolLogo from '@/components/tool-logo';
import OperationsCenter from '@/components/crm/operations-center';
export default function BusinessOsCanvas({workspace,onOpen,onNavigate}:{workspace:string;onOpen:(tool:'mail'|'crm'|'tms'|'shopify')=>void;onNavigate:(view:string)=>void}){
 return <div className="business-os-canvas"><header><span>ONIXUS BUSINESS OS</span><h2>Your business, together.</h2><p>Open a tool or review the activity for your selected business.</p></header><nav aria-label="Business OS tools">{([{id:'mail',label:'Onixus Mail',icon:Mail},{id:'crm',label:'Onixus CRM',icon:Users},{id:'tms',label:'Onixus TMS',icon:Users},{id:'shopify',label:'Shopify',icon:ShoppingBag}] as const).map(({id,label,icon:Icon})=><button key={id} onClick={()=>onOpen(id)}><>{id === "tms" ? <ToolLogo name="Onixus TMS"/> : <Icon size={20}/>}</><span>{label}</span><ArrowUpRight size={15}/></button>)}</nav><OperationsCenter workspace={workspace} onNavigate={onNavigate}/></div>;
}
