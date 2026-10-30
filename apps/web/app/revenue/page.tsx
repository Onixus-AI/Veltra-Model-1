import {redirect} from 'next/navigation';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const input=await searchParams,params=new URLSearchParams({view:'Revenue'});
 for(const [key,value] of Object.entries(input)){if(typeof value!=='string')continue;params.set(key==='view'?'revenue_view':key==='w'?'workspace':key,value);}
 redirect('/crm?'+params.toString());
}
