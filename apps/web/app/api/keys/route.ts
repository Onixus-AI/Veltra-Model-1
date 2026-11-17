import {createHash,randomBytes} from 'node:crypto';
import {NextRequest} from 'next/server';
import {crmError} from '@/lib/crm/server';
import {workspaceAccountContext} from '@/lib/workspace-account';

export const runtime='nodejs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request:NextRequest){
 try{
  const {db,organizationId}=await workspaceAccountContext(request);
  const {data,error}=await db.from('api_keys').select('id,name,key_prefix,created_at,last_used_at').eq('organization_id',organizationId).is('revoked_at',null).order('created_at',{ascending:false});
  if(error)throw Error('503:Developer keys could not be read.');
  return Response.json((data??[]).map(key=>({...key,is_current:false})),{headers:{'Cache-Control':'no-store'}});
 }catch(error){return crmError(error);}
}

export async function POST(request:NextRequest){
 try{
  const {db,organizationId}=await workspaceAccountContext(request);
  const body=await request.json().catch(()=>null);
  const name=typeof body?.name==='string'?body.name.trim():'';
  if(!name||name.length>80)throw Error('422:API key name must be 1–80 characters.');
  const secret=`veltra_sk_${randomBytes(32).toString('base64url')}`;
  const keyHash=createHash('sha256').update(secret).digest('hex');
  const {data,error}=await db.from('api_keys').insert({organization_id:organizationId,name,key_prefix:secret.slice(0,19),key_hash:keyHash}).select('id,name,key_prefix,created_at,last_used_at').single();
  if(error||!data)throw Error('503:Could not create API key.');
  return Response.json({...data,api_key:secret,is_current:false},{status:201,headers:{'Cache-Control':'no-store'}});
 }catch(error){return crmError(error);}
}

export async function DELETE(request:NextRequest){
 try{
  const {db,organizationId}=await workspaceAccountContext(request);
  const id=request.nextUrl.searchParams.get('id');
  if(!id||!UUID.test(id))throw Error('400:A valid API key ID is required.');
  const {data,error}=await db.from('api_keys').update({revoked_at:new Date().toISOString()}).eq('id',id).eq('organization_id',organizationId).is('revoked_at',null).select('id').maybeSingle();
  if(error)throw Error('503:Could not revoke API key.');
  if(!data)throw Error('404:API key not found.');
  return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
 }catch(error){return crmError(error);}
}
