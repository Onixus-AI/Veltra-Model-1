export const ACCESS_APPS=['mail','crm','brain','github','vercel','supabase','railway','n8n','bee','browser','connections','shopify','tms','google','calendar','brand','signal'] as const;
export type AccessApp=typeof ACCESS_APPS[number];
export const APP_NAMES:Record<AccessApp,string>={mail:'Onixus Mail',crm:'Onixus CRM',brain:'Shared brain',github:'GitHub',vercel:'Vercel',supabase:'Supabase',railway:'Railway',n8n:'n8n',bee:'LiveAskew / Bee',browser:'Browser',connections:'Connected app status',shopify:'Shopify',tms:'Onixus TMS',google:'Google Drive, Docs and Sheets',calendar:'Google Calendar',brand:'Private brand files',signal:'Signal creative production'};
export function appsForTool(name:string,args:Record<string,unknown>={},confirm?:{target?:string}):AccessApp[]{
 if(name==='business_team')return ['crm'];
 if(name==='signal_creative'||confirm?.target==='signal')return ['signal'];
 if(confirm?.target==='google'||confirm?.target==='calendar')return [confirm.target];
 if(name.startsWith('brand_'))return ['brand'];
 if(name.startsWith('google_'))return ['google'];if(name.startsWith('calendar_'))return ['calendar'];
 if(confirm?.target)return confirm.target==='mail'?['mail']:confirm.target==='brain'?['brain']:['crm'];
 if(name.startsWith('github_'))return ['github'];if(name.startsWith('vercel_'))return ['vercel'];if(name.startsWith('supabase_'))return ['supabase'];if(name.startsWith('railway_'))return ['railway'];if(name.startsWith('n8n_'))return ['n8n'];
 if(name.startsWith('mail_'))return ['mail'];if(name.startsWith('brain_'))return ['brain'];if(name==='browser_inspect'||name==='web_search')return ['browser'];if(name.startsWith('crm_'))return /outreach|campaign/.test(String(args.action))?['crm','mail']:['crm'];return [];
}
