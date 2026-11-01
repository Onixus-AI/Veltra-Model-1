#!/usr/bin/env node
import {readBusinessOverview} from './client.mjs';
if(process.argv.includes('--help')){
 console.log(`Read your business overview through the existing Workspace API (Node.js 22+).
Required environment: ONIXUS_ORIGIN, ONIXUS_ACCESS_TOKEN, ONIXUS_WORKSPACE_ID
Optional: ONIXUS_PERIOD=today|week|month (default month)
Run: node examples/read-only-business/read-overview.mjs
Use your own signed-in account token. This example does not obtain or persist credentials.
The request is read-only. Unknown results remain null or absent. Tokens are never printed.`);
}else if(process.argv.length>2){
 console.error('Unsupported arguments. Use --help. Configuration uses environment variables.');process.exitCode=1;
}else{
 try{
  const result=await readBusinessOverview({origin:process.env.ONIXUS_ORIGIN,token:process.env.ONIXUS_ACCESS_TOKEN,workspace:process.env.ONIXUS_WORKSPACE_ID,period:process.env.ONIXUS_PERIOD||'month'});
  console.log(JSON.stringify({workspace:result.workspace,period:result.period,range:result.range,completed:result.completed??null,metrics:result.overview.metrics,unknowns:result.overview.unknowns??null},null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
