import {crmUser} from '@/lib/crm/server';
import {workspacePreferences,type PreferenceDependencies} from '@/lib/workspace-preferences-api';
export const runtime='nodejs';
const dependencies:PreferenceDependencies={
 authenticate:async request=>(await crmUser(request)).user,
 update:async(request,data)=>{
  // Capture the request's verified identity; never use an admin key or a mutable browser session.
  const response=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`,{
   method:'PUT',headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,Authorization:request.headers.get('authorization')!,'Content-Type':'application/json'},
   body:JSON.stringify({data}),cache:'no-store',signal:AbortSignal.timeout(15000),
  });
  if(!response.ok)throw Error(response.status===401?'401:Sign in again to save preferences.':response.status===429?'429:Too many changes. Wait a moment and try again.':'503:Preferences could not be saved. Try again.');
  return response.json();
 },
};
export const GET=(request:Request)=>workspacePreferences(request,dependencies);
export const PUT=(request:Request)=>workspacePreferences(request,dependencies);
