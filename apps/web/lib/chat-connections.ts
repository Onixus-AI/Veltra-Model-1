/** Only explicit requests from the latest user message select a scoped read. */
export function connectionIntent(text:string):string|null{
 const value=text.trim();
 if(/^(?:please\s+)?(?:show|list|check|what are) (?:my |the )?(?:connected tools|connections|connected mcps|mcp connections)[?.!]?$/i.test(value))return 'status';
 if(/^(?:please\s+)?(?:show|list|browse) (?:my |the )?(?:connected )?(?:repository|repo)(?: files| tree)?[?.!]?$/i.test(value))return 'github/tree';
 const file=/^(?:please\s+)?(?:read|open|show) (?:repository |repo )?file\s+([\w./ -]{1,180})$/i.exec(value);
 if(file&&!file[1].split('/').some(p=>p.startsWith('.')||/^(?:credentials|secrets|id_rsa)$/i.test(p))&&!/\.(?:pem|key)$/i.test(file[1]))return 'github/file?path='+encodeURIComponent(file[1]);
 if(/^(?:please\s+)?(?:show|list|check) (?:my |the )?(?:vercel )?deployments[?.!]?$/i.test(value))return 'vercel/deployments';
 const project=/^(?:please\s+)?(?:show|check) (?:my |the )?(supabase|railway|n8n) (?:project|workflow)[?.!]?$/i.exec(value);
 return project?project[1].toLowerCase()+'/project':null;
}
export function connectionSummary(path:string,data:Record<string,unknown>):string{
 if(path==='status'){
  const connections=Array.isArray(data.connections)?data.connections:[];
  return 'Connected developer tools (checked now):\n'+connections.map((c:{provider:string;connected:boolean;selection?:{name?:string}})=>`- ${c.provider}: ${c.connected?'connected':'not connected'}${c.selection?.name?' · '+c.selection.name:''}`).join('\n')+'\n\nUse “Show repository files”, “Read file src/example.ts”, “Show deployments”, or “Show Supabase project”. GitHub can propose a reviewed file change as a draft pull request using its selected repository, file SHA and connection version. Vercel, Supabase, Railway and n8n currently expose the scoped reads listed here; their connected state does not grant additional write permission. CRM commands support contact research, customer tasks, proposed memory and reviewed campaign controls. Bee is available under Connections → LiveAskew / Bee. Custom MCP server registration is not available yet.';
 }
 return 'Live connected tool result · '+path.split('?')[0]+'\n\n```json\n'+JSON.stringify(data,null,2).slice(0,24000)+'\n```';
}
