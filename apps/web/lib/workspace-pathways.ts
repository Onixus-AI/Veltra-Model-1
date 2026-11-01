import {workspaceTools,workspaceHref,type WorkspaceToolId} from './workspace-navigation';
export type ClientPathway='build'|'growth';
export const clientPathways={
 build:{title:'Build your business foundation',description:'Set up a place for customers to find you, contact you and become customers.',steps:[
  {title:'Create your business website',description:'Explain your services and give customers a clear way to contact you.',tool:'websites'},
  {title:'Organize your brand',description:'Keep your logo, images and business information together.',tool:'brand'},
  {title:'Set up customer intake',description:'Use CRM to record inquiries and assign the next follow-up.',tool:'crm'},
  {title:'Connect your tools',description:'Connect the email and business services you plan to use.',tool:'connections'},
 ]},
 growth:{title:'Grow your business',description:'Work on new opportunities and follow-ups using the business foundation you already have.',steps:[
  {title:'Review leads and opportunities',description:'Open CRM to review customers, deals and their next actions.',tool:'crm'},
  {title:'Follow up with customers',description:'Open Mail to read customer messages and review your replies.',tool:'mail'},
  {title:'Plan your campaigns',description:'Open your linked Signal business to work on content and campaigns.',tool:'signal'},
  {title:'Review business results',description:'Use your business overview to see available results and priorities.',tool:'overview'},
 ]},
} satisfies Record<ClientPathway,{title:string;description:string;steps:{title:string;description:string;tool:WorkspaceToolId}[]}>;
export function pathwayHref(pathway:ClientPathway,business=''){
 const query=new URLSearchParams();if(business)query.set('workspace',business);
 return '/workspace/'+pathway+(query.size?'?'+query:'');
}
export function pathwaySteps(pathway:ClientPathway,business:string){
 return clientPathways[pathway].steps.map(step=>({...step,label:workspaceTools.find(tool=>tool.id===step.tool)!.label,href:workspaceHref(step.tool,business)}));
}
