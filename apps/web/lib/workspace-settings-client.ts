'use client';
import {gatewayAuthorizationHeaders} from './client-session';
import {type AccountSettings,type PreferenceSection,type WorkspaceSettings} from './workspace-settings';
export async function settingsRequest<T>(method='GET',body?:unknown):Promise<T>{
 const response=await fetch('/api/workspace/preferences',{method,headers:{...await gatewayAuthorizationHeaders(),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(20000)});
 const data=await response.json().catch(()=>{throw Error('Workspace preferences returned an unreadable response.');});
 if(!response.ok)throw Error(data.error||'Workspace preferences are unavailable.');return data as T;
}
export const workspaceSettingsService={
 load:()=>settingsRequest<AccountSettings>(),
 save:async<S extends PreferenceSection>(userId:string,section:S,value:WorkspaceSettings[S])=>settingsRequest<{userId:string;section:S;value:WorkspaceSettings[S]}>('PUT',{userId,section,value}),
};
