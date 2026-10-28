import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {readHtmlFile,importedHtmlPreview} from '../lib/website-html';
test('HTML import preserves the source and bounds names, empty files and UTF-8 bytes',()=>{
 const html='<!doctype html><h1>My existing site</h1>';
 assert.equal(readHtmlFile('my-site.HTML',html),html);
 for(const [name,content] of [['bad.zip',html],['empty.html','  '],['large.html','é'.repeat(125001)]])assert.throws(()=>readHtmlFile(name,content));
});
test('preview removes active markup and navigation while preserving text and inline styling',()=>{
 const window=new Window();const parser=new window.DOMParser() as unknown as DOMParser;
 const source='<html><head><meta http-equiv="refresh" content="0;url=https://bad.test"><base href="https://bad.test"><style>h1{color:red}</style><link rel="stylesheet" href="https://bad.test/style.css"></head><body onload="bad()"><h1>Original site</h1><script>bad()</script><iframe src="https://bad.test"></iframe><a href="https://bad.test">Go</a><svg><a xlink:href="https://bad.test">SVG</a></svg><form action="https://bad.test"><button formaction="https://bad.test">Submit</button></form><template><script>bad()</script></template></body></html>';
 const result=importedHtmlPreview(source,parser);const doc=parser.parseFromString(result,'text/html');
 assert.equal(doc.querySelectorAll('script,iframe,base,link,template,meta[http-equiv="refresh"]').length,0);
 assert.equal(doc.querySelectorAll('[onload],[href],[action],[formaction]').length,0);
 assert.equal(doc.querySelector('svg a')?.getAttribute('xlink:href'),null);
 assert.equal(doc.querySelector('h1')?.textContent,'Original site');assert.match(result,/h1\{color:red\}/);
 for(const rule of ["script-src 'none'","connect-src 'none'","form-action 'none'","frame-src 'none'"])assert.ok(result.includes(rule));
 assert.ok(source.includes('<script>bad()</script>'),'Preview must not mutate the source used for export.');
});
