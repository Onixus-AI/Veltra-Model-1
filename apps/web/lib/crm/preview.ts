import type {Snapshot} from './domain';
export const previewWorkspace='11111111-1111-4111-8111-111111111111';
const base={workspace_id:previewWorkspace,created_at:'2026-10-16T12:00:00Z'};
export const previewData:Snapshot={
 customers:[{...base,id:'a',company:'Northstar Studio',name:'Alex Morgan',email:'alex@example.com',industry:'Design services',source:'Preview sample',suppressed:false},{...base,id:'b',company:'Harbor Home Services',name:'Taylor Reed',email:'taylor@example.com',industry:'Home services',source:'Preview sample',suppressed:false}],
 deals:[{...base,id:'d1',customer_id:'a',title:'Website and launch support',stage:'proposal',value_cents:350000,currency:'USD'},{...base,id:'d2',customer_id:'b',title:'Customer follow-up service',stage:'meeting',value_cents:120000,currency:'USD'}],
 tasks:[{...base,id:'t1',customer_id:'a',title:'Review launch scope with Alex',status:'open',due_at:'2026-10-17T15:00:00Z'},{...base,id:'t2',customer_id:'b',title:'Confirm discovery call agenda',status:'open',due_at:'2026-10-18T14:00:00Z'}],
 memories:[{...base,id:'m1',customer_id:'a',content:'Prefers a short scope summary before discussing pricing.',source:'Illustrative discovery call',status:'approved',expires_at:null},{...base,id:'m2',customer_id:'a',content:'Launch timing still needs confirmation.',source:'Illustrative discovery notes',status:'proposed',expires_at:null}],
 activities:[{...base,id:'e1',customer_id:'a',kind:'insert',title:'Opportunity added'},{...base,id:'e2',customer_id:'a',kind:'insert',title:'Customer record added'}]
};
