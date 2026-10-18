export const stages = ['new','qualified','meeting','proposal','won','lost'] as const;
export type Stage = typeof stages[number];
export type Customer = {id:string; workspace_id:string; company:string; name:string; email:string|null; industry:string; phone?:string;website?:string;location?:string;job_title?:string;record_type?:'company'|'person'|'influencer';identity_review_required?:boolean; source:string; suppressed:boolean; created_at:string};
export type Deal = {id:string;workspace_id:string;customer_id:string;title:string;stage:Stage;value_cents:number;currency:string;created_at:string};
export type Task = {id:string;workspace_id:string;customer_id:string;title:string;due_at:string|null;status:'open'|'done';created_at:string};
export type Memory = {id:string;workspace_id:string;customer_id:string;content:string;source:string;status:'proposed'|'approved'|'rejected';expires_at:string|null;created_at:string};
export type Activity = {id:string;workspace_id:string;customer_id:string;kind:string;title:string;created_at:string};
export type Snapshot = {customers:Customer[];deals:Deal[];tasks:Task[];memories:Memory[];activities:Activity[]};
export const empty:Snapshot={customers:[],deals:[],tasks:[],memories:[],activities:[]};
export function overview(s:Snapshot, now=Date.now()) {
 const open=s.deals.filter(d=>!['won','lost'].includes(d.stage));
 return {customers:s.customers.length,pipeline:open.filter(d=>d.currency==='USD').reduce((sum,d)=>sum+d.value_cents,0),won:s.deals.filter(d=>d.stage==='won').length,overdue:s.tasks.filter(t=>t.status==='open'&&t.due_at&&Date.parse(t.due_at)<now).length};
}
export function contextFor(s:Snapshot,workspace:string,customer:string,now=Date.now()) {
 const account=s.customers.find(c=>c.workspace_id===workspace&&c.id===customer);
 if(!account) throw new Error('Customer is not in this workspace.');
 return {customer:account,memories:s.memories.filter(m=>m.workspace_id===workspace&&m.customer_id===customer&&m.status==='approved'&&(!m.expires_at||Date.parse(m.expires_at)>now)),open_tasks:s.tasks.filter(t=>t.workspace_id===workspace&&t.customer_id===customer&&t.status==='open'),deals:s.deals.filter(d=>d.workspace_id===workspace&&d.customer_id===customer),recent_activity:s.activities.filter(a=>a.workspace_id===workspace&&a.customer_id===customer).slice(0,20)};
}
export function recommendations(s:Snapshot,c:Customer) {
 const tasks=s.tasks.filter(t=>t.customer_id===c.id&&t.status==='open');
 if(c.suppressed) return ['Outreach is suppressed. Review the customer record before any contact.'];
 const deals=s.deals.filter(d=>d.customer_id===c.id);
 if(deals.some(d=>d.stage==='won')) return tasks.length?['Complete the outstanding customer tasks.']:['Confirm payment and service scope before starting onboarding.'];
 if(!tasks.length) return ['Assign a next action and a due date.'];
 if(!deals.length) return ['Qualify the customer’s needs, then add an opportunity.'];
 return ['Review the next action and move the opportunity when the customer confirms progress.'];
}
export function dollars(cents:number) {return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(cents/100);}

