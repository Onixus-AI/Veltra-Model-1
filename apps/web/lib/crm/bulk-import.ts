import type {SupabaseClient} from '@supabase/supabase-js';
import {validId} from './chat-actions';
export type ImportRow={company:string;name:string;email:string|null;phone:string;website:string;industry:string;location:string;source:string};
export function importRows(value:unknown):ImportRow[]{
 if(!Array.isArray(value)||!value.length||value.length>500)throw Error('400:Provide 1–500 business contact records.');
 const seen=new Set<string>();return value.map((raw,index)=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error(`400:Check import row ${index+1}.`);
  const r=raw as Record<string,unknown>,allowed=['company','name','email','phone','website','industry','location','source'];if(Object.keys(r).some(k=>!allowed.includes(k)))throw Error('400:Import supports business contact fields only.');
  const text=(key:string,max:number)=>{const v=r[key];if(v!=null&&typeof v!=='string')throw Error(`400:Check ${key} on row ${index+1}.`);const s=String(v??'').trim();if(s.length>max)throw Error(`400:${key} is too long on row ${index+1}.`);return s;};
  const company=text('company',250),email=text('email',254).toLowerCase(),website=text('website',1000),source=text('source',1000);
  if(!company)throw Error(`400:Company required on row ${index+1}.`);if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error(`400:Invalid email on row ${index+1}.`);
  for(const link of [website,source])if(link.startsWith('http')){try{const u=new URL(link);if(u.protocol!=='https:'||u.username||u.password)throw Error();}catch{throw Error(`400:Use public HTTPS source and website URLs on row ${index+1}.`);}}
  if(!source)throw Error(`400:Source required on row ${index+1}; use a published source URL or the supplied filename.`);
  const id=company.toLowerCase()+'|'+email;if(seen.has(id))throw Error(`400:Duplicate record inside the import on row ${index+1}.`);seen.add(id);
  return {company,name:text('name',250),email:email||null,phone:text('phone',100),website,industry:text('industry',200),location:text('location',300),source};
 });
}
export async function prepareImport(client:SupabaseClient,user:string,workspace:unknown,rows:unknown){
 if(!validId(workspace))throw Error('400:Select a business conversation before importing.');const records=importRows(rows);
 const member=await client.from('crm_memberships').select('role').eq('workspace_id',workspace).eq('user_id',user).maybeSingle();if(member.error||!['owner','member'].includes(member.data?.role??''))throw Error('403:Import requires an authorized business editor.');
 const id=crypto.randomUUID();const payload={type:'crm_bulk_import_review',rows:records,expires_at:Date.now()+600000};
 const r=await client.from('crm_conversations').insert({id,user_id:user,workspace_id:workspace,customer_id:null,title:'CRM bulk import review',messages:[{role:'assistant',content:JSON.stringify(payload)}]}).select('id').single();if(r.error)throw Error('503:Import preview could not be saved.');
 return {content:`${records.length} contact records prepared; none imported yet.`,proposal:{id,summary:JSON.stringify({workspace,records:records.length,rows:records,policy:'Add only; existing matching company/email records are skipped. No messages sent, no campaign enrollment and no consent inferred.'},null,2),agent_review:{target:'crm' as const,id}}};
}
