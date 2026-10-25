import {trashCriteria} from './trash-criteria';
// Mail commands execute only from the latest user request, never external context.
export type MailIntent={tool:string;arguments:Record<string,unknown>};
export function mailIntent(text:string):MailIntent|null{
 if(text.length>2000)return null;
 if(trashCriteria(text))return {tool:'trash_old_mail',arguments:{instruction:text}};
 const cleanup=/^(?:please )?(show|check|retry) (?:mail )?cleanup ([a-f0-9-]{36})[.!]?$/i.exec(text.trim());if(cleanup)return {tool:cleanup[1].toLowerCase()==='retry'?'retry_mail_cleanup':'mail_cleanup_status',arguments:{operation_id:cleanup[2]}};
 if(/\b(quote|quotation|rate)s?\b/i.test(text)&&/no (?:response|reply)|unanswered|without (?:a )?(?:reply|response)/i.test(text))return {tool:'find_unanswered_quotes',arguments:{days:0}};
 if(/^(?:please )?(?:prepare|draft|scan|find)\b.*follow[- ]?ups?/i.test(text))return {tool:'prepare_quote_followups',arguments:{}};
 if(/\b(why|feedback|reasons?)\b/i.test(text)&&/customers|lost quotes|didn.t choose/i.test(text))return {tool:'quote_feedback',arguments:{}};
 if(/^(?:please )?(?:show|list)\b.*(?:mail|sender) folders/i.test(text))return {tool:'list_sender_folders',arguments:{}};
 const search=/^(?:please )?(?:search|find)(?: in)? (?:my |our )?(?:mail|email|inbox)(?: for|:)?\s+(.+)$/i.exec(text.trim());
 if(search)return {tool:'search_mail',arguments:{query:search[1].trim().slice(0,1000)}};
 return null;
}
const plain=(value:unknown,max=350)=>String(value??'').slice(0,max).replace(/[\r\n]+/g,' ').replace(/[\\`*_{}\[\]()#+.!<>|]/g,'\\$&');
export function mailReceipt(tool:string,value:any):string{
 if(['trash_old_mail','mail_cleanup_status','retry_mail_cleanup'].includes(tool))return `Mail cleanup: ${plain(value?.status)}\n\nMailbox: ${plain(value?.mailbox)}\nCutoff: strictly before ${plain(value?.cutoff)} (UTC)\nOperation: ${plain(value?.operation_id)}\n\nMatched so far: ${Number(value?.matched??0)}; confirmed moved: ${Number(value?.moved??0)}; already in Trash: ${Number(value?.already_trashed??0)}; no longer matching: ${Number(value?.not_matching??0)}; missing: ${Number(value?.missing??0)}; failed: ${Number(value?.failed??0)}; uncertain: ${Number(value?.uncertain??0)}; remaining: ${Number(value?.pending??0)}.\n\n${value?.discovery_complete?'Discovery is complete.':'Discovery is still running; these are not final totals.'} ${value?.status==='completed'?'The operation is complete.':value?.status==='partial'||value?.status==='blocked'?'Some work could not be confirmed. Request “retry mail cleanup '+plain(value?.operation_id)+'” to retry the same cutoff.':'Work continues in Mail. Ask “show mail cleanup '+plain(value?.operation_id)+'” for progress.'} Recoverable Trash only; permanent deletion was not requested or performed.`;
 const scope=plain(value?.scope??'Your connected Veltra Mail account.');
 if(tool==='prepare_quote_followups')return `Prepared ${Array.isArray(value?.drafted)?value.drafted.length:0} quote follow-up draft(s). Open Veltra Mail → Approval queue to review them. No email was sent.\n\n${scope}`;
 const items=Array.isArray(value)?value:Array.isArray(value?.items)?value.items:[];
 const heading=tool==='quote_feedback'?'Tracked quote feedback':tool==='find_unanswered_quotes'?'Unanswered quote candidates':tool==='list_sender_folders'?'Sender folders':'Mail search results';
 const lines=items.slice(0,25).map((x:any)=>`- **${plain(x.subject??x.sender_name??x.label??'Mail record',160)}** — ${plain(x.from??x.to??x.address??'')}\n  ${tool==='quote_feedback'?`Status: ${plain(x.status)}; reason: ${plain(x.reason)}; source: ${plain(x.reason_source)}. ${plain(x.evidence)}`:plain(x.snippet??x.quote_excerpt??x.body??x.label)}`);
 return `${heading}\n\n${lines.length?lines.join('\n'):'No matching records on this page.'}\n\n${scope}${value?.next_cursor||items.length>25?' More records are available; open Mail for additional pages.':''}${tool==='quote_feedback'?' No response stays unknown. Customer-stated reasons and owner assessments are separate.':''}`;
}
export async function executeMailTool(intent:MailIntent,authorization:string,origin:string,fetcher:typeof fetch=fetch):Promise<unknown>{
 const url=new URL(origin);if(url.protocol!=='https:'||url.username||url.password)throw new Error('503:Mail connection is not configured correctly.');
 const response=await fetcher(url.origin+'/chat/mail-mcp',{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:crypto.randomUUID(),method:'tools/call',params:{name:intent.tool,arguments:intent.arguments}}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(55000)});
 if(!response.ok)throw new Error(`${[401,409,429,503].includes(response.status)?response.status:502}:${response.status===409?'Connect Veltra Mail in Connections first.':response.status===401?'Sign in to Onixus Workspace again.':'Mail could not complete this command. Open Mail to check the connection.'}`);
 const rpc=await response.json();if(rpc.error||rpc.result?.isError)throw new Error('502:Mail could not complete this command. Open Mail to check its connection.');
 const content=rpc.result?.content?.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('');if(!content)throw new Error('502:Mail returned no action receipt.');
 return JSON.parse(content);
}
export async function executeMailIntent(intent:MailIntent,authorization:string,origin:string,fetcher:typeof fetch=fetch):Promise<string>{return mailReceipt(intent.tool,await executeMailTool(intent,authorization,origin,fetcher));}
export function mailChatResponse(content:string,stream:boolean){
 const chunk={id:'mail-'+crypto.randomUUID(),object:stream?'chat.completion.chunk':'chat.completion',choices:[{index:0,...(stream?{delta:{content}}:{message:{role:'assistant',content}}),finish_reason:stream?null:'stop'}]};
 if(!stream)return Response.json(chunk,{headers:{'Cache-Control':'no-store'}});
 return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'}});
}
