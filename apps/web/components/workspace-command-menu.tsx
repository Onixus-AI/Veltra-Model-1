"use client";
import {useEffect,useRef,useState} from 'react';
import {Search,X} from 'lucide-react';
export type WorkspaceCommand={id:string;label:string;keywords?:string;run:()=>void};
export default function WorkspaceCommandMenu({commands}:{commands:WorkspaceCommand[]}){
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const [query,setQuery]=useState('');
 function open(){setQuery('');if(!dialog.current?.open)dialog.current?.showModal();}
 function close(){dialog.current?.close();trigger.current?.focus();}
 useEffect(()=>{const key=(event:globalThis.KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(dialog.current?.open)dialog.current.close();else{setQuery('');dialog.current?.showModal();}}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 const matches=commands.filter(command=>(command.label+' '+(command.keywords||'')).toLowerCase().includes(query.trim().toLowerCase()));
 return <><button ref={trigger} className="workspace-command-trigger" aria-label="Search workspace actions" aria-haspopup="dialog" title="Search workspace actions (⌘K / Ctrl+K)" onClick={open}><Search size={16}/><span>Search actions</span><kbd>⌘K</kbd></button><dialog className="workspace-command-dialog" ref={dialog} aria-labelledby="workspace-command-title" onClick={event=>{if(event.target===event.currentTarget)close();}}><header><h2 id="workspace-command-title">Go anywhere</h2><button aria-label="Close search" onClick={close}><X size={18}/></button></header><input autoFocus aria-label="Find a workspace action" placeholder="Search apps, views, or settings…" value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&matches.length===1){event.preventDefault();close();matches[0].run();}}}/><nav aria-label="Workspace actions">{matches.map(command=><button key={command.id} onClick={()=>{close();command.run();}}>{command.label}</button>)}{!matches.length&&<p role="status">No matching actions. Try Mail, CRM, or settings.</p>}</nav><footer>Navigate with Tab · Open with Enter · Close with Esc</footer></dialog></>;
}
