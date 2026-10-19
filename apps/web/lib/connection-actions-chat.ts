/** A write needs an explicit latest-user instruction and a reviewed resource/version. */
export function connectionWriteIntent(text:string):Record<string,unknown>|null{
 if(text.length>350000)return null;
 const match=/^(?:please )?create (?:a )?(?:draft )?repository pull request:\s*([\s\S]+)$/i.exec(text.trim());if(!match)return null;
 try{const p=JSON.parse(match[1]);if(!p||typeof p!=='object'||Array.isArray(p))return null;
 const fields=['repository','branch','connection_version','path','content','sha','title','operation'];
 if(Object.keys(p).some(k=>!fields.includes(k))||fields.some(k=>!(k in p)))return null;
 if(typeof p.repository!=='string'||typeof p.branch!=='string'||!Number.isInteger(p.connection_version)||p.connection_version<0||typeof p.path!=='string'||typeof p.content!=='string'||p.content.length>300000||typeof p.sha!=='string'||!/^[a-f0-9]{40}$/.test(p.sha)||typeof p.title!=='string'||!p.title.trim()||typeof p.operation!=='string'||!/^[a-f0-9-]{36}$/i.test(p.operation))return null;
 return p;
 }catch{return null;}
}
export async function executeConnectionWrite(change:Record<string,unknown>,authorization:string,origin:string,fetcher:typeof fetch=fetch){
 const target=new URL(origin);if(target.protocol!=='https:'||target.username||target.password)throw Error('503:Connections are not configured correctly.');
 const r=await fetcher(target.origin+'/chat/connections/github/pull-request',{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify(change),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(60000)});
 const result=await r.json();if(!r.ok)throw Error('409:'+String(result.error??'The selected repository or file changed. Review it again.').slice(0,400));
 let url:URL;try{url=new URL(result.url);}catch{throw Error('502:No pull request receipt returned.');}
 if(url.protocol!=='https:'||url.hostname!=='github.com'||!/^\/[^/]+\/[^/]+\/pull\/\d+$/.test(url.pathname))throw Error('502:Invalid pull request receipt.');
 return 'Draft repository pull request created: '+url.href+'\nThe connected repository selection and file version were checked. Review the pull request before merging or releasing it.';
}
