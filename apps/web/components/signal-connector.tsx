'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {workspaceHref} from '@/lib/workspace-navigation';
import ToolLogo from '@/components/tool-logo';
import {gatewayAuthorizationHeaders} from '@/lib/client-session';
export default function SignalConnector({business}:{business:string}){
 const [state,setState]=useState<'checking'|'linked'|'available'|'unavailable'>('checking');
 useEffect(()=>{const controller=new AbortController();let active=true;void(async()=>{try{const r=await fetch('/api/workspace/signal',{headers:await gatewayAuthorizationHeaders(),cache:'no-store',signal:controller.signal});const d=await r.json();if(!r.ok||!Array.isArray(d.connections))throw Error();if(active)setState(d.connections.some((connection:{workspace_id:string})=>connection.workspace_id===business)?'linked':'available');}catch{if(active)setState('unavailable');}})();return()=>{active=false;controller.abort();};},[business]);
 return <article className="hub-card"><div className="hub-card-top"><ToolLogo name="Signal"/><span className={'hub-status '+(state==='linked'?'live':'')}>{state==='linked'?'Business linked':state==='checking'?'Checking…':state==='unavailable'?'Status unavailable':'Available'}</span></div><h3>Signal</h3><p>Your linked marketing business, inside Onixus Workspace.</p><Link className="hub-card-button" href={state==='linked'?workspaceHref('signal',business):'/crm?view=Connections'+(business?'&workspace='+encodeURIComponent(business):'')}>{state==='linked'?'Open Signal':'Connect Signal'}</Link><Link href={'/crm?view=Connections'+(business?'&workspace='+encodeURIComponent(business):'')}>Connection settings</Link></article>;
}
