'use client';
import {gatewayAuthorizationHeaders} from './client-session';
export async function checkSetupMail(signal:AbortSignal):Promise<boolean>{
 const response=await fetch('/api/mail/link',{headers:await gatewayAuthorizationHeaders(),cache:'no-store',signal});
 if(!response.ok)throw Error('Mail connection could not be checked.');
 const data=await response.json();
 if(typeof data?.connected!=='boolean')throw Error('Mail returned no connection status.');
 return data.connected;
}
