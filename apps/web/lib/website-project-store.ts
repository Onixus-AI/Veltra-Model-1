import {gatewayAuthorizationHeaders} from './client-session';
import {readWebsiteProject,serializeWebsiteProject,WEBSITE_PROJECT_LIMIT,type WebsiteProject} from './website-project';
export type SavedWebsite={id:string;name:string;size:number;created_at:string;deleted_at:string|null};
async function request(path:string,body?:object){
 const response=await fetch('/api/brand/'+path,{method:body?'POST':'GET',headers:{...await gatewayAuthorizationHeaders(),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.error??'Website storage is unavailable.');}return response;
}
export async function savedWebsites():Promise<SavedWebsite[]>{const data=await(await request('files')).json();if(!Array.isArray(data.files))throw Error('Saved websites could not load.');return data.files.filter((file:SavedWebsite)=>!file.deleted_at&&file.name.endsWith('.onixus-website.json'));}
export async function openSavedWebsite(id:string){if(!/^[a-f0-9-]{36}$/i.test(id))throw Error('Choose a saved project.');const response=await request('download?id='+encodeURIComponent(id));const text=await response.text();if(new TextEncoder().encode(text).length>WEBSITE_PROJECT_LIMIT)throw Error('Saved project exceeds its limit.');return readWebsiteProject(JSON.parse(text));}
export async function saveWebsite(project:WebsiteProject){
 const text=serializeWebsiteProject(project),bytes=new TextEncoder().encode(text);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.slice(i,i+8192));
 const name=project.name.replace(/\.html?$/i,'').slice(0,75)+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'.onixus-website.json';
 const data=await(await request('upload',{name,data:btoa(binary)})).json(),file=data.file as SavedWebsite;
 if(!file||!/^[a-f0-9-]{36}$/i.test(file.id)||file.name!==name||file.size!==bytes.length)throw Error('Save receipt is incomplete. Check saved websites before retrying.');
 const restored=await openSavedWebsite(file.id);
 if(serializeWebsiteProject(restored)!==text)throw Error('Saved content could not be verified. Keep your local project download.');
 return file;
}
