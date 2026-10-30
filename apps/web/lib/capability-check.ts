/** A model's own promise or capability assertion cannot substitute for a live tool result. */
export function needsCapabilityCheck(answer:string,evidence:{tool:string;content:string;failed?:boolean}[],request=''){
 const checked=evidence.some(e=>!e.failed&&['onyx_capabilities','veltra_capabilities'].includes(e.tool)&&(()=>{try{const r=JSON.parse(e.content);return r!==null&&typeof r==='object'&&!r.error&&['mail','crm','actions','platform','google','calendar'].some(k=>k in r);}catch{return false;}})());
 if(checked)return false;
 const domain=/\b(?:capabilit\w*|live contract|tools?|connected apps?|mail|inbox|crm|signal|permissions?|access)\b/i.test(answer+' '+request);
 const promise=/\b(?:let me|I(?:'ll| will| am|'m))\s+(?:(?:actually|first|now|just)\s+)*(?:check|verify|inspect|look up)\b/i.test(answer);
 const claim=/\bI\s+(?:can(?:not|'t)?|have|lack|don'?t have|do not have|am unable)\b/i.test(answer);
 return domain&&(promise||claim);
}
