export type CampaignReceipt={id:string;name:string;status:string;config:{daily_limit:number;timezone:string;branding?:{template:import('./campaign-templates').CampaignPillar;visual:string;industry:string}}};
export type MessageReceipt={id:string;campaign_id:string;customer_id?:string;email:string;company:string;subject:string;body:string;step:number;status:string;due_at:string;provider_id:string|null;last_error:string|null};
export type OutreachReceipts={campaigns:CampaignReceipt[];messages:MessageReceipt[];daily?:{day:string;time_zone:string;sent_today:number;approved_due:number;awaiting_review:number;awaiting_receipt:number;needs_attention:number}};
export function outreachResults(state:OutreachReceipts){
 const count=(status:string)=>state.messages.filter(m=>m.status===status).length;
 const draft=count('draft'),approved=count('approved'),sending=count('sending'),sent=count('sent'),stopped=count('stopped'),attention=count('blocked')+count('uncertain');
 const pausedReady=state.campaigns.filter(c=>c.status==='paused'&&state.messages.some(m=>m.campaign_id===c.id&&m.status==='approved'));
 const next=attention?'Inspect delivery issues before taking another action. Uncertain sends must be checked in Sent Mail; do not resend automatically.':draft?'Review each exact draft. Approval prepares a message; it does not activate its campaign.':pausedReady.length?'Approved messages are waiting in a paused campaign. Activate it when you are ready for scheduled delivery.':approved||sending?'Watch the next delivery receipt. Sending windows, account caps, reply stops, and suppression checks still apply.':sent?'Provider receipts are recorded. Review customer replies and next actions in Mail and CRM.':stopped?'Recipients were stopped. A stop may come from an inbound response or an owner action; it is not a confirmed conversion.':'Select relevant customers and create a paused campaign to begin.';
 return {draft,approved,sending,sent,stopped,attention,pausedReady,next};
}
