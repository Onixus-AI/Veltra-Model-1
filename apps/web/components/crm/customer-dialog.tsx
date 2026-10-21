'use client';
import {useEffect,useRef,type FormEvent} from 'react';
import {X} from 'lucide-react';

type Props={busy:boolean;error:string;onClose:()=>void;onSubmit:(event:FormEvent<HTMLFormElement>)=>void|Promise<void>};
export default function CustomerDialog({busy,error,onClose,onSubmit}:Props){
 const dialog=useRef<HTMLDialogElement>(null),initialField=useRef<HTMLInputElement>(null);
 useEffect(()=>{const element=dialog.current,previous=document.activeElement instanceof HTMLElement?document.activeElement:null;if(element&&!element.open){element.showModal();initialField.current?.focus();}return()=>{element?.close();if(previous?.isConnected)previous.focus();};},[]);
 return <dialog ref={dialog} className="crm-modal crm-customer-dialog" aria-labelledby="add-title" aria-describedby="add-description" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
  <header className="crm-dialog-heading"><div><h2 id="add-title">Add a customer</h2><p id="add-description">Start with a company. Add contact details when you have them.</p></div><button type="button" aria-label="Close customer form" disabled={busy} onClick={onClose}><X size={18}/></button></header>
  {error&&<p role="alert" className="crm-dialog-error">{error} Your entries are still here.</p>}
  <form onSubmit={onSubmit} aria-busy={busy}>
   <fieldset disabled={busy}><legend>Relationship</legend><label>Company <span className="crm-field-hint">Required</span><input ref={initialField} name="company" autoComplete="organization" required maxLength={200}/></label><label>Record type<select name="record_type"><option value="company">Company</option><option value="person">Person / decision-maker</option><option value="influencer">Influencer</option></select></label></fieldset>
   <fieldset disabled={busy}><legend>Contact details <span className="crm-field-hint">Optional</span></legend><div className="crm-dialog-fields"><label>Contact name<input name="name" autoComplete="name" maxLength={160}/></label><label>Role / title<input name="job_title" autoComplete="organization-title" maxLength={160}/></label><label>Email<input name="email" type="email" autoComplete="email" maxLength={254}/></label><label>Business phone<input name="phone" type="tel" autoComplete="tel" maxLength={80}/></label></div></fieldset>
   <fieldset disabled={busy}><legend>Business details <span className="crm-field-hint">Optional</span></legend><label>Website<input name="website" type="url" autoComplete="url" maxLength={1000} placeholder="https://"/></label><div className="crm-dialog-fields"><label>Location<input name="location" maxLength={200}/></label><label>Industry<input name="industry" list="veltra-industries" maxLength={120} placeholder="Choose or enter an industry"/></label></div></fieldset>
   <footer className="crm-dialog-actions"><span role="status">{busy?'Saving customer…':''}</span><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy?'Saving…':'Save customer'}</button></footer>
  </form>
 </dialog>;
}
