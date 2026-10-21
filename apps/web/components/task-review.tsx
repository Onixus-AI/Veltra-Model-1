'use client';
import {useEffect,useId,useRef} from 'react';
import {FileCheck2} from 'lucide-react';
import type {WriteProposal} from '@/lib/chat-tools';
export default function TaskReview({proposal,onDecision}:{proposal:WriteProposal;onDecision:(allowed:boolean)=>void}){
 const title=useId(),cancel=useRef<HTMLButtonElement>(null);
 useEffect(()=>{cancel.current?.focus();},[proposal.id]);
 return <section className="task-review" role="dialog" aria-labelledby={title} aria-modal="false"><header><FileCheck2 size={18}/><h3 id={title}>{proposal.agent_review?'Review connected action':'Review repository change'}</h3></header><pre>{proposal.summary}</pre><p>{proposal.agent_review?'Confirm applies only the exact reviewed action.':'Confirm creates the reviewed commit and a draft pull request. Review the proposed file in the canvas first.'}</p><footer><button ref={cancel} type="button" onClick={()=>onDecision(false)}>Cancel</button><button className="primary" type="button" onClick={()=>onDecision(true)}>Confirm</button></footer></section>;
}
