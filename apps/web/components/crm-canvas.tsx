'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {crmConnection} from '@/lib/crm-connection';
export default function CrmCanvas(){
 const [connected,setConnected]=useState<boolean|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;void crmConnection().then(s=>{if(active)setConnected(s.connected);}).catch(()=>{if(active)setError('CRM could not be opened. Check your connection and try again.');});return()=>{active=false;};},[]);
 if(error||connected===false)return <div className="workspace-tool-state"><h2>Veltra CRM</h2><p>{error||'Connect Veltra CRM to bring customers, pipelines and tasks into your workspace.'}</p><Link href="/settings/connections?tool=crm">Manage CRM connection</Link></div>;
 if(connected===null)return <div className="workspace-tool-state" role="status">Opening Veltra CRM…</div>;
 const source=new URLSearchParams({embedded:'1'});const query=new URLSearchParams(window.location.search);for(const key of ['workspace','customer'])if(query.get(key))source.set(key,query.get(key)!);
 return <><Link className="crm-open-full" href={'/crm?'+source} target="_blank" rel="noreferrer">Open CRM in a full window ↗</Link><iframe className="crm-workspace-frame" title="Veltra CRM workspace" src={'/crm?'+source}/></>;
}
