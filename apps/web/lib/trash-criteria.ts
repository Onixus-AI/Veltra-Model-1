export type TrashCriteria={instruction:string;mailbox:string|null;cutoff:string;date_basis:string};
/** Deliberately accepts a complete direct command, never quoted/hypothetical mail text. */
export function trashCriteria(text:string,now=new Date()):TrashCriteria|null{
 if(text.length>1500||/[\r\n]/.test(text))return null;
 const command=text.trim().replace(/^Veltra[, :]\s*/i,'').replace(/^please\s+/i,'').replace(/[.!]$/,'');
 const match=/^(?:delete|trash|move to trash) all (?:my |our )?(?:emails?|messages|mail)(?: in (?:mailbox )?([^\s]+@[^\s]+))? (?:older than (\d{1,5}) (days?|months?|years?)|before (\d{4}-\d{2}-\d{2}))(?: in (?:mailbox )?([^\s]+@[^\s]+))?$/i.exec(command);
 if(!match||match[1]&&match[5])return null;
 const mailbox=(match[1]||match[5]||'').toLowerCase()||null;
 if(mailbox&&!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(mailbox))return null;
 let cutoff:Date;
 if(match[4]){cutoff=new Date(match[4]+'T00:00:00Z');if(!Number.isFinite(cutoff.getTime())||cutoff.toISOString().slice(0,10)!==match[4])return null;}
 else{
  const n=Number(match[2]),unit=match[3].toLowerCase();if(n<1||n>(unit.startsWith('year')?100:unit.startsWith('month')?1200:36500))return null;
  cutoff=new Date(Math.floor(now.getTime()/1000)*1000);
  if(unit.startsWith('day'))cutoff.setUTCDate(cutoff.getUTCDate()-n);
  else{const day=cutoff.getUTCDate();cutoff.setUTCDate(1);cutoff.setUTCMonth(cutoff.getUTCMonth()-n*(unit.startsWith('year')?12:1));const last=new Date(Date.UTC(cutoff.getUTCFullYear(),cutoff.getUTCMonth()+1,0)).getUTCDate();cutoff.setUTCDate(Math.min(day,last));}
 }
 if(cutoff.getTime()>=now.getTime())return null;
 return {instruction:text.trim(),mailbox,cutoff:cutoff.toISOString(),date_basis:'Strictly before cutoff (UTC). Gmail internal receipt time; Outlook receivedDateTime. Relative years/months use UTC calendar subtraction; dates mean 00:00 UTC.'};
}

export function cleanupReference(text:string){const match=/^(?:please )?(show|check|retry) (?:mail )?cleanup ([a-f0-9-]{36})[.!]?$/i.exec(text.trim());return match?{retry:match[1].toLowerCase()==='retry',id:match[2]}:null;}
