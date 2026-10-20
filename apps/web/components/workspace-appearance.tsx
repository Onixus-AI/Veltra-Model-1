'use client';
import {useEffect,useRef,useState} from 'react';
import {Palette,X} from 'lucide-react';
type Appearance={version:1;accent:'cyan'|'magenta'|'lemon'|'purple'|'lime';density:'comfortable'|'compact'};
const defaults:Appearance={version:1,accent:'cyan',density:'comfortable'};
export default function WorkspaceAppearance({navigation=false}:{navigation?:boolean}){
 const [value,setValue]=useState<Appearance>(defaults),[open,setOpen]=useState(false);const dialog=useRef<HTMLDialogElement>(null);
 function apply(next:Appearance){setValue(next);document.documentElement.dataset.workspaceAccent=next.accent;document.documentElement.dataset.workspaceDensity=next.density;}
 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem('veltra-appearance-v1')||'null');if(saved?.accent==='violet')saved.accent='purple';if(saved?.accent==='emerald')saved.accent='lime';if(saved?.version===1&&['cyan','magenta','lemon','purple','lime'].includes(saved.accent)&&['comfortable','compact'].includes(saved.density))apply(saved);}catch{}},[]);
 useEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close();},[open]);
 function change(next:Appearance){apply(next);try{localStorage.setItem('veltra-appearance-v1',JSON.stringify(next));}catch{}}
 return <><button type="button" className="header-icon" aria-label="Customize workspace" onClick={()=>setOpen(true)}><Palette size={18}/>{navigation&&<span>Appearance</span>}</button><dialog ref={dialog} className="appearance-dialog" aria-labelledby="appearance-title" onCancel={()=>setOpen(false)} onClose={()=>setOpen(false)}><header><h2 id="appearance-title">Make it yours.</h2><button aria-label="Close appearance settings" onClick={()=>setOpen(false)}><X size={18}/></button></header><p>Your workspace, your rhythm. Saved in this browser.</p><fieldset><legend>Accent color</legend><div className="accent-choices">{(['cyan','magenta','lemon','purple','lime'] as const).map(accent=><button key={accent} data-accent={accent} aria-pressed={value.accent===accent} onClick={()=>change({...value,accent})}>{accent==='lemon'?'Lemon yellow':accent}</button>)}</div></fieldset><label>Layout density<select value={value.density} onChange={e=>change({...value,density:e.target.value as Appearance['density']})}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label><button onClick={()=>change(defaults)}>Reset appearance</button><button className="appearance-done" onClick={()=>setOpen(false)}>Done</button></dialog></>;
}
