'use client';
import {browserSupabase} from '@/lib/supabase';
import {gatewayAuthorizationHeaders} from '@/lib/client-session';
export type CrmConnection={connected:boolean;available:boolean;has_workspace:boolean};
export async function crmConnection():Promise<CrmConnection>{
 const response=await fetch('/api/crm/connection',{headers:await gatewayAuthorizationHeaders(),cache:'no-store'});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'CRM connection could not be loaded.');return data;
}
export async function setCrmConnection(connected:boolean){
 const db=browserSupabase();if(!db)throw new Error('Sign in to manage CRM.');
 if(connected)await crmConnection();
 const {error}=await db.auth.updateUser({data:{veltra_crm_connected:connected}});if(error)throw new Error('CRM connection could not be saved. Please try again.');
 window.dispatchEvent(new Event('veltra-connections-changed'));
}
