type Evidence={tool:string;content:string;failed?:boolean};
/** Keep internal tool instructions and potentially sensitive provider payloads out of fallback prose. */
export function capabilityFailureReply(evidence:Evidence[]):string{
 const failed=evidence.filter(e=>e.failed);
 if(failed.some(e=>e.tool.startsWith('mail_'))){
  const reason=failed.map(e=>e.content).join(' ');
  const next=/Connect Onixus Mail in Connections first/.test(reason)?'Connect Onixus Mail in Workspace → Connections, then try again.':/Sign in to Onixus Workspace again/.test(reason)?'Sign in to Onixus Workspace again, then try again.':'Open Mail to check the connection and approval queue before retrying.';
  return 'The Mail request failed, so I cannot verify the queue or confirm any email was sent. '+next+' Any earlier completed steps remain recorded in Task center.';
 }
 return 'Live capabilities were not verified, so I cannot confirm access or completion. '+(failed.length?'A connected tool failed. Check its result in Task center before retrying.':'No capability-check result was returned. Try the request again.');
}
