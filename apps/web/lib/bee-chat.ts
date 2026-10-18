// Route only an explicit request in the latest user message, never retrieved text.
export function beeIntent(text:string):{name:string;arguments:Record<string,unknown>}|null{
 const value=text.trim();if(value.length>2100)return null;
 if(/^(?:is bee connected|what can (?:i do with )?bee(?: do)?|what bee tools are connected)[.!?]?$/i.test(value))return {name:'status',arguments:{}};
 const ask=/^(?:please\s+)?ask bee\s*[:,-]?\s+([\s\S]+)$/i.exec(value);
 if(ask&&ask[1].length<=2000)return {name:'ask_bee',arguments:{message:ask[1]}};
 if(/^(?:please\s+)?(?:show|list|get) my (?:saved )?bee looks[.!?]?$/i.test(value))return {name:'list_looks',arguments:{saved_only:/saved/i.test(value)}};
 if(/^(?:please\s+)?(?:show|get) my (?:bee|honey) calendar[.!?]?$/i.test(value))return {name:'get_calendar',arguments:{}};
 if(/^(?:please\s+)?(?:show|get) my (?:bee|liveaskew) (?:day|daily overview)[.!?]?$/i.test(value))return {name:'get_today',arguments:{}};
 return null;
}
export function beeChatResponse(text:string,stream:boolean){
 const id='bee-'+crypto.randomUUID();
 if(!stream)return Response.json({id,object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:text},finish_reason:'stop'}]},{headers:{'Cache-Control':'no-store'}});
 const chunk={id,object:'chat.completion.chunk',choices:[{index:0,delta:{content:text},finish_reason:null}]};
 return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'}});
}
