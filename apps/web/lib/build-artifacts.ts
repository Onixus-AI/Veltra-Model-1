export type ProjectFile={path:string;content:string};
export function checkedFiles(value:unknown):ProjectFile[]{
 if(!Array.isArray(value)||value.length<1||value.length>12)throw new Error('Expected 1–12 project files.');
 const website=value.length===1&&value[0]?.path==='index.html'&&typeof value[0]?.content==='string'&&/<html(?:\s|>)/i.test(value[0].content)&&/<\/html>\s*$/i.test(value[0].content);
 const totalLimit=website?250000:120000;
 const seen=new Set<string>();let total=0;
 return value.map(item=>{
  if(!item||typeof item.path!=='string'||typeof item.content!=='string')throw new Error('Invalid project file.');
  const parts=item.path.split('/'),bytes=new TextEncoder().encode(item.content).length;
  if(item.path.length>180||!/^[A-Za-z0-9_.@()/ -]+$/.test(item.path)||parts.some((p:string)=>!p||p.startsWith('.')||['node_modules','credentials','secrets'].includes(p))||seen.has(item.path)||item.content.includes('\0')||(!website&&item.content.length>60000)||bytes>totalLimit)throw new Error('Unsafe project file.');
  seen.add(item.path);total+=bytes;if(total>totalLimit)throw new Error('Project is too large.');
  return {path:item.path,content:item.content};
 });
}
