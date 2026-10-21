"use client";
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {crmConnection} from '@/lib/crm-connection';
import {readCrmContext,type CrmHostScope} from '@/lib/crm/host-context';
export default function CrmCanvas({disabled=false,onContextChange,navigation}:{disabled?:boolean;navigation?:{workspace:string;view:string;revision:number};onContextChange:(scope:CrmHostScope)=>void}){
 const [connected,setConnected]=useState<boolean|null>(null),[error,setError]=useState('');const frame=useRef<HTMLIFrameElement>(null);
 useEffect(()=>{let active=true;void crmConnection().then(s=>{if(active)setConnected(s.connected);}).catch(()=>{if(active)setError('CRM could not be opened. Check your connection and try again.');});return()=>{active=false;};},[]);
 useEffect(()=>{const listener=(event:MessageEvent)=>{if(disabled||event.origin!==window.location.origin||event.source!==frame.current?.contentWindow)return;const scope=readCrmContext(event.data);if(scope){onContextChange(scope);window.dispatchEvent(new CustomEvent('veltra-crm-context',{detail:scope}));}};const refresh=()=>frame.current?.contentWindow?.postMessage({type:'veltra:crm-refresh'},window.location.origin);window.addEventListener('message',listener);window.addEventListener('veltra-crm-changed',refresh);return()=>{window.removeEventListener('message',listener);window.removeEventListener('veltra-crm-changed',refresh);};},[disabled,onContextChange]);
 if(error||connected===false)return <div className="workspace-tool-state"><h2>Veltra CRM</h2><p>{error||'Connect Veltra CRM to bring customers, pipelines and tasks into your workspace.'}</p><Link href="/settings/connections?tool=crm">Manage CRM connection</Link></div>;
 if(connected===null)return <div className="workspace-tool-state" role="status">Opening Veltra CRM…</div>;
 const standalone=new URLSearchParams(),query=new URLSearchParams(window.location.search);for(const key of ['workspace','customer'])if(query.get(key))standalone.set(key,query.get(key)!);
 if(navigation){standalone.delete('customer');if(navigation.workspace)standalone.set('workspace',navigation.workspace);standalone.set('view',navigation.view);standalone.set('view_request',String(navigation.revision));}
 const embedded=new URLSearchParams(standalone);embedded.set('embedded','1');
 return <><Link className="crm-open-full" href={'/crm?'+standalone} target="_blank" rel="noreferrer">Open standalone CRM ↗</Link><div inert={disabled} style={{height:'100%'}}><iframe ref={frame} className="crm-workspace-frame" title="Veltra CRM workspace" src={'/crm?'+embedded}/></div></>;
}
