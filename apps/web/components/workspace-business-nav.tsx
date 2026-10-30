'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {LayoutDashboard,Users,MessageSquare,Contact,Mail,Radio,CalendarDays,FolderOpen,Plug,Settings,PanelLeftClose,PanelLeftOpen} from 'lucide-react';
import './workspace-business-nav.css';
export default function BusinessNavigation({workspace,current}:{workspace:string;current:'overview'|'team'}){
 const [collapsed,setCollapsed]=useState(true);
 useEffect(()=>{try{const saved=localStorage.getItem('onixus-business-nav-collapsed');setCollapsed(saved===null?window.matchMedia('(max-width:760px)').matches:saved==='true');}catch{}},[]);
 const suffix=workspace?'?workspace='+encodeURIComponent(workspace):'',context=workspace?'&crm_workspace='+encodeURIComponent(workspace):'';
 const items=[
  {key:'overview',name:'Business Overview',href:'/workspace'+suffix,icon:LayoutDashboard},
  {key:'team',name:'Business Team',href:'/workspace/team'+suffix,icon:Users},
  {key:'chat',name:'Ask Onyx',href:'/?view=chat&mode=business'+context,icon:MessageSquare},
  {key:'crm',name:'CRM',href:'/crm?view=Customers'+(workspace?'&workspace='+encodeURIComponent(workspace):''),icon:Contact},
  {key:'mail',name:'Mail',href:'/?canvas=mail&mode=business'+context,icon:Mail},
  {key:'signal',name:'Signal',href:'/?canvas=signal&mode=business'+context,icon:Radio},
  {key:'calendar',name:'Calendar',href:'/?canvas=calendar&mode=business'+context,icon:CalendarDays},
  {key:'files',name:'Files',href:'/workspace/files',icon:FolderOpen},
  {key:'connections',name:'Connections',href:'/settings/connections?mode=business',icon:Plug},
  {key:'settings',name:'Settings',href:'/settings',icon:Settings},
 ];
 function toggle(){setCollapsed(value=>{const next=!value;try{localStorage.setItem('onixus-business-nav-collapsed',String(next));}catch{}return next;});}
 return <nav className="business-navigation" data-collapsed={collapsed} aria-label="Account"><Link href={'/workspace'+suffix} className="business-navigation-brand" aria-label="Onixus Workspace"><img src="/veltra-logo.png" alt=""/><span>Onixus<small>Workspace</small></span></Link><button className="business-navigation-toggle" onClick={toggle} aria-expanded={!collapsed} aria-controls="business-navigation-links" aria-label={collapsed?'Expand navigation':'Collapse navigation'}>{collapsed?<PanelLeftOpen size={19}/>:<PanelLeftClose size={19}/>}</button><div id="business-navigation-links">{items.map(({key,name,href,icon:Icon})=><Link key={key} href={href} title={name} aria-label={name} aria-current={current===key?'page':undefined}><Icon size={19}/><span>{name}</span></Link>)}</div></nav>;
}
