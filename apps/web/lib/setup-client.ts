'use client';
import type {SupabaseClient} from '@supabase/supabase-js';
import {browserSupabase} from './supabase';
import {readSetup,setupProfile,SETUP_KEY,type SetupProfile} from './setup-profile';
export type SetupService={load:()=>Promise<SetupProfile|null>;save:(profile:SetupProfile)=>Promise<SetupProfile>};
export async function loadSetup(client:SupabaseClient|null=browserSupabase()){
 if(!client)throw Error('Sign in to save your setup.');
 const {data,error}=await client.auth.getUser();if(error||!data.user||data.user.is_anonymous)throw Error('Sign in again to load your setup.');
 return readSetup(data.user.user_metadata?.[SETUP_KEY]);
}
export async function saveSetup(profile:SetupProfile,client:SupabaseClient|null=browserSupabase()){
 if(!client)throw Error('Sign in to save your setup.');
 const next=setupProfile(profile);
 const identity=await client.auth.getUser();if(identity.error||!identity.data.user||identity.data.user.is_anonymous)throw Error('Sign in again to save your setup.');
 // SDK merges this preference key. No account identity, app_metadata, credentials,
 // membership, connection state or action approvals can be submitted here.
 const {data,error}=await client.auth.updateUser({data:{[SETUP_KEY]:next}});
 const stored=readSetup(data.user?.user_metadata?.[SETUP_KEY]);
 if(error||data.user?.id!==identity.data.user.id||!stored||JSON.stringify(stored)!==JSON.stringify(next))throw Error('Setup could not be confirmed as saved. Try again.');
 return stored;
}
export const setupService:SetupService={load:()=>loadSetup(),save:profile=>saveSetup(profile)};
