import Link from 'next/link';
import {notFound} from 'next/navigation';
import ToolLogo from '@/components/tool-logo';
import {platforms,isPlatformId} from '@/lib/business-os-platforms';
import '../../workspace.css';

export function generateStaticParams(){return Object.keys(platforms).map(id=>({id}));}

export default async function PlatformPage({params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!isPlatformId(id))notFound();
 const p=platforms[id],external=(href:string)=>/^(https?:|mailto:)/.test(href);
 const button=(a:{label:string;href:string},className:string)=>external(a.href)
  ?<a className={className} href={a.href} {...(a.href.startsWith('http')?{target:'_blank',rel:'noreferrer'}:{})}>{a.label}</a>
  :<Link className={className} href={a.href}>{a.label}</Link>;
 return <div className="workspace-tool-state platform-panel">
  <h2><ToolLogo name={p.logo}/> {p.name}</h2>
  <p>{p.tagline}</p>
  <p>{p.description}</p>
  <div className="actions">{button(p.action,'button')}{p.secondary&&button(p.secondary,'button secondary')}</div>
  <h3>First time?</h3>
  <ol>{p.steps.map(s=><li key={s}>{s}</li>)}</ol>
 </div>;
}
