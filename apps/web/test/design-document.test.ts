import {test} from 'node:test';
import assert from 'node:assert/strict';
import {designHtml,designPreview,designTask} from '../lib/design-document';
test('only installs a bounded index.html from task artifacts',()=>{
 assert.equal(designHtml([{path:'index.html',content:'<h1>Real output</h1>'}]),'<h1>Real output</h1>');
 for(const files of [null,[{path:'../index.html',content:'bad'}],[{path:'index.html',content:'x'.repeat(60001)}]])assert.equal(designHtml(files),null);
});
test('preview policy precedes generated scripts and denies remote services',()=>{
 const preview=designPreview('<script>window.example=true</script>');
 assert.ok(preview.indexOf('Content-Security-Policy')<preview.indexOf('<script>'));
 for(const restriction of ["default-src 'none'","connect-src 'none'","form-action 'none'","frame-src 'none'","base-uri 'none'"])assert.ok(preview.includes(restriction));
 assert.match(designTask('A bakery with a menu filter'),/A bakery with a menu filter/);
});
