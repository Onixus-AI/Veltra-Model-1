import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import BuildTeam from '../../components/build-team';
import RepositoryChangeReview from '../../components/repository-change-review';
import ChatSetup from '../../components/chat-setup';
import TaskCenter from '../../components/task-center';
import '../../styles/spatial-workspace.css';
import {setupProfile,type SetupProfile} from '../../lib/setup-profile';
import type {SetupService} from '../../lib/setup-client';
import '../../app/globals.css';
const fixtureKey='veltra-setup-browser-fixture';
const service:SetupService={load:async()=>{const saved=localStorage.getItem(fixtureKey);return saved?setupProfile(JSON.parse(saved)):null;},save:async profile=>{if(new URLSearchParams(location.search).has('fail'))throw Error('Fixture save failed. Your setup was not saved.');const saved=setupProfile(profile);localStorage.setItem(fixtureKey,JSON.stringify(saved));return saved;}};
const checkMail=async()=>{if(new URLSearchParams(location.search).has('mail-error'))throw Error('Unavailable');return !new URLSearchParams(location.search).has('mail-disconnected');};
function Fixture(){const [context,setContext]=useState<SetupProfile|null>(null),[tool,setTool]=useState(''),[prompt,setPrompt]=useState(''),[working,setWorking]=useState(false);return <main style={{maxWidth:760,margin:'20px auto'}}><h1>Veltra setup interaction fixture</h1><ChatSetup autoOpen service={service} checkMail={checkMail} onContext={setContext} onMode={()=>{}} onTool={setTool} onStart={setPrompt} businessReady={new URLSearchParams(location.search).has('business-ready')}/><TaskCenter task={{id:"preview",purpose:"What time would it be in Arizona?",state:working?"running":"completed",steps:[],note:"Response received."}} busy={working} onStop={()=>setWorking(false)} onRetry={()=>{}} onOpen={()=>{}} onFollowups={()=>{}} canFollowup={true}/><button type="button" onClick={()=>setWorking(true)}>Simulate working task</button><p aria-label="Saved goal">{context?.goal??'No saved goal'}</p><p aria-label="Opened tool">{tool}</p><textarea aria-label="Prepared task" readOnly value={prompt}/></main>;}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('repository-verify')?<BuildTeam embedded/>:new URLSearchParams(location.search).has('repository-review')?<RepositoryChangeReview files={[{path:'src/existing.ts',content:'updated'},{path:'src/new.ts',content:'export const ready=true;'}]} onClose={()=>{document.getElementById('root')!.textContent='Review closed';}}/>:<Fixture/>);
