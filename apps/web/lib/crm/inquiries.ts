import type {SupabaseClient} from '@supabase/supabase-js';
import {crmDeadline} from './request';
export type Inquiry={id:string;workspace_id:string;customer_id:string;subject:string;message:string;source:string;status:'new'|'reviewing'|'closed';received_at:string;created_at:string};
export type InquiryDraft=Pick<Inquiry,'id'|'subject'|'message'|'source'|'received_at'>;
const fields='id,workspace_id,customer_id,subject,message,source,status,received_at,created_at';
export function inquiryDraft(draft:InquiryDraft){
 if(!/^[a-f0-9-]{36}$/i.test(draft.id)||!draft.subject.trim()||draft.subject.length>200||!draft.message.trim()||draft.message.length>4000||!['phone','email','website','referral','other'].includes(draft.source)||!Number.isFinite(Date.parse(draft.received_at)))throw Error('Check the enquiry subject, message, source and received date.');
 return {...draft,subject:draft.subject.trim(),message:draft.message.trim(),received_at:new Date(draft.received_at).toISOString()};
}
export function inquiryService(client:SupabaseClient){
 const rows=(workspace:string,customer:string)=>client.from('crm_inquiries').select(fields).eq('workspace_id',workspace).eq('customer_id',customer);
 return {
  async list(workspace:string,customer:string,signal:AbortSignal){
   const {data:auth,error:authError}=await crmDeadline(client.auth.getSession(),signal);if(authError||!auth.session)throw Error('Sign in again to read enquiries.');
   const [list,member]=await crmDeadline(Promise.all([
    rows(workspace,customer).order('created_at',{ascending:false}).order('id').limit(20).abortSignal(signal),
    client.from('crm_memberships').select('role').eq('workspace_id',workspace).eq('user_id',auth.session.user.id).abortSignal(signal).maybeSingle()
   ]),signal);
   if(list.error){if(['42P01','PGRST205'].includes(list.error.code))throw Error('Enquiries need the database update before they can be used.');throw Error('Enquiries could not be loaded. Refresh to try again.');}
   if(member.error||!member.data)throw Error('Workspace access could not be verified.');
   return {items:(list.data??[]) as Inquiry[],canWrite:['owner','member'].includes(member.data.role)};
  },
  async create(workspace:string,customer:string,value:InquiryDraft){
   const draft=inquiryDraft(value),row={...draft,workspace_id:workspace,customer_id:customer};
   const saved=await crmDeadline(client.from('crm_inquiries').insert(row).select(fields).single());
   if(saved.error){
    // Retrying the same form uses the same ID. A lost receipt must not duplicate intake.
    if(saved.error.code==='23505'){
     const prior=await crmDeadline(rows(workspace,customer).eq('id',draft.id).maybeSingle()),receipt=prior.data;
     if(!prior.error&&receipt&&(['subject','message','source'] as const).every(key=>receipt[key]===row[key])&&Date.parse(receipt.received_at)===Date.parse(draft.received_at))return receipt as Inquiry;
    }
    throw Error('Enquiry save could not be confirmed. Your entries are retained. Recheck enquiries before retrying.');
   }
   if(!saved.data)throw Error('No enquiry receipt was returned. Refresh before retrying.');return saved.data as Inquiry;
  },
  async status(workspace:string,customer:string,item:Inquiry,next:Inquiry['status']){
   if(!['new','reviewing','closed'].includes(next))throw Error('Choose a valid enquiry status.');
   const result=await crmDeadline(client.from('crm_inquiries').update({status:next}).eq('workspace_id',workspace).eq('customer_id',customer).eq('id',item.id).eq('status',item.status).select(fields).maybeSingle());
   if(result.error||!result.data)throw Error('Enquiry changed or access was denied. Refresh before trying again.');return result.data as Inquiry;
  }
 };
}
export type InquiryService=ReturnType<typeof inquiryService>;
