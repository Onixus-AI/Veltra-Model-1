import {redirect} from 'next/navigation';
export default async function SignalPage({searchParams}:{searchParams:Promise<{workspace?:string}>}){const {workspace}=await searchParams;redirect('/?canvas=signal&mode=business'+(workspace&&/^[0-9a-f-]{36}$/i.test(workspace)?'&crm_workspace='+encodeURIComponent(workspace):''));}
