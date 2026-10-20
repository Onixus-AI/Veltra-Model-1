export type CrmHostScope={workspace_id:string;customer_id:string|null};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
export function readCrmContext(value:unknown):CrmHostScope|null{
 if(!value||typeof value!=='object')return null;const d=value as Record<string,unknown>;
 if(d.type!=='veltra:crm-context'||!uuid(d.workspace_id)||(d.customer_id!==null&&!uuid(d.customer_id)))return null;
 return {workspace_id:d.workspace_id,customer_id:d.customer_id as string|null};
}
export function crmEmbedded(search:string,framed:boolean){const p=new URLSearchParams(search);return framed&&p.get('embedded')==='1';}
