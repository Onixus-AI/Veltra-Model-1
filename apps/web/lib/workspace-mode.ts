export type WorkspaceMode='personal'|'dev'|'business';
export const workspaceModes=[{id:'personal',label:'Personal',description:'Think, create and organize your day.'},{id:'dev',label:'Dev',description:'Build, review and ship with your connected tools.'},{id:'business',label:'Business',description:'Customers, mail and operations in one workspace.'}] as const;
export function workspaceMode(value:string|null):WorkspaceMode|null{return value==='work'?'business':value==='personal'||value==='dev'||value==='business'?value:null;}
export function modeForTool(tool:string):WorkspaceMode|null{return ['code','build'].includes(tool)?'dev':['crm','business','tms','shopify'].includes(tool)?'business':null;}
export function connectorSectionInMode(section:string,mode:WorkspaceMode){return mode==='dev'?['dev','knowledge','custom'].includes(section):mode==='business'?section!=='dev':['business','creator','knowledge','os'].includes(section);}
export function connectorToolInMode(name:string,mode:WorkspaceMode){return mode!=='personal'||['LiveAskew / Bee','Google Calendar','Google Drive','OneDrive','Google Docs','Notion','Canva','Higgsfield'].includes(name);}
