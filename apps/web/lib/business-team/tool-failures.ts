/** Only aggregate host-recorded tool names; never forward provider errors or private messages. */
export function toolFailureSummary(rows:{tool:string}[]|null){
 if(rows===null)return {available:false,count:null,truncated:false,tools:[]};
 const counts=new Map<string,number>();for(const row of rows.slice(0,500)){const tool=/^[a-z][a-z0-9_]{0,99}$/.test(row.tool)?row.tool:'unknown';counts.set(tool,(counts.get(tool)??0)+1);}
 return {available:true,count:Math.min(rows.length,500),truncated:rows.length>500,tools:[...counts].map(([tool,count])=>({tool,count})).sort((a,b)=>b.count-a.count||a.tool.localeCompare(b.tool))};
}
