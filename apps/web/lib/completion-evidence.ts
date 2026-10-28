/** Host guard: model prose cannot turn a read, failed call or declined review into a write receipt. */
export function completionClaim(text:string){
 return /\b(?:I(?:'ve| have)?|we(?:'ve| have)?)\s+(?:(?:successfully|already|now)\s+)?(?:sent|saved|cleared|created|updated|deleted|scheduled|booked|completed)\b|\b(?:queue|messages?|emails?|document|spreadsheet|event|changes?)\s+(?:has |have )?(?:been )?(?:successfully )?(?:sent|saved|cleared|created|updated|deleted|scheduled|booked|completed)\b/i.test(text);
}
export function verifiedAnswer(answer:string,evidence:{tool:string;content:string;failed?:boolean}[]){
 if(!completionClaim(answer))return answer;
 const receipts=evidence.filter(e=>!e.failed).flatMap(e=>{
  try{const r=JSON.parse(e.content);if(r.status==='completed'&&(r.approval==='confirmed'||r.action==='reconcile_sent_approvals')&&(r.receipt||r.operation_id))return [{tool:e.tool,receipt:r}];}catch{/* Unstructured prose cannot prove a completed mutation. */}return [];
 });
 if(!receipts.length)return 'I cannot verify that anything was sent, saved or changed in this turn. No completed-action receipt was returned. Check the tool results; unresolved actions remain unverified.';
 // Display authoritative counts/results instead of trusting a model's broader completion claim.
 return 'Verified action receipts:\n\n'+receipts.map(r=>JSON.stringify(r)).join('\n\n')+'\n\nThese receipts prove only the listed operations. Mail provider acceptance does not prove delivery; unresolved queue entries remain queued.';
}
