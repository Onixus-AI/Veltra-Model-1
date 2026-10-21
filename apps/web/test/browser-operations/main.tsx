import PipelineBoard, {type PipelineFilter} from '../../components/crm/pipeline-board';
import CustomerDialog from '../../components/crm/customer-dialog';
import '../../styles/veltra-theme.css';
import Outreach from '../../components/crm/outreach';
import Workspace from '../../components/crm/workspace';
import '../../app/crm/crm.css';
import type {Operations} from '../../lib/crm/operations';
import CrmDashboard from '../../components/crm/command-dashboard';
import {previewData} from '../../lib/crm/preview';
import '../../components/crm/command-dashboard.css';
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import OperationsCenter from '../../components/crm/operations-center';
import '../../components/crm/operations.css';

function DialogFixture(){const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');return <main className="crm-shell" style={{display:'block'}}><button onClick={()=>{setError('');setOpen(true);}}>Add test customer</button><output>{saved}</output>{open&&<CustomerDialog busy={busy} error={error} onClose={()=>setOpen(false)} onSubmit={async event=>{event.preventDefault();const f=new FormData(event.currentTarget);setBusy(true);setError('');await new Promise(resolve=>setTimeout(resolve,350));setBusy(false);if(f.get('company')==='Retry Studio'){setError('The customer could not be saved.');return;}setSaved(String(f.get('company')));setOpen(false);}}/>}</main>;}

function CurrencyFixture(){const [filter,setFilter]=useState<PipelineFilter>('all');const data={...previewData,deals:[previewData.deals[0],{...previewData.deals[1],stage:'proposal' as const,currency:'EUR'}]};return <main className="crm-shell" style={{display:'block'}}><PipelineBoard data={data} filter={filter} onFilter={setFilter} onCustomer={()=>{}}/></main>;}
function Fixture(){const [operations,setOperations]=useState<Operations|null>(null);const [workspace,setWorkspace]=useState('00000000-0000-4000-8000-000000000001');return location.search.includes('pipeline-currencies')?<CurrencyFixture/>:location.search.includes('dialog')?<DialogFixture/>:location.search.includes('outreach')?<main className="crm-shell" style={{display:'block',background:'#000'}}><div className="crm-content"><Outreach workspace={previewData.customers[0].workspace_id} customers={previewData.customers} initialCustomer={previewData.customers[0].id} preview={false}/></div></main>:location.search.includes('shell')?<Workspace preview/>:location.search.includes('dashboard')?<main style={{maxWidth:1180,margin:'24px auto'}}><CrmDashboard activity={<OperationsCenter workspace={workspace} minimal compact onSnapshot={setOperations}/>} operations={operations} data={previewData} preview onCustomer={id=>document.getElementById('destination')!.textContent=id} onPipeline={()=>{}} onConnections={()=>{}}/><output id="destination"/></main>:<main style={{maxWidth:1180,margin:'24px auto'}}><label>Test business<select value={workspace} onChange={e=>setWorkspace(e.target.value)}><option value="00000000-0000-4000-8000-000000000001">First</option><option value="00000000-0000-4000-8000-000000000002">Second</option></select></label><OperationsCenter workspace={workspace} compact={location.search.includes('compact')} currentTask={location.search.includes('working')?'Reading the connected customer record':''} onNavigate={destination=>document.getElementById('destination')!.textContent=destination}/><output id="destination"/></main>;}
document.body.style.background='#000';document.body.style.color='#edf9fb';document.body.style.margin='16px';
createRoot(document.getElementById('root')!).render(<Fixture/>);
