export type BusinessPeriod='today'|'week'|'month';
function midnight(year:number,month:number,day:number,zone:string){
 const target=Date.UTC(year,month-1,day);let value=target;
 for(let n=0;n<3;n++){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric',hourCycle:'h23'}).formatToParts(new Date(value));const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));value+=target-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);}
 return value;
}
export function businessPeriod(period:BusinessPeriod,zone:string,now=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'numeric',day:'numeric'}).formatToParts(now);const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));const day=new Date(Date.UTC(+p.year,+p.month-1,+p.day));
 if(period==='week')day.setUTCDate(day.getUTCDate()-((day.getUTCDay()+6)%7));if(period==='month')day.setUTCDate(1);
 const start=midnight(day.getUTCFullYear(),day.getUTCMonth()+1,day.getUTCDate(),zone),end=now.getTime(),duration=end-start;
 return {from:new Date(start).toISOString(),to:now.toISOString(),previousFrom:new Date(start-duration).toISOString(),previousTo:new Date(start).toISOString(),zone};
}
