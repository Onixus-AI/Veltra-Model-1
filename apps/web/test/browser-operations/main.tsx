import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import OperationsCenter from '../../components/crm/operations-center';
import '../../components/crm/operations.css';
function Fixture(){const [workspace,setWorkspace]=useState('00000000-0000-4000-8000-000000000001');return <main style={{maxWidth:1180,margin:'24px auto'}}><label>Test business<select value={workspace} onChange={e=>setWorkspace(e.target.value)}><option value="00000000-0000-4000-8000-000000000001">First</option><option value="00000000-0000-4000-8000-000000000002">Second</option></select></label><OperationsCenter workspace={workspace} compact={location.search.includes('compact')} currentTask={location.search.includes('working')?'Reading the connected customer record':''} onNavigate={destination=>document.getElementById('destination')!.textContent=destination}/><output id="destination"/></main>;}
document.body.style.background='#000';document.body.style.color='#edf9fb';document.body.style.margin='16px';
createRoot(document.getElementById('root')!).render(<Fixture/>);
