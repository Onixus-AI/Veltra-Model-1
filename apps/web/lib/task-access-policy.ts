export const ACCESS_APPS=['mail','crm','brain','github','vercel','supabase','railway','n8n','bee','browser','connections','shopify','tms'] as const;
export type AccessApp=typeof ACCESS_APPS[number];
export const APP_NAMES:Record<AccessApp,string>={mail:'Veltra Mail',crm:'Onixus CRM',brain:'Shared brain',github:'GitHub',vercel:'Vercel',supabase:'Supabase',railway:'Railway',n8n:'n8n',bee:'LiveAskew / Bee',browser:'Browser',connections:'Connected app status',shopify:'Shopify',tms:'Onixus TMS'};
export function appsForTool(name:string,args:Record<string,unknown>={},confirm?:{target?:string}):AccessApp[]{
 if(confirm?.target)return confirm.target==='mail'?['mail']:confirm.target==='brain'?['brain']:['crm'];
 if(name.startsWith('github_'))return ['github'];if(name.startsWith('vercel_'))return ['vercel'];if(name.startsWith('supabase_'))return ['supabase'];if(name.startsWith('railway_'))return ['railway'];if(name.startsWith('n8n_'))return ['n8n'];
 if(name.startsWith('mail_'))return ['mail'];if(name.startsWith('brain_'))return ['brain'];if(name==='browser_inspect')return ['browser'];if(name.startsWith('crm_'))return /outreach|campaign/.test(String(args.action))?['crm','mail']:['crm'];return [];
}
