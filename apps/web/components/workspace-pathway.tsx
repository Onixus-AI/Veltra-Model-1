'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {gatewayAuthorizationHeaders} from '@/lib/client-session';
import {useWorkspaceBusiness,rememberBusiness} from '@/lib/workspace-business';
import {useWorkspaceSettings} from './workspace-settings-provider';
import {clientPathways,pathwayHref,pathwaySteps,type ClientPathway} from '@/lib/workspace-pathways';
type Business={id:string;name:string};
export default function WorkspacePathway({pathway}:{pathway:ClientPathway}){
 const {userId,ready}=useWorkspaceSettings();
 return <PathwayContent key={userId} pathway={pathway} userId={userId} ready={ready}/>;
}
function PathwayContent({pathway,userId,ready}:{pathway:ClientPathway;userId:string;ready:boolean}){
 const requested=useWorkspaceBusiness();
 const [businesses,setBusinesses]=useState<Business[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  let live=true;const controller=new AbortController();setLoading(true);setBusinesses([]);setError('');
  if(!userId){setLoading(!ready);return()=>controller.abort();}
  void gatewayAuthorizationHeaders().then(headers=>fetch('/api/crm/workspaces',{headers,cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])})).then(async response=>{
   if(!response.ok)throw Error('Your businesses could not load. Try again.');
   const data=await response.json();if(!Array.isArray(data.workspaces))throw Error('Your businesses could not load. Try again.');
   if(live)setBusinesses(data.workspaces);
  }).catch(()=>{if(live)setError('Your businesses could not load. Try again.');}).finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;controller.abort();};
 },[userId,ready,retry]);
 const business=businesses.find(item=>item.id===requested),details=clientPathways[pathway],other=pathway==='build'?'growth':'build';
 const available=!loading&&!error&&!!business;
 return <main className="suite-home workspace-pathway">
  <nav aria-label="Client pathway" className="workspace-pathway-tabs">{(['build','growth'] as const).map(value=><Link key={value} aria-current={value===pathway?'page':undefined} href={pathwayHref(value,business?.id??'')}>{value==='build'?'Build':'Growth'}</Link>)}</nav>
  <section className="suite-intro"><div><h1>{details.title}</h1><p>{details.description}</p></div>
   <label className="suite-business">Working in<select aria-label="Business workspace" disabled={loading||!!error||!businesses.length} value={business?.id??''} onChange={event=>rememberBusiness(event.target.value)}><option value="">{loading?'Loading businesses…':'Choose a business'}</option>{businesses.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
  </section>
  {error?<section role="alert" className="suite-empty"><p>{error}</p><button type="button" onClick={()=>setRetry(value=>value+1)}>Try again</button></section>:!available?<section className="suite-empty"><h2>{loading?'Loading your businesses…':'Choose a business to continue'}</h2><p>{loading?'Checking the businesses available to your account.':businesses.length?'Select the business you want to work on above.':'Open CRM to create or join your business workspace.'}</p>{!loading&&!businesses.length&&<Link href="/crm">Open CRM</Link>}</section>:<>
   <ol className="workspace-pathway-steps">{pathwaySteps(pathway,business.id).map(step=><li key={step.title}><div><h2>{step.title}</h2><p>{step.description}</p></div><Link href={step.href}>Open {step.label}</Link></li>)}</ol>
   <section className="workspace-pathway-transition"><h2>{pathway==='build'?'Ready to work on growth?':'Need to finish your foundation?'}</h2><p>{pathway==='build'?'Before starting campaigns, confirm your website can receive inquiries and your team can record and follow up with them.':'If customers cannot find your business or contact you directly, start with Build and return here when that foundation is in place.'}</p><Link href={pathwayHref(other,business.id)}>{pathway==='build'?'Continue to Growth':'Open Build'}</Link></section>
  </>}
 </main>;
}
