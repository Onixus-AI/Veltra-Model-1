import {NextRequest} from 'next/server';
import {mailProxy} from '@/lib/mail-proxy';
export const runtime='nodejs';
async function proxy(req:NextRequest,ctx:{params:Promise<{action?:string[]}>}){const path=(await ctx.params).action??[];const action=path.join('/');if(path.length>1||!['','start','catalog','propose-title','apply-title'].includes(action))return Response.json({error:'Unknown Shopify action.'},{status:404});return mailProxy(req,action?`shopify/${action}`:'shopify');}
export const GET=proxy;export const POST=proxy;export const DELETE=proxy;
