export const W='00000000-0000-4000-8000-000000000001',C='00000000-0000-4000-8000-000000000002',U='00000000-0000-4000-8000-000000000003',X='00000000-0000-4000-8000-000000000004';
export function fixture(role='owner'){
 const tables:Record<string,any[]>={crm_memberships:[{workspace_id:W,user_id:U,role}],crm_customers:[{id:C,workspace_id:W}],crm_conversations:[],veltra_memories:[]};
 const client={from:(table:string)=>{
  let op='select',body:any,fields='*',single=false,cap=Infinity,sortKey='';const filters:((r:any)=>boolean)[]=[];
  const q:any={select:(f='*')=>{fields=f;return q;},eq:(k:string,v:unknown)=>{filters.push(r=>r[k]===v);return q;},is:(k:string,v:unknown)=>{filters.push(r=>(r[k]??null)===v);return q;},order:(key:string)=>{sortKey=key;return q;},limit:(count:number)=>{cap=count;return q;},
   or:(expr:string)=>{const f=expr.split(',').map(c=>{const [key,op,...rest]=c.split('.'),value=rest.join('.');return (r:any)=>op==='is'?r[key]==null:op==='eq'?r[key]===value:op==='gt'?r[key]>value:op==='ilike'?String(r[key]).toLowerCase().includes(value.slice(1,-1).toLowerCase()):false;});filters.push(r=>f.some(check=>check(r)));return q;},
   ilike:(key:string,value:string)=>{filters.push(r=>String(r[key]).toLowerCase().includes(value.slice(1,-1).toLowerCase()));return q;},
   maybeSingle:()=>{single=true;return q;},single:()=>{single=true;return q;},insert:(v:any)=>{op='insert';body=v;return q;},update:(v:any)=>{op='update';body=v;return q;},delete:()=>{op='delete';return q;},
   then:(resolve:any,reject:any)=>Promise.resolve().then(()=>{
    let rows=(tables[table]??[]).filter(r=>filters.every(f=>f(r)));
    if(sortKey)rows=rows.toSorted((a,b)=>String(b[sortKey]??'').localeCompare(String(a[sortKey]??'')));rows=rows.slice(0,cap);
    if(op==='insert'){const row={revision:0,expires_at:null,updated_at:'2026-10-20T00:00:00Z',...structuredClone(body)};tables[table]??=[];tables[table].push(row);rows=[row];}
    if(op==='update')for(const row of rows)Object.assign(row,structuredClone(body));
    if(op==='delete')tables[table]=tables[table].filter(r=>!rows.includes(r));
    const project=(r:any)=>fields==='*'?structuredClone(r):Object.fromEntries(fields.split(',').map(k=>[k,r[k]]));
    return {data:single?(rows[0]?project(rows[0]):null):rows.map(project),error:null};
   }).then(resolve,reject)};return q;
 }};
 return {client:client as any,tables,user:U,scope:{workspace_id:W},app:'chat' as const};
}
