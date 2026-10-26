import React from 'react';
import {createRoot} from 'react-dom/client';
import Panel from '../../components/google-workspace';
import '../../app/globals.css';
let created=false;let docContent='Customer proposal\n\nWrite your next step here.';let grid=[['Item','Amount'],['Services','250']];
const request=async<T,>(path:string,_method='GET',body?:object):Promise<T>=>{
 if(path==='status')return {configured:true,connected:true,account:{email:'preview@example.test'},callback_url:'https://mail.example.test/chat/google/oauth/callback',setup_required:[]} as T;
 if(path.startsWith('editor?')){const id=new URLSearchParams(path.split('?')[1]).get('id');return (id==='demo-sheet'?{kind:'sheet',id,title:'Project budget',grid,rows:2,cols:2,tab:0,tabs:[{id:0,title:'Budget'}],snapshot:'fixture-snapshot'}:{kind:'doc',id,title:'Customer proposal',content:docContent,snapshot:'fixture-snapshot'}) as T;}
 if(path==='save'){const b=body as any;if(b.content!==undefined)docContent=b.content;else b.cells.forEach((c:any)=>grid[c.row][c.col]=c.value);return {saved:true} as T;}
 if(path.startsWith('files'))return {files:[{id:'demo-sheet',name:'Project budget',mimeType:'application/vnd.google-apps.spreadsheet',url:'https://drive.google.com/file/d/demo-sheet/view'},{id:'demo-doc',name:'Customer proposal',mimeType:'application/vnd.google-apps.document',url:'https://drive.google.com/file/d/demo-doc/view'},...(created?[{id:'new-doc',name:'New proposal',mimeType:'application/vnd.google-apps.document',url:'https://drive.google.com/file/d/new-doc/view'}]:[])],nextPage:null} as T;
 if(path.startsWith('file?'))return {file:{id:'demo-doc',name:'Customer proposal',mimeType:'application/vnd.google-apps.document'},content:'Customer: Example Co.\n\nProject: Connect the customer journey.\n\nNext step: Review the proposal together.'} as T;
 if(path==='propose')return {ticket:'preview-ticket',...body,account:{email:'preview@example.test'}} as T;
 if(path==='create'){created=true;return {file:{id:'new-doc',name:'New proposal',mimeType:'application/vnd.google-apps.document',url:'https://drive.google.com/file/d/new-doc/view'}} as T;}
 throw Error('Preview request not supported.');
};
createRoot(document.getElementById('root')!).render(<><p style={{padding:'8px 24px',background:'#123528',color:'#bdffdf'}}>UI preview · Example data · No Google account access</p><Panel request={request}/></>);
