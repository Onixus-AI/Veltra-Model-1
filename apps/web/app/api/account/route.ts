import { NextRequest } from "next/server";
import { workspaceAccountContext } from "@/lib/workspace-account";
import {crmError} from '@/lib/crm/server';

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
 try{
  const {db,organizationId}=await workspaceAccountContext(request);
  const wallet=await db.from('credit_wallets').select('plan_name,monthly_price_cents,credits_remaining,monthly_credit_allowance,billing_period_end').eq('organization_id',organizationId).maybeSingle();
  if(wallet.error)throw Error('503:Workspace balance could not be read.');
  if(!wallet.data)throw Error('404:Credit wallet not found.');
  const since=new Date(Date.now()-30*86_400_000).toISOString();
  const transactions=await db.from('credit_transactions').select('amount,created_at').eq('organization_id',organizationId).lt('amount',0).gte('created_at',since).order('created_at',{ascending:true}).limit(10000);
  if(transactions.error)throw Error('503:Workspace credit history could not be read.');
  const daily=new Map<string,number>();
  for(const row of transactions.data??[]){
   const day=row.created_at.slice(0,10);
   daily.set(day,(daily.get(day)??0)+Math.abs(row.amount));
  }
  return Response.json({...wallet.data,api_key_prefix:null,consumption:[...daily].map(([date,credits])=>({date,credits}))},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return crmError(error);}
}
