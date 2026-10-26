import React from 'react';
import {createRoot} from 'react-dom/client';
import Panel from '../../components/google-workspace';
import '../../app/globals.css';
let created=false;
const request=async<T,>(path:string,_method='GET',body?:object):Promise<T>=>{
 if(path==='status')return {configured:true,connected:true,account:{email:'preview@example.test'},callback_url:'https://mail.example.test/chat/google/oauth/callback',setup_required:[]} as T;
 if(path.startsWith('files'))return {files:[{id:'demo-doc',name:'Customer proposal',mimeType:'application/vnd.google-apps.document',url:'https://drive.google.com/file/d/demo-doc/view'},...(created?[{id:'new-doc',name:'New proposal',mimeType:'application/vnd.google-apps.document',url:'https://drive.google.com/file/d/new-doc/view'}]:[])],nextPage:null} as T;
 if(path.startsWith('file?'))return {file:{id:'demo-doc',name:'Customer proposal',mimeType:'application/vnd.google-apps.document'},content:'Customer: Example Co.\n\nProject: Connect the customer journey.\n\nNext step: Review the proposal together.'} as T;
 if(path==='propose')return {ticket:'preview-ticket',...body,account:{email:'preview@example.test'}} as T;
 if(path==='create'){created=true;return {file:{id:'new-doc',name:'New proposal',mimeType:'application/vnd.google-apps.document',url:'https://drive.google.com/file/d/new-doc/view'}} as T;}
 throw Error('Preview request not supported.');
};
createRoot(document.getElementById('root')!).render(<><p style={{padding:'8px 24px',background:'#123528',color:'#bdffdf'}}>UI preview · Example data · No Google account access</p><Panel request={request}/></>);
