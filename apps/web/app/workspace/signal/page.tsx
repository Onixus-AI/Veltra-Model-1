import {redirect} from 'next/navigation';
// Signal tools that Workspace may open directly (allow-listed).
const OPEN=new Set(['design-studio']);
export default async function SignalPage({searchParams}:{searchParams:Promise<{workspace?:string;open?:string}>}){const {workspace,open}=await searchParams;redirect('/?canvas=signal&mode=business'+(workspace&&/^[0-9a-f-]{36}$/i.test(workspace)?'&crm_workspace='+encodeURIComponent(workspace):'')+(open&&OPEN.has(open)?'&signal_open='+open:''));}
