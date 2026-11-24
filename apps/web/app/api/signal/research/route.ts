import {researchGateway} from '../../../../lib/signal/research-gateway';
export const runtime='nodejs';
export const maxDuration=180;
export const dynamic='force-dynamic';
export async function POST(req:Request){return researchGateway(req,process.env.FIRECRAWL_API_KEY);}
