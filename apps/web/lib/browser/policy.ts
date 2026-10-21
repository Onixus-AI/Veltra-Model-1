import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {publicAddress} from '../crm/contact-research';
import type {NetworkPolicy} from '@vercel/sandbox';

export function browserUrl(value:unknown){
 if(typeof value!=='string'||value.length>2000)throw Error('400:Choose a public HTTPS page.');
 let u:URL;try{u=new URL(value);}catch{throw Error('400:Choose a public HTTPS page.');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||isIP(u.hostname)||u.hostname.includes(':')||!u.hostname.includes('.')||!/[a-z]/i.test(u.hostname)||u.hostname.endsWith('.')||/\.(?:localhost|local|internal|test|invalid|example)$/i.test(u.hostname))throw Error('400:Browser inspection supports public HTTPS pages only.');
 if([...u.searchParams.keys()].some(k=>/^(?:access_token|token|code|password|secret|signature|sig)$/i.test(k)))throw Error('400:Use a public page without login, reset or access tokens.');
 u.hash='';return u;
}
export async function checkBrowserDns(url:URL,resolve=async(host:string)=>lookup(host,{family:4,all:true})){
 let timer:ReturnType<typeof setTimeout>|undefined;
 const addresses=await Promise.race([resolve(url.hostname),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('503:Website DNS timed out.')),3000);})]).finally(()=>clearTimeout(timer));
 if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('400:The browser cannot access private or reserved network addresses.');
}
export function browserNetworkPolicy(hostname:string):NetworkPolicy{
 return {allow:{[hostname]:[
  {match:{method:['GET','HEAD']},transform:[]},
  {response:{statusCode:403,body:'Veltra browser inspection is read-only.',contentType:'text/plain'}}
 ]},subnets:{deny:['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.0.0.0/24','192.168.0.0/16','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24','224.0.0.0/4','240.0.0.0/4','::/128','::1/128','::ffff:0:0/96','64:ff9b::/96','2001:db8::/32','fc00::/7','fe80::/10','ff00::/8']}};
}
