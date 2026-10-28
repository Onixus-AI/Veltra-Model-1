/** Next decodes catch-all segments before the proxy validates and re-encodes them. */
export function safeMailFramePath(path:string[]){
 return path.every((part,index)=>{
  if(part==='.'||part==='..')return false;
  if(/^[a-zA-Z0-9@._%+-]+$/.test(part))return true;
  // Only approval IDs use these separators. They remain one encoded segment upstream.
  return path.length===3&&path[0]==='api'&&path[1]==='approvals'&&index===2&&part.length<=1000&&/^(?:mail|follow|feedback):[a-zA-Z0-9@._:+-]+$/.test(part);
 });
}
