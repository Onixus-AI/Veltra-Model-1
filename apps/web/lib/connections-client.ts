"use client";
import {gatewayAuthorizationHeaders} from "./client-session";
export type Provider="github"|"vercel"|"supabase"|"railway"|"n8n";
export type WorkspaceConnection={provider:Provider;connected:boolean;configured:boolean;account:{name?:string};selection:{id?:string;name?:string;branch?:string;team?:string}};
export async function connectionRequest<T>(path:string,method="GET",body?:object):Promise<T>{
 const response=await fetch(`/api/connections/${path}`,{method,headers:{...await gatewayAuthorizationHeaders(),"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined,cache:"no-store"});
 const data=await response.json().catch(()=>{throw new Error("Workspace connections are temporarily unavailable. Please try again shortly.");});if(!response.ok)throw new Error(data.error??"Could not complete this connection request.");return data as T;
}
