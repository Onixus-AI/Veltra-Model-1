'use client';
import {Mail,Users,Truck,ShoppingBag,ArrowUpRight} from 'lucide-react';
import OperationsCenter from '@/components/crm/operations-center';
export default function BusinessOsCanvas({workspace,onOpen,onNavigate}:{workspace:string;onOpen:(tool:'mail'|'crm'|'tms'|'shopify')=>void;onNavigate:(view:string)=>void}){
 return <div className="business-os-canvas"><header><span>VELTRA BUSINESS OS</span><h2>Your business, together.</h2><p>Open a tool or review the activity for your selected business.</p></header><nav aria-label="Business OS tools">{([{id:'mail',label:'Veltra Mail',icon:Mail},{id:'crm',label:'Veltra CRM',icon:Users},{id:'tms',label:'Onixus TMS',icon:Truck},{id:'shopify',label:'Shopify',icon:ShoppingBag}] as const).map(({id,label,icon:Icon})=><button key={id} onClick={()=>onOpen(id)}><Icon size={20}/><span>{label}</span><ArrowUpRight size={15}/></button>)}</nav><OperationsCenter workspace={workspace} onNavigate={onNavigate}/></div>;
}
