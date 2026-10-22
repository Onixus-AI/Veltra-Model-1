import type {SupabaseClient} from '@supabase/supabase-js';
import {crmDeadline} from './request';
export async function createWorkspace(client:SupabaseClient,name:string,industry:string){
 name=name.trim();industry=industry.trim();if(!name||name.length>120||!industry||industry.length>120)throw Error('Enter a business name and industry, each up to 120 characters.');
 const {data:id,error}=await crmDeadline(client.rpc('crm_create_workspace',{p_name:name,p_industry:industry}));
 if(error||typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))throw Error('Workspace creation could not be confirmed. Reload the workspace list before trying again.');
 return {id,name,industry};
}
