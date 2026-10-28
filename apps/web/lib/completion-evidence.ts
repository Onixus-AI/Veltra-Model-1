/** Host guard: model prose cannot turn a read, failed call or declined review into a write receipt. */
export function completionClaim(text:string){
 const actions='sent|saved|cleared|created|updated|deleted|scheduled|booked|completed';
 const subject='queue|messages?|emails?|document|spreadsheet|event|changes?|they|it|everything';
 const verbs='has|have|had|is|are|was|were|been|already|now|successfully|all';
 const clean=text.replace(new RegExp('\\b(?:no|none of the)\\s+(?:'+subject+')\\s+(?:(?:'+verbs+')\\s+){0,6}(?:'+actions+')\\b','gi'),'');
 return new RegExp('\\b(?:I(?:\\x27ve| have)?|we(?:\\x27ve| have)?)\\s+(?:(?:successfully|already|now)\\s+)?(?:'+actions+')\\b|\\b(?:'+subject+')\\s+(?:(?:'+verbs+')\\s+){0,6}(?:'+actions+')\\b','i').test(clean);
}
export function verifiedAnswer(answer:string,evidence:{tool:string;content:string;failed?:boolean}[]){
 if(!completionClaim(answer))return answer;
 const receipts=evidence.filter(e=>!e.failed).flatMap(e=>{
  try{const r=JSON.parse(e.content);if(r.status==='completed'&&((['google_create_file','google_edit_file','calendar_change'].includes(e.tool)&&r.approval==='confirmed'&&r.receipt)||(e.tool==='mail_health'&&r.action==='reconcile_sent_approvals'&&typeof r.operation_id==='string'&&Number.isInteger(r.cleared)&&Number.isInteger(r.remaining))))return [{tool:e.tool,receipt:r}];}catch{/* Unstructured prose cannot prove a completed mutation. */}return [];
 });
 if(!receipts.length)return 'I cannot verify that anything was sent, saved or changed in this turn. No completed-action receipt was returned. Check the tool results; unresolved actions remain unverified.';
 // Display authoritative counts/results instead of trusting a model's broader completion claim.
 return 'Verified action receipts:\n\n'+receipts.map(r=>JSON.stringify(r)).join('\n\n')+'\n\nThese receipts prove only the listed operations. Mail provider acceptance does not prove delivery; unresolved queue entries remain queued.';
}
