'use client';
import {agentToolRequest,type WriteProposal,type ToolOutcome} from './chat-tools';
import type {TaskAccessClient} from './task-access-client';
import type {TaskObserver} from './task-progress';
export const FOLLOWUP_PROMPT='Find customers who need a follow-up and prepare drafts.';
function address(value:unknown){if(typeof value!=='string')return null;const match=/^(?:[^<>]*<)?([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>?$/.exec(value.trim());return match?.[1].toLowerCase()??null;}
export function followupEvidence(records:unknown,page:unknown){
 if(!page||typeof page!=='object'||!Array.isArray((page as any).items)||((page as any).next_cursor!=null&&typeof (page as any).next_cursor!=='string'))throw Error('Mail returned an incomplete candidate receipt. No drafts were requested.');
 const customers=Array.isArray(records)?records:[],data=page as {items:Record<string,unknown>[];next_cursor?:string|null;scope?:unknown};
 const items=data.items.slice(0,25);const lines=items.map(item=>{const email=address(item.to),matches=email?customers.filter(c=>c&&typeof c==='object'&&address(c.email)===email):[];const customer=matches.length===1?matches[0]:null;return `${String(item.subject??'Quote').slice(0,160)} — ${String(item.to??'Recipient unavailable').slice(0,180)}${customer?` · CRM: ${String(customer.company??'Customer').slice(0,100)}${customer.suppressed?' (outreach stopped)':''}`:' · No unique match in the returned CRM records'}`;});
 return {count:items.length,more:Boolean(data.next_cursor),summary:`Checked one page of ${items.length} unanswered priced-quote candidate(s). CRM matching uses only the customer records returned for this business (up to 100). No response is not evidence of a lost customer.\n\n${lines.join('\n')||'No matching quotes on this page.'}\n\n${String(data.scope??'Connected mailbox; current page only.').slice(0,500)}${data.next_cursor?' More pages are available in Mail.':''}`};
}
export async function runFollowupTask(context:Record<string,unknown>,confirm:(proposal:WriteProposal)=>Promise<boolean>,access:TaskAccessClient,observer:TaskObserver):Promise<string>{
 if((context.crm_scope as any)?.customer_id)throw Error('Choose All customers in a business conversation first. Draft preparation uses the connected mailbox, not one selected customer.');
 const check=()=>{if(observer.cancelled())throw Error('Pending task work was stopped.');};
 const read=async(id:string,title:string,app:string,name:string,args:Record<string,unknown>)=>{check();observer.event({type:'step',id,title,app});const result=await agentToolRequest(name,args,context,undefined,access);return result;};
 const customers=await read('crm','Read customer records','CRM','crm_read',{action:'customers'});if(!Array.isArray(customers.data))throw Error('CRM returned no customer-list receipt. No drafts were requested.');
 observer.event({type:'result',id:'crm',state:'completed',detail:`${customers.data.length} customer record(s) returned for matching. Up to 100 records, in the selected business. No CRM records changed.`});
 const quotes=await read('quotes','Check unanswered quotes and CRM matches','Mail','mail_find_followups',{});let page;try{page=JSON.parse(quotes.content);}catch{throw Error('Mail returned no readable candidate receipt. No drafts were requested.');}
 const evidence=followupEvidence(customers.data,page);observer.event({type:'result',id:'quotes',state:'completed',detail:evidence.summary});
 if(!evidence.count)return evidence.summary+'\n\nNo draft preparation was requested.';
 const preparation=await read('drafts','Prepare follow-up drafts','Mail','mail_prepare_followups',{});if(!preparation.proposal?.agent_review||preparation.proposal.agent_review.target!=='mail')throw Error('No Mail preparation review was returned. No draft action was applied.');
 const proposal={...preparation.proposal,summary:`Review mailbox-wide draft preparation. Mail checks its current overdue rules and scans up to five candidates in this pass. This action is not restricted to the CRM matches shown above. Displayed candidates and prepared drafts may differ. Drafts enter Mail's approval queue; this action never sends email.\n\n${preparation.proposal.summary}`};
 observer.event({type:'review',id:'drafts',detail:proposal.summary});check();const approved=await confirm(proposal);check();
 if(!approved){observer.event({type:'result',id:'drafts',state:'skipped',detail:'Draft preparation declined. No preparation action was called.'});return evidence.summary+'\n\nDraft preparation was declined. Nothing was sent.';}
 observer.event({type:'step',id:'drafts',title:'Prepare follow-up drafts','app':'Mail'});
 const receipt:ToolOutcome=await agentToolRequest('confirm',{},context,proposal.agent_review,access);let data;try{data=JSON.parse(receipt.content);}catch{throw Error('Draft preparation returned no readable receipt. Check Mail before starting another request.');}
 if(!Array.isArray(data?.drafted))throw Error('Draft preparation could not be confirmed. Check Mail before starting another request.');
 observer.event({type:'result',id:'drafts',state:'completed',detail:`${data.drafted.length} draft receipt(s) returned. Open Mail → Approval queue to review. No email was sent by this action.\n\n${String(data.scope??'Mail overdue scan; up to five candidates per pass.').slice(0,500)}${data.next_cursor?' More candidates remain for a later pass.':''}`});
 return `${evidence.summary}\n\nMail returned ${data.drafted.length} draft receipt(s). Open Mail → Approval queue to review before sending. Preparation used Mail's mailbox-wide overdue scan, not only the displayed CRM matches. No email was sent by this action.`;
}
