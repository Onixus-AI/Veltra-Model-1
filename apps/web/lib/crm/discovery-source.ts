export type Bounds=[number,number,number,number];
export const categories={logistics:['office','logistics'],warehouses:['industrial','warehouse'],manufacturers:['man_made','works'],retailers:['shop','*'],offices:['office','*']} as const;
export type Category=keyof typeof categories;
export function checkedBounds(value:unknown):Bounds{
 if(!Array.isArray(value)||value.length!==4||!value.every(n=>typeof n==='number'&&Number.isFinite(n)))throw Error('Choose south, west, north and east coordinates.');
 const [s,w,n,e]=value;
 if(s< -85||n>85||w< -180||e>180||s>=n||w>=e||n-s>2||e-w>2)throw Error('Choose a service area no wider than two degrees.');
 return [s,w,n,e];
}
export function sourceQuery(category:string,bounds:unknown,phase:number,cursor:number){
 const b=checkedBounds(bounds),tag=categories[category as Category];
 if(!tag||!Number.isInteger(phase)||phase<0||phase>2||!Number.isSafeInteger(cursor)||cursor<0)throw Error('Invalid discovery cursor.');
 const type=['node','way','relation'][phase],filter=tag[1]==='*'?'["'+tag[0]+'"]':'["'+tag[0]+'"="'+tag[1]+'"]';
 return '[out:json][timeout:20];'+type+filter+'["name"]('+b.join(',')+')(if:id()>'+cursor+');out tags asc 101;';
}
type Element={id:number;type:string;tags?:Record<string,string>};
export function sourcePage(raw:unknown,phase:number,cursor:number){
 const data=raw as {elements?:Element[];remark?:string};
 if(data.remark||!Array.isArray(data.elements))throw Error('Source returned an incomplete result; cursor was not advanced.');
 const expected=['node','way','relation'][phase];
 if(!expected||data.elements.some(e=>e.type!==expected||!Number.isSafeInteger(e.id)||e.id<=cursor))throw Error('Invalid source cursor result.');
 const ordered=[...data.elements].sort((a,b)=>a.id-b.id);
 const unique=new Set<number>();
 if(ordered.some(e=>unique.has(e.id)||(unique.add(e.id),false)))throw Error('Duplicate source identifiers.');
 const page=ordered.slice(0,100);
 const leads=page.flatMap(e=>{
  const t=e.tags??{},company=(t.name??'').trim().slice(0,200);if(!company)return [];
  const rawEmail=(t['contact:email']??t.email??'').trim().toLowerCase();
  const email=/^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/.test(rawEmail)?rawEmail:null;
  let website='';try{const u=new URL(t['contact:website']??t.website??'');if(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password)website=u.href.slice(0,1000);}catch{}
  return [{source_key:expected+'/'+e.id,source_url:'https://www.openstreetmap.org/'+expected+'/'+e.id,company,email,website,phone:(t['contact:phone']??t.phone??'').slice(0,80),location:[t['addr:city'],t['addr:state'],t['addr:postcode']].filter(Boolean).join(', ').slice(0,200)}];
 });
 const more=ordered.length>100;
 return {leads,next_phase:more?phase:phase+1,next_cursor:more?page.at(-1)!.id:0,exhausted:!more&&phase===2};
}
export async function discoverPage(job:{provider?:string;category:string;bounds:Bounds;phase:number;cursor:number},fetcher:typeof fetch=fetch){
 if(job.provider&&job.provider!=='openstreetmap')return discoverRegistryPage({provider:job.provider,cursor:job.cursor},fetcher);
 const response=await fetcher('https://overpass-api.de/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'VeltraCRM/1.0 (https://veltra.ai)'},body:new URLSearchParams({data:sourceQuery(job.category,job.bounds,job.phase,job.cursor)}),redirect:'error',signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw Error('Open map source unavailable ('+response.status+'); retry scheduled.');
 const text=await response.text();if(text.length>2000000)throw Error('Source result exceeds the page limit.');
 return sourcePage(JSON.parse(text),job.phase,job.cursor);
}
export const registries={
 fmcsa:{name:'FMCSA transport companies',host:'data.transportation.gov',dataset:'az4n-8mr2',id:'dot_number',select:'dot_number,legal_name,dba_name,phy_state,status_code',industry:'Transportation registrant'},
 ny_registry:{name:'New York business registry',host:'data.ny.gov',dataset:'n9v6-gdp6',id:'dos_id',select:'dos_id,current_entity_name,county,jurisdiction,entity_type',industry:'Business registry'}
} as const;
export type Registry=keyof typeof registries;
export function registryQuery(provider:string,cursor:number){
 const r=registries[provider as Registry];if(!r||!Number.isSafeInteger(cursor)||cursor<0)throw Error('Invalid registry continuation.');
 const field=provider==='ny_registry'?'dos_id::number':r.id;
 const url=new URL('https://'+r.host+'/resource/'+r.dataset+'.json');
 url.search=new URLSearchParams({'$select':r.select,'$where':field+' > '+cursor,'$order':field+' ASC','$limit':'101'}).toString();
 return url.href;
}
export function registryPage(provider:string,raw:unknown,cursor:number){
 const r=registries[provider as Registry];if(!r||!Array.isArray(raw)||raw.length>101)throw Error('Registry returned an invalid page.');
 const rows=raw as Record<string,string>[];
 let previous=cursor;
 for(const row of rows){const id=Number(row[r.id]);if(!Number.isSafeInteger(id)||id<=previous)throw Error('Registry continuation is not strictly ordered.');previous=id;}
 const page=rows.slice(0,100);
 const leads=page.flatMap(row=>{
  const company=(provider==='fmcsa'?row.legal_name:row.current_entity_name)?.trim().slice(0,200);if(!company)return [];
  const id=Number(row[r.id]);
  return [{source_key:provider+'/'+id,source_url:'https://'+r.host+'/resource/'+r.dataset+'.json?'+r.id+'='+id,company,email:null,website:'',phone:'',location:provider==='fmcsa'?(row.phy_state??''):([row.county,row.jurisdiction].filter(Boolean).join(', ')).slice(0,200)}];
 });
 return {leads,next_phase:rows.length>100?0:3,next_cursor:page.length?Number(page.at(-1)![r.id]):cursor,exhausted:rows.length<=100};
}
export async function discoverRegistryPage(job:{provider:string;cursor:number},fetcher:typeof fetch=fetch){
 const response=await fetcher(registryQuery(job.provider,job.cursor),{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw Error('Business registry unavailable ('+response.status+'); retry scheduled.');
 const text=await response.text();if(text.length>1000000)throw Error('Registry page exceeds the size limit.');
 return registryPage(job.provider,JSON.parse(text),job.cursor);
}
