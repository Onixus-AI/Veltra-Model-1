import {createClient} from '@supabase/supabase-js';
import {crmUser} from './crm/server';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Workspace wallet reads stay scoped to the organization in the verified user token. */
export async function workspaceAccountContext(request:Request){
 const {user}=await crmUser(request);
 const organizationId=user.app_metadata?.org_id??user.app_metadata?.organization_id;
 if(typeof organizationId!=='string'||!UUID.test(organizationId))throw Error('403:This account has no verified organization.');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw Error('503:Workspace account storage is not configured.');
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 return {db,organizationId};
}
