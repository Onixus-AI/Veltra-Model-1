import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportWebsite,readWebsiteData,safeSiteLink,starterWebsite} from '../lib/website-document';
test('project import strips unknown fields and rejects executable components and duplicate IDs',()=>{
 const clean=readWebsiteData({...starterWebsite,permissions:{publish:true}});
 assert.equal('permissions' in clean,false);
 assert.throws(()=>readWebsiteData({...starterWebsite,content:[{type:'script',props:starterWebsite.content[0].props}]}));
 assert.throws(()=>readWebsiteData({...starterWebsite,content:[starterWebsite.content[0],starterWebsite.content[0]]}));
 assert.throws(()=>readWebsiteData({...starterWebsite,content:Array(41).fill(starterWebsite.content[0])}));
});
test('website export escapes imported content and blocks script and protocol-relative links',()=>{
 const project=structuredClone(starterWebsite);
 project.root.props.title='</title><script>alert(1)</script>';
 project.content[0].props.title='<img src=x onerror=alert(1)>';
 project.content[0].props.href='javascript:alert(1)';
 const html=exportWebsite(project);
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('javascript:'));assert.ok(html.includes('&lt;img'));
 for(const link of ['javascript:alert(1)','//tracking.example','data:text/html,bad'])assert.equal(safeSiteLink(link),'#contact');
 assert.equal(safeSiteLink('https://example.com/book'),'https://example.com/book');
 assert.equal(safeSiteLink('#features'),'#features');
});
test('starter exports a responsive, self-contained document with accessible navigation',()=>{
 const html=exportWebsite(starterWebsite);
 for(const text of ['<!doctype html>','name="viewport"','prefers-reduced-motion','aria-label="Main navigation"','id="contact"'])assert.ok(html.includes(text));
 assert.ok(!html.includes('<script'));assert.ok(!html.includes('<iframe'));
});
