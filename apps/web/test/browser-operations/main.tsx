import type {Operations} from '../../lib/crm/operations';
import CrmDashboard from '../../components/crm/command-dashboard';
import {previewData} from '../../lib/crm/preview';
import '../../components/crm/command-dashboard.css';
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import OperationsCenter from '../../components/crm/operations-center';
import '../../components/crm/operations.css';
function Fixture(){const [operations,setOperations]=useState<Operations|null>(null);const [workspace,setWorkspace]=useState('00000000-0000-4000-8000-000000000001');return location.search.includes('dashboard')?<main style={{maxWidth:1180,margin:'24px auto'}}><OperationsCenter workspace={workspace} compact onSnapshot={setOperations}/><CrmDashboard operations={operations} data={previewData} preview onCustomer={id=>document.getElementById('destination')!.textContent=id} onPipeline={()=>{}} onConnections={()=>{}}/><output id="destination"/></main>:<main style={{maxWidth:1180,margin:'24px auto'}}><label>Test business<select value={workspace} onChange={e=>setWorkspace(e.target.value)}><option value="00000000-0000-4000-8000-000000000001">First</option><option value="00000000-0000-4000-8000-000000000002">Second</option></select></label><OperationsCenter workspace={workspace} compact={location.search.includes('compact')} currentTask={location.search.includes('working')?'Reading the connected customer record':''} onNavigate={destination=>document.getElementById('destination')!.textContent=destination}/><output id="destination"/></main>;}
document.body.style.background='#000';document.body.style.color='#edf9fb';document.body.style.margin='16px';
createRoot(document.getElementById('root')!).render(<Fixture/>);
