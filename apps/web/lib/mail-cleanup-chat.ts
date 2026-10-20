/** Only the latest explicit user message may request an action. */
export function cleanupIntent(text:string) {
  const value=text.trim();
  const confirm=/^confirm cleanup ([a-f0-9]{32})[.!]?$/i.exec(value);
  if(confirm)return {action:'confirm_cleanup' as const,ticket:confirm[1].toLowerCase()};
  const preview=/^(?:please\s+)?(?:delete|trash|preview|find|show)(?: all)? (?:emails|messages)(?: that are)? (?:not in (?:a|any|a custom|any custom) folder|without (?:a |any )?(?:custom )?(?:folder|labels?))(?: that (?:are|is))? (?:over|older than) (\d+) days(?: old)?(?:[,.]? (?:and )?(?:exclude|excluding) starred(?: (?:emails|messages))?)?[.!]?$/i.exec(value);
  if(!preview)return null;
  const days=Number(preview[1]);
  if(days<1||days>36500)return null;
  return {action:'preview_cleanup' as const,days,exclude_starred:/exclud(?:e|ing) starred/i.test(value)};
}
const safeCell=(value:unknown)=>String(value??'').replace(/[\r\n|<>\[\]`*_\\]/g,' ').slice(0,160);
export function cleanupSummary(data:Record<string,any>) {
  if(data.kind==='cleanup_result')return `Cleanup finished: ${data.moved.length} moved to Trash, ${data.skipped.length} skipped because they no longer qualified, ${data.uncertain.length} uncertain, ${(data.not_attempted??[]).length} not attempted because the time limit was reached.\n\n${data.scope}`;
  if(data.kind!=='cleanup_preview')throw new Error('Missing cleanup receipt.');
  const rows=data.items.map((e:{from:string;subject:string;date:string})=>`| ${safeCell(e.from)} | ${safeCell(e.subject)} | ${safeCell(e.date)} |`).join('\n');
  return `Cleanup preview: **${data.count} emails** received before ${data.before}.\n\n${data.scope}\n\n${data.more?'More matches exist. This confirmation covers only the emails below. Request another preview after completing this batch.\n\n':''}${rows?'| From | Subject | Received |\n|---|---|---|\n'+rows+'\n\n':''}${data.ticket?`To move exactly this selection to Trash, send:\n\nConfirm cleanup ${data.ticket}\n\nThis single-use preview expires at ${data.expires_at}. Eligibility is checked again before moving each email.`:'No matching emails were found.'}`;
}
