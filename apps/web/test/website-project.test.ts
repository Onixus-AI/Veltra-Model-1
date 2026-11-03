import test from 'node:test';
import {dom} from './helpers/dom-global';
dom.reconfigure({url:'https://workspace.test/websites'});
window.sessionStorage.setItem('veltra-api-key','fixture-only');
import assert from 'node:assert/strict';
import {readWebsiteProject,serializeWebsiteProject,projectSource} from '../lib/website-project';
import {starterWebsite} from '../lib/website-document';
import {checkedFiles} from '../lib/build-artifacts';
import {saveWebsite,openSavedWebsite,savedWebsites} from '../lib/website-project-store';
test('large imported apps round-trip as projects and preserve the repository limits for other files',()=>{
 const source='<html><body><script>'+ 'x'.repeat(203000)+'</script></body></html>';
 const project=readWebsiteProject({format:'onixus-website',version:1,name:'Booking app.htm',document:{type:'html',source}});
 assert.equal(projectSource(readWebsiteProject(JSON.parse(serializeWebsiteProject(project)))),source);
 assert.equal(readWebsiteProject(starterWebsite).document.type,'blocks');
 assert.equal(checkedFiles([{path:'app.js',content:'é'.repeat(60000)}]).length,1,'Existing text character limit and total byte bound stay compatible');
 assert.throws(()=>readWebsiteProject({...project,version:2}));assert.throws(()=>readWebsiteProject({...project,name:'../unsafe'}));
 assert.equal(checkedFiles([{path:'index.html',content:source}])[0].content,source);
 for(const files of [[{path:'app.js',content:source}],[{path:'index.html',content:source},{path:'extra.txt',content:'x'}],[{path:'index.html',content:'<html>'+ 'é'.repeat(130000)+'</html>'}]])assert.throws(()=>checkedFiles(files));
});
test('saving verifies the stored copy and reopening restores its complete source',async t=>{
 process.env.NEXT_PUBLIC_SUPABASE_URL='';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='';
 const project=readWebsiteProject({format:'onixus-website',version:1,name:'Booking app',document:{type:'html',source:'<html><body>Réservations</body></html>'}});
 const id='00000000-0000-4000-8000-000000000123';let stored='',file:any;
 t.mock.method(globalThis,'fetch',async(input:unknown,init?:RequestInit)=>{
  assert.equal(init?.cache,'no-store');assert.ok(init?.signal);
  if(input==='/api/brand/upload'){const body=JSON.parse(String(init?.body));stored=Buffer.from(body.data,'base64').toString('utf8');file={id,name:body.name,size:Buffer.byteLength(stored),created_at:'2026-11-03',deleted_at:null};return Response.json({file});}
  if(input==='/api/brand/files')return Response.json({files:[file,{...file,id:'trash',deleted_at:'2026-11-03'},{...file,id:'other',name:'unrelated.json'}]});
  assert.equal(input,'/api/brand/download?id='+id);return new Response(stored);
 });
 assert.equal((await saveWebsite(project)).id,id);assert.equal(projectSource(await openSavedWebsite(id)),projectSource(project));assert.equal((await savedWebsites()).length,1);
});
test('failed saves never claim success without a complete receipt',async t=>{
 process.env.NEXT_PUBLIC_SUPABASE_URL='';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='';
 t.mock.method(globalThis,'fetch',async()=>Response.json({file:{id:'wrong'}}));
 await assert.rejects(saveWebsite(readWebsiteProject(starterWebsite)),/receipt is incomplete/);
});
