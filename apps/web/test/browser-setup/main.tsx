import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import ChatSetup from '../../components/chat-setup';
import {setupProfile,type SetupProfile} from '../../lib/setup-profile';
import type {SetupService} from '../../lib/setup-client';
import '../../app/globals.css';
const fixtureKey='veltra-setup-browser-fixture';
const service:SetupService={load:async()=>{const saved=localStorage.getItem(fixtureKey);return saved?setupProfile(JSON.parse(saved)):null;},save:async profile=>{if(new URLSearchParams(location.search).has('fail'))throw Error('Fixture save failed. Your setup was not saved.');const saved=setupProfile(profile);localStorage.setItem(fixtureKey,JSON.stringify(saved));return saved;}};
function Fixture(){const [context,setContext]=useState<SetupProfile|null>(null),[tool,setTool]=useState(''),[prompt,setPrompt]=useState('');return <main style={{maxWidth:760,margin:'20px auto'}}><h1>Veltra setup interaction fixture</h1><ChatSetup autoOpen service={service} onContext={setContext} onMode={()=>{}} onTool={setTool} onStart={setPrompt} businessReady={new URLSearchParams(location.search).has('business-ready')}/><p aria-label="Saved goal">{context?.goal??'No saved goal'}</p><p aria-label="Opened tool">{tool}</p><textarea aria-label="Prepared task" readOnly value={prompt}/></main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
