import {usageActivity} from '@/lib/usage-activity';
import { NextRequest } from "next/server";
import {workspaceAccountContext} from '@/lib/workspace-account';
import {workspaceUsageReport} from '@/lib/workspace-usage-report';
import {crmError} from '@/lib/crm/server';

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
 try{
  const {db,organizationId}=await workspaceAccountContext(request);
  const month=request.nextUrl.searchParams.get('month')??new Date().toISOString().slice(0,7);
  const day=request.nextUrl.searchParams.get('day');
  const body=await workspaceUsageReport(db,organizationId,month,day);
  const observed=await usageActivity(request,body);
  return Response.json({...body,...observed},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return crmError(error);}
}
