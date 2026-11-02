import {accountSettings,normalizePreference,preferenceKeys,validVersion,type PreferenceSection} from './workspace-settings';
type User={id:string;is_anonymous?:boolean;user_metadata?:Record<string,unknown>};
export type PreferenceDependencies={authenticate:(request:Request)=>Promise<User>;update:(request:Request,data:Record<string,unknown>)=>Promise<User>};
const headers={'Cache-Control':'no-store'};
export async function workspacePreferences(request:Request,deps:PreferenceDependencies):Promise<Response>{
 try{
  if(request.method!=='GET'&&request.method!=='PUT')return Response.json({error:'Method not allowed.'},{status:405,headers:{...headers,Allow:'GET, PUT'}});
  const user=await deps.authenticate(request);
  if(!user.id||user.is_anonymous)throw Error('401:Sign in to save workspace preferences.');
  if(request.method==='GET')return Response.json(accountSettings(user),{headers});
  const raw=await request.text();if(raw.length>8192)throw Error('413:Workspace preferences are too large.');
  let body:Record<string,unknown>;
  try{body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{throw Error('400:Invalid workspace preferences.');}
  if(Object.keys(body).some(key=>!['userId','section','value'].includes(key)))throw Error('400:Unexpected preference fields.');
  if(body.userId!==user.id)throw Error('409:Your account changed. Reload preferences before saving.');
  if(body.section!=='layout'&&body.section!=='appearance')throw Error('400:Unknown preference section.');
  if(!validVersion(body.value))throw Error('400:Unsupported preference version.');
  if(body.section==='layout'&&(!Array.isArray(body.value.tools)||typeof body.value.name!=='string'))throw Error('400:Choose a workspace name and tools.');
  const section:PreferenceSection=body.section,value=normalizePreference(section,body.value),key=preferenceKeys[section];
  // A single metadata key is patched so changing appearance cannot overwrite layout.
  const saved=await deps.update(request,{[key]:value});
  if(saved.id!==user.id||!validVersion(saved.user_metadata?.[key])||JSON.stringify(normalizePreference(section,saved.user_metadata[key]))!==JSON.stringify(value))throw Error('502:Saving workspace preferences could not be confirmed. Try again.');
  return Response.json({userId:user.id,section,value},{headers});
 }catch(error){
  const message=error instanceof Error?error.message:'',match=/^(400|401|403|409|413|429|502|503):(.+)$/.exec(message);
  return Response.json({error:match?match[2]:'Workspace preferences are unavailable. Try again.'},{status:match?Number(match[1]):503,headers});
 }
}
