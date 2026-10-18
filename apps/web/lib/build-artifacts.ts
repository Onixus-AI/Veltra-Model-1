export type ProjectFile={path:string;content:string};
export function checkedFiles(value:unknown):ProjectFile[]{
 if(!Array.isArray(value)||value.length<1||value.length>12)throw new Error('Expected 1–12 project files.');
 const seen=new Set<string>();let total=0;
 return value.map(item=>{
  if(!item||typeof item.path!=='string'||typeof item.content!=='string')throw new Error('Invalid project file.');
  const parts=item.path.split('/');
  if(item.path.length>180||!/^[A-Za-z0-9_.@()/ -]+$/.test(item.path)||parts.some((p:string)=>!p||p.startsWith('.')||['node_modules','credentials','secrets'].includes(p))||seen.has(item.path)||item.content.length>60000)throw new Error('Unsafe project file.');
  seen.add(item.path);total+=item.content.length;if(total>120000)throw new Error('Project is too large.');
  return {path:item.path,content:item.content};
 });
}
