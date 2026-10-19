import {request} from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {publishedBusinessEmail} from './discovery-source';
export function companyUrl(value:string){
 const u=new URL(value);
 if(u.protocol!=='https:'||u.port||u.username||u.password||isIP(u.hostname)||!u.hostname.includes('.')||u.hostname.endsWith('.local')||u.hostname.endsWith('.internal'))throw Error('Use a public HTTPS company website.');
 u.hash='';return u;
}
export function publicAddress(ip:string){
 if(isIP(ip)!==4)return false;const [a,b,c]=ip.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===88&&c===99)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
export async function readCompanyPage(value:string):Promise<{url:string;status:number;html:string}>{
 let url=companyUrl(value);const origin=url.origin;
 for(let hop=0;hop<2;hop++){
  let dnsTimer:ReturnType<typeof setTimeout>|undefined;
  const addresses=await Promise.race([lookup(url.hostname,{all:true,family:4}),new Promise<never>((_,reject)=>{dnsTimer=setTimeout(()=>reject(Error('Website DNS timed out.')),3000);})]).finally(()=>clearTimeout(dnsTimer));
  if(!addresses.length||addresses.some(x=>!publicAddress(x.address)))throw Error('Website address is not public.');
  // Pin the validated address for the actual connection, retaining TLS hostname checks.
  const result=await new Promise<{status:number;location?:string;html:string}>((resolve,reject)=>{
   const req=request(url,{method:'GET',family:4,signal:AbortSignal.timeout(6000),lookup:(_host,_options,cb)=>cb(null,addresses[0].address,4),headers:{'User-Agent':'VeltraCRM/1.0 contact-research','Accept':'text/html,text/plain;q=0.9','Accept-Encoding':'identity'}},res=>{
    const status=res.statusCode??0;if([301,302,303,307,308].includes(status)){res.resume();resolve({status,location:res.headers.location,html:''});return;}
    if(status!==404&&!/^text\/(?:html|plain)(?:;|$)/i.test(res.headers['content-type']??'')){res.destroy();reject(Error('Website did not return a readable page.'));return;}
    const chunks:Buffer[]=[];let size=0;
    res.on('data',chunk=>{size+=chunk.length;if(size>1000000){res.destroy(Error('Website page exceeds the size limit.'));return;}chunks.push(Buffer.from(chunk));});
    res.on('error',reject);res.on('end',()=>resolve({status,html:Buffer.concat(chunks).toString('utf8')}));
   });req.on('error',reject);req.setTimeout(6000,()=>req.destroy(Error('Website request timed out.')));req.end();
  });
  if(result.location){const next=companyUrl(new URL(result.location,url).href);if(next.origin!==origin)throw Error('Website redirects to another domain; review its official website first.');url=next;continue;}
  return {url:url.href,status:result.status,html:result.html};
 }
 throw Error('Website redirect limit reached.');
}
export function robotAllows(text:string,path:string){
 const groups:{agents:string[];rules:{allow:boolean;path:string}[]}[]=[];let group:typeof groups[number]|null=null;
 for(const line of text.split(/\r?\n/)){const m=/^\s*(user-agent|allow|disallow)\s*:\s*([^#]*)/i.exec(line);if(!m)continue;const key=m[1].toLowerCase(),v=m[2].trim();
  if(key==='user-agent'){if(!group||group.rules.length){group={agents:[],rules:[]};groups.push(group);}group.agents.push(v.toLowerCase());}
  else if(group&&v)group.rules.push({allow:key==='allow',path:v});
 }
 const specific=groups.filter(g=>g.agents.some(a=>a!=='*'&&'veltracrm'.includes(a)));
 const selected=specific.length?specific:groups.filter(g=>g.agents.includes('*'));
 const matches=selected.flatMap(g=>g.rules).filter(r=>{const pattern=r.path.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replaceAll('*','.*').replace(/\\\$$/,'$');return new RegExp('^'+pattern).test(path);}).sort((a,b)=>b.path.length-a.path.length||Number(b.allow)-Number(a.allow));
 return !matches.length||matches[0].allow;
}
export function publishedContacts(html:string,url:string){
 const visible=html.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ');
 const candidates=new Set<string>();
 for(const m of visible.matchAll(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,63}/gi)){const email=publishedBusinessEmail(m[0]);if(email)candidates.add(email);}
 return [...candidates].slice(0,10).map(email=>({email,source_url:url,source_kind:'company_website' as const}));
}
export async function researchCompanyWebsite(website:string,read=readCompanyPage){
 const root=companyUrl(website);const robots=await read(new URL('/robots.txt',root).href);
 if(robots.status!==404&&robots.status!==200)throw Error('Website crawl policy is unavailable; retry later.');
 const policy=robots.status===200?robots.html:'';
 if(!robotAllows(policy,root.pathname+root.search))throw Error('Website does not permit this crawler.');
 const home=await read(root.href);if(home.status!==200)throw Error('Company website is unavailable.');
 const links=[...home.html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].flatMap(m=>{try{const u=companyUrl(new URL(m[1].replaceAll('&amp;','&'),root).href);return u.origin===root.origin&&/contact|about/i.test(u.pathname)&&robotAllows(policy,u.pathname+u.search)?[u.href]:[];}catch{return [];}});
 const pages=[home],failures:string[]=[];
 for(const url of [...new Set(links)].slice(0,2)){try{const p=await read(url);if(p.status===200)pages.push(p);else failures.push('Contact page unavailable.');}catch{failures.push('Contact page unavailable.');}}
 return {contacts:pages.flatMap(p=>publishedContacts(p.html,p.url)),pages:pages.map(p=>p.url),failures,observed_at:new Date().toISOString(),limitation:'Published organizational contact only; company identity, mailbox deliverability and outreach eligibility still require review.'};
}
