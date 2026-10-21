/** A short, plain-text preview. The complete Markdown stays available in Details. */
export function chatPreview(content:string){
 const long=content.length>700||content.split('\n').length>14;
 if(!long)return {long:false,preview:content};
 const text=content.replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g,'').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/^\s{0,3}#{1,6}\s+/gm,'').replace(/[*_`]/g,'').trim();
 const first=text.split(/\n\s*\n/).find(part=>part.trim())??'';
 const preview=first.length<=360?first:first.slice(0,357).replace(/\s+\S*$/,'')+'…';
 return {long:true,preview:preview||'Your response is ready. Open details to view it in full.'};
}
