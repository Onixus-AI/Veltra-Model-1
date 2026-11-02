'use client';
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {bindBusinessAccount} from '@/lib/workspace-business';
import {browserSupabase} from '@/lib/supabase';
import {workspaceSettingsService} from '@/lib/workspace-settings-client';
import {defaultSettings,normalizePreference,type AccountSettings,type PreferenceSection,type WorkspaceSettings} from '@/lib/workspace-settings';
import {readWorkspacePreferences,type WorkspacePreferences} from '@/lib/workspace-navigation';
import {readAppearance,type Appearance} from '@/lib/workspace-appearance';
const signalKey='onixus-preferences-updated';
export const legacyLayoutKey='onixus-workspace-tools-v1',legacyAppearanceKey='veltra-appearance-v1';
function browserSettings():WorkspaceSettings{
 try{const appearance=JSON.parse(localStorage.getItem(legacyAppearanceKey)||'null');return {layout:readWorkspacePreferences(JSON.parse(localStorage.getItem(legacyLayoutKey)||'null')),appearance:readAppearance(appearance?.theme?appearance:{...appearance,theme:localStorage.getItem('onixus-overview-theme')==='day'?'light':'dark'})};}catch{return defaultSettings();}
}
type SettingsContext=WorkspaceSettings&{userId:string;hasBrowserLayout:boolean;ready:boolean;account:boolean;canSave:boolean;pending:boolean;error:string;hasLayout:boolean;refresh:()=>Promise<void>;saveLayout:(value:WorkspacePreferences)=>Promise<void>;saveAppearance:(value:Appearance)=>Promise<void>;importBrowserLayout:()=>Promise<void>};
const Context=createContext<SettingsContext|null>(null);
export function useWorkspaceSettings(){const value=useContext(Context);if(!value)throw Error('Workspace settings require the shared provider.');return value;}
export default function WorkspaceSettingsProvider({children}:{children:ReactNode}){
 const client=useMemo(()=>browserSupabase(),[]);
 const [state,setState]=useState<AccountSettings>(()=>({...defaultSettings(),userId:'',hasLayout:false,hasAppearance:false}));
 const [ready,setReady]=useState(false),[pending,setPending]=useState(0),[error,setError]=useState(''),[hasBrowserLayout,setHasBrowserLayout]=useState(false);
 const identity=useRef(''),generation=useRef(0),reads=useRef(0),count=useRef(0),versions=useRef({layout:0,appearance:0}),queue=useRef<Promise<void>>(Promise.resolve());
 const clear=useCallback(()=>{generation.current++;reads.current++;identity.current='';count.current=0;setPending(0);setError('');setState({...defaultSettings(),userId:'',hasLayout:false,hasAppearance:false});setReady(true);},[]);
 const refresh=useCallback(async()=>{
  if(count.current)return;
  const version=++reads.current,epoch=generation.current;
  try{
   if(!client){setState({...browserSettings(),userId:'',hasLayout:false,hasAppearance:false});setReady(true);return;}
   const {data,error}=await client.auth.getSession();if(error)throw Error('Sign in again to load your preferences.');
   if(version!==reads.current||epoch!==generation.current)return;
   if(!data.session){bindBusinessAccount('');clear();return;}
   const next=await workspaceSettingsService.load();
   if(version!==reads.current||epoch!==generation.current||count.current)return;
   identity.current=next.userId;bindBusinessAccount(next.userId);setState(next);setError('');setReady(true);
  }catch(e){if(version===reads.current&&epoch===generation.current){setError(e instanceof Error?e.message:'Preferences could not load.');setReady(true);}}
 },[client,clear]);
 useEffect(()=>{
  let live=true;const timers=new Set<ReturnType<typeof setTimeout>>();
  const schedule=()=>{const timer=setTimeout(()=>{timers.delete(timer);if(live)void refresh();},0);timers.add(timer);};
  try{const previous=JSON.parse(localStorage.getItem(legacyLayoutKey)||'null');setHasBrowserLayout(previous?.version===1&&Array.isArray(previous.tools));}catch{}
  void refresh();
  const auth=client?.auth.onAuthStateChange((event,session)=>{
   if(event==='SIGNED_OUT'){bindBusinessAccount('');clear();return;}
   if(event==='SIGNED_IN'){
    if(session?.user.id!==identity.current){clear();setReady(false);}
    schedule();
   }
  });
  const visible=()=>{if(!document.hidden)schedule();};
  const storage=(event:StorageEvent)=>{if(event.key===signalKey||(!client&&(event.key===legacyLayoutKey||event.key===legacyAppearanceKey)))schedule();};
  window.addEventListener('focus',schedule);document.addEventListener('visibilitychange',visible);window.addEventListener('storage',storage);
  return()=>{live=false;generation.current++;reads.current++;for(const timer of timers)clearTimeout(timer);auth?.data.subscription.unsubscribe();window.removeEventListener('focus',schedule);document.removeEventListener('visibilitychange',visible);window.removeEventListener('storage',storage);};
 },[client,clear,refresh]);
 async function save<S extends PreferenceSection>(section:S,input:WorkspaceSettings[S]){
  if(!ready||(client&&!identity.current))throw Error('Load your account preferences before saving.');
  const value=normalizePreference(section,input),epoch=generation.current,userId=identity.current,revision=++versions.current[section];
  reads.current++;setError('');setState(previous=>({...previous,[section]:value}));
  if(!client){try{localStorage.setItem(section==='layout'?legacyLayoutKey:legacyAppearanceKey,JSON.stringify(value));}catch{throw Error('Changes apply to this visit. Browser storage could not save them.');}return;}
  count.current++;setPending(count.current);
  const operation=queue.current.catch(()=>{}).then(async()=>{
   if(epoch!==generation.current||userId!==identity.current)throw Error('Your account changed. Reload preferences before saving.');
   const saved=await workspaceSettingsService.save(userId,section,value as WorkspaceSettings[S]);
   if(epoch!==generation.current||userId!==identity.current)throw Error('Your account changed. Reload preferences before saving.');
   if(saved.userId!==userId||saved.section!==section||JSON.stringify(saved.value)!==JSON.stringify(value))throw Error('Saving preferences could not be confirmed.');
   if(versions.current[section]===revision)setState(previous=>({...previous,[section]:saved.value,[section==='layout'?'hasLayout':'hasAppearance']:true}));
   try{localStorage.setItem(signalKey,crypto.randomUUID());}catch{/* Account persistence does not depend on browser storage. */}
  });
  queue.current=operation;
  try{await operation;}catch(e){if(epoch===generation.current)setError(e instanceof Error?e.message:'Preferences could not be saved.');throw e;}
  finally{if(epoch===generation.current){count.current--;setPending(count.current);}}
 }
 return <Context.Provider value={{...state,hasBrowserLayout,ready,account:!!state.userId,canSave:ready&&(!client||!!state.userId),pending:pending>0,error,refresh,saveLayout:value=>save('layout',value),saveAppearance:value=>save('appearance',value),importBrowserLayout:()=>save('layout',browserSettings().layout)}}>{children}</Context.Provider>;
}
