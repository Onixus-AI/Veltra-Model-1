import test from 'node:test';
import assert from 'node:assert/strict';
import {dom} from './helpers/dom-global';
import './helpers/react-global';
import {act,createElement,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {EventWhenFields} from '../components/google-calendar';
import {emptyForm,type EventForm} from '../lib/revenue/calendar-form';

const nativeValue=Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!;

let latest:EventForm;
let rerender:(f:(x:EventForm)=>EventForm)=>void;
function Harness(){
 const [form,setForm]=useState<EventForm>(()=>emptyForm('America/New_York'));
 latest=form;rerender=f=>setForm(f);
 return createElement(EventWhenFields,{form,zones:['Africa/Abidjan','America/New_York','Europe/London'],onChange:setForm});
}
let scope:ParentNode=document;
const field=(label:string)=>scope.querySelector(`[aria-label="${label}"]`) as HTMLInputElement&HTMLSelectElement;
async function type(label:string,value:string){
 const el=field(label);
 await act(async()=>{el.focus();nativeValue.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
}
async function blur(label:string){await act(async()=>{field(label).blur();});}

test('typed dates and times persist across re-renders, zone changes and the all-day toggle',async t=>{
 const host=document.body.appendChild(document.createElement('div'));
 const root=createRoot(host);scope=host;
 t.after(()=>{act(()=>root.unmount());host.remove();});
 await act(async()=>{root.render(createElement(Harness));});

 await type('Start date','2026-10-27');await blur('Start date');
 await type('Start time','17:00');await blur('Start time');
 assert.equal(field('Start date').value,'2026-10-27');
 assert.equal(field('Start time').value,'17:00');
 assert.equal(field('End time').value,'17:30','the end follows the start');
 assert.equal(field('End date').value,'2026-10-27');

 await type('End time','17:15');await blur('End time');
 assert.equal(latest.end_time,'17:15');

 await act(async()=>{const s=field('Time zone');s.value='Europe/London';s.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 assert.equal(latest.time_zone,'Europe/London');
 assert.deepEqual([field('Start date').value,field('Start time').value,field('End time').value],['2026-10-27','17:00','17:15'],'changing the zone keeps the wall-clock times');

 const allDay=scope.querySelector('input[type=checkbox]') as HTMLInputElement;
 await act(async()=>{allDay.click();});
 assert.equal(field('Start time'),null);
 assert.equal(field('Start date').value,'2026-10-27');
 await act(async()=>{allDay.click();});
 assert.deepEqual([field('Start time').value,field('End time').value],['17:00','17:15'],'times come back after all-day is turned off');
});

test('editing a focused date is never overwritten, even when the browser reports it as empty',async t=>{
 const proto=dom.window.HTMLInputElement.prototype,original=Object.getOwnPropertyDescriptor(proto,'value')!;
 const writes:string[]=[];
 Object.defineProperty(proto,'value',{...original,set(this:HTMLInputElement,v:string){if(this.getAttribute('aria-label')==='Start date')writes.push(v);original.set!.call(this,v);}});
 t.after(()=>Object.defineProperty(proto,'value',original));
 const host=document.body.appendChild(document.createElement('div'));
 const root=createRoot(host);scope=host;
 t.after(()=>{act(()=>root.unmount());host.remove();});
 await act(async()=>{root.render(createElement(Harness));});
 await type('Start date','2026-10-27');await blur('Start date');
 writes.length=0;
 // Chrome reports "" while the year is being retyped; neither re-renders nor an out-of-date
 // value may replace the text the person sees.
 await type('Start date','');
 await act(async()=>{rerender(f=>({...f,title:'Re-render while typing'}));});
 await act(async()=>{rerender(f=>({...f,time_zone:'Europe/London',zone_chosen:true}));});
 await act(async()=>{rerender(f=>({...f,start_date:'2026-10-27'}));});
 assert.deepEqual(writes,[],'nothing is written into the field while it has focus');
 await type('Start date','2027-10-27');await blur('Start date');
 assert.equal(latest.start_date,'2027-10-27');
 await act(async()=>{rerender(()=>emptyForm('UTC'));});
 assert.equal(field('Start date').value,'','a reset clears unfocused fields');
});

test('the zone select shows UTC, not an alias, and lists the zone in use',async t=>{
 const host=document.body.appendChild(document.createElement('div'));
 const root=createRoot(host);scope=host;
 t.after(()=>{act(()=>root.unmount());host.remove();});
 await act(async()=>{root.render(createElement(EventWhenFields,{form:emptyForm('UTC'),zones:['Africa/Abidjan','America/New_York'],onChange:()=>undefined}));});
 const select=field('Time zone');
 assert.equal(select.value,'UTC');
 assert.equal(select.options[0].value,'UTC');
});
