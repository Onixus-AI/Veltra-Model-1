import {readHtmlFile} from './website-html';
import {readWebsiteData,exportWebsite,type WebsiteData} from './website-document';
export const WEBSITE_PROJECT_LIMIT=1_000_000;
export type WebsiteProject={format:'onixus-website';version:1;name:string;document:{type:'html';source:string}|{type:'blocks';data:WebsiteData}};
export function readWebsiteProject(value:unknown):WebsiteProject{
 if(!value||typeof value!=='object')throw Error('Choose an Onixus website project.');
 const v=value as Record<string,any>;
 if(v.format===undefined){const data=readWebsiteData(v);return {format:'onixus-website',version:1,name:data.root.props.title,document:{type:'blocks',data}};}
 if(v.format!=='onixus-website'||v.version!==1||typeof v.name!=='string'||!v.name.trim()||v.name.length>120||/[\\/\x00-\x1f]/.test(v.name))throw Error('Invalid website project.');
 if(v.document?.type==='html'&&typeof v.document.source==='string')return {format:'onixus-website',version:1,name:v.name,document:{type:'html',source:readHtmlFile('index.html',v.document.source)}};
 if(v.document?.type==='blocks')return {format:'onixus-website',version:1,name:v.name,document:{type:'blocks',data:readWebsiteData(v.document.data)}};
 throw Error('Unsupported website project.');
}
export function projectSource(project:WebsiteProject){return project.document.type==='html'?project.document.source:exportWebsite(project.document.data);}
export function serializeWebsiteProject(project:WebsiteProject){const text=JSON.stringify(readWebsiteProject(project));if(new TextEncoder().encode(text).length>WEBSITE_PROJECT_LIMIT)throw Error('Project is too large.');return text;}
