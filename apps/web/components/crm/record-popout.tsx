'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import {X} from 'lucide-react';
export default function RecordPopout({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
 const panel=useRef<HTMLElement>(null),close=useRef<HTMLButtonElement>(null),latest=useRef(onClose);latest.current=onClose;
 useEffect(()=>{close.current?.focus();const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&panel.current?.contains(document.activeElement)&&!document.querySelector('dialog:modal')){event.preventDefault();latest.current();}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[]);
 return <aside ref={panel} className="crm-record-popout" role="dialog" aria-modal="false" aria-labelledby="crm-record-title"><header><div><small>Customer record</small><h2 id="crm-record-title">{title}</h2></div><button ref={close} type="button" aria-label="Close customer details" onClick={onClose}><X size={18}/></button></header><p className="crm-popout-guidance">Review the relationship, choose the next action, or open this customer in Onyx.</p><div className="crm-popout-body">{children}</div></aside>;
}
