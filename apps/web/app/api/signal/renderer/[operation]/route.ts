import {privateRenderer} from '../../../../../lib/signal/private-renderer';
export const runtime='nodejs';
export const maxDuration=180;
export const dynamic='force-dynamic';
type Context={params:Promise<{operation:string}>};
export async function GET(req:Request,context:Context){return privateRenderer(req,(await context.params).operation);}
export async function POST(req:Request,context:Context){return privateRenderer(req,(await context.params).operation);}
