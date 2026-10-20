import {type Snapshot,type Stage,stages} from './domain';
export const planningWeights:Record<Stage,number>={new:10,qualified:25,meeting:50,proposal:75,won:100,lost:0};
export function dashboard(data:Snapshot,days:number,industry:string,weights=planningWeights,now=Date.now()){
 const cutoff=days?now-days*86400000:-Infinity;
 const customers=data.customers.filter(c=>(!industry||c.industry===industry)&&Date.parse(c.created_at)>=cutoff&&Date.parse(c.created_at)<=now);
 const ids=new Set(customers.map(c=>c.id));
 const deals=data.deals.filter(d=>ids.has(d.customer_id)),tasks=data.tasks.filter(t=>ids.has(t.customer_id));
 const active=deals.filter(d=>!['won','lost'].includes(d.stage)),usd=active.filter(d=>d.currency==='USD');
 const closed=deals.filter(d=>['won','lost'].includes(d.stage));
 const channels=Object.entries(customers.reduce<Record<string,number>>((a,c)=>{const key=c.source||'Unrecorded';a[key]=(a[key]||0)+1;return a;},{})).sort((a,b)=>b[1]-a[1]);
 const months=Array.from({length:6},(_,i)=>{const date=new Date(now);date.setUTCDate(1);date.setUTCHours(0,0,0,0);date.setUTCMonth(date.getUTCMonth()-5+i);const end=new Date(date);end.setUTCMonth(end.getUTCMonth()+1);return {label:date.toLocaleDateString('en-US',{month:'short',timeZone:'UTC'}),count:customers.filter(c=>Date.parse(c.created_at)>=date.getTime()&&Date.parse(c.created_at)<end.getTime()).length};});
 return {customers,deals,tasks,active,channels,months,pipeline:usd.reduce((n,d)=>n+d.value_cents,0),weighted:usd.reduce((n,d)=>n+d.value_cents*Math.min(100,Math.max(0,weights[d.stage]))/100,0),excluded:active.length-usd.length,winRate:closed.length?Math.round(deals.filter(d=>d.stage==='won').length/closed.length*100):null,open:tasks.filter(t=>t.status==='open'),overdue:tasks.filter(t=>t.status==='open'&&t.due_at&&Date.parse(t.due_at)<now),stages:stages.map(stage=>({stage,count:deals.filter(d=>d.stage===stage).length,value:deals.filter(d=>d.stage===stage&&d.currency==='USD').reduce((n,d)=>n+d.value_cents,0)}))};
}

export function attributedConversion(data:Snapshot,channel:'paid'|'social'){
 const paid=/\b(ads?|paid|ppc|cpc|sponsored)\b/i,social=/\b(social|facebook|instagram|linkedin|tiktok|twitter|youtube)\b/i;
 const customers=data.customers.filter(c=>channel==='paid'?paid.test(c.source):!paid.test(c.source)&&social.test(c.source));
 const won=new Set(data.deals.filter(deal=>deal.stage==='won'&&customers.some(c=>c.id===deal.customer_id)).map(deal=>deal.customer_id));
 return {leads:customers.length,won:won.size,rate:customers.length?Math.round(won.size/customers.length*100):null};
}
