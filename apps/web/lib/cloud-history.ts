export type HistoryMessage={role:'user'|'assistant';content:string;imageId?:string};
export type HistoryWrite={id:string;revision:number;messages:HistoryMessage[]};
type Request=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
const same=(a:HistoryMessage[],b:HistoryMessage[])=>a.length===b.length&&a.every((item,index)=>item.role===b[index]?.role&&item.content===b[index]?.content&&(item.imageId??null)===(b[index]?.imageId??null));
const retryable=(error:unknown)=>error instanceof TypeError||(error instanceof Error&&(/failed to fetch|network|timed out|timeout/i.test(error.message)||[502,503,504].includes(Number((error as Error&{status?:number}).status))));
/** Reconcile an uncertain write before retrying the same optimistic revision. Never overwrite another writer. */
export async function saveCloudHistory(request:Request,write:HistoryWrite):Promise<{revision:number}>{
 const path='conversations/'+write.id;
 const put=()=>request<{revision:number}>(path,'PUT',{revision:write.revision,messages:write.messages});
 try{return await put();}catch(error){
  const current=await request<{revision:number;messages:HistoryMessage[]}>(path).catch(()=>null);
  if(current&&same(current.messages,write.messages))return {revision:current.revision};
  if(current&&current.revision!==write.revision)throw Error('This conversation changed in another tab. Your reply remains here; copy it before reloading.');
  if(!retryable(error))throw error;
  // Same revision protects against a delayed first write or another tab winning the race.
  try{return await put();}catch(second){
   const confirmed=await request<{revision:number;messages:HistoryMessage[]}>(path).catch(()=>null);
   if(confirmed&&same(confirmed.messages,write.messages))return {revision:confirmed.revision};
   throw second;
  }
 }
}
