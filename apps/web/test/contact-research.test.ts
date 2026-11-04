import {test} from 'node:test';import assert from 'node:assert/strict';
import {companyUrl,publicAddress,robotAllows,publishedContacts,publishedWebsiteEmail,researchCompanyWebsite} from '../lib/crm/contact-research';
test('website research excludes local addresses and unsafe URLs',()=>{
 for(const u of ['http://example.com','https://127.0.0.1','https://[::1]','https://user:pass@example.com','https://example.com:444','https://metadata.internal'])assert.throws(()=>companyUrl(u));
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.0.1','100.64.0.1','198.18.0.1','::1','203.0.113.1'])assert.equal(publicAddress(ip),false);
 assert.equal(publicAddress('8.8.8.8'),true);
});
test('robots policy respects the applicable agent and longest path rule',()=>{
 assert.equal(robotAllows('User-agent: *\nDisallow: /','/contact'),false);
 assert.equal(robotAllows('User-agent: *\nDisallow: /private\nAllow: /private/contact','/private/contact'),true);
 assert.equal(robotAllows('User-agent: *\nDisallow: /\nUser-agent: VeltraCRM\nAllow: /','/contact'),true);
});
test('only visible addresses the business publishes count: own domain or a personal provider',()=>{
 const c=publishedContacts('<script>info@script.test</script><!-- sales@comment.test --><a href="mailto:sales@example.com">Contact</a> jane.doe@example.com Mike@Gmail.com hello@webdesigner.example no-reply@example.com logo@2x.png','https://www.example.com/contact');
 assert.deepEqual(c.map(x=>x.email),['sales@example.com','jane.doe@example.com','mike@gmail.com']);
});
test('own domain matching allows subdomains either way but not look-alikes',()=>{
 assert.equal(publishedWebsiteEmail('owner@shop.example.com','https://example.com/'),'owner@shop.example.com');
 assert.equal(publishedWebsiteEmail('owner@example.com','https://shop.example.com/'),'owner@example.com');
 assert.equal(publishedWebsiteEmail('owner@notexample.com','https://example.com/'),null);
 assert.equal(publishedWebsiteEmail('owner@example.com.evil.test','https://example.com/'),null);
 assert.equal(publishedWebsiteEmail('bobsplumbing@yahoo.com','https://bobsplumbing.example/'),'bobsplumbing@yahoo.com');
 assert.equal(publishedWebsiteEmail('not an email','https://example.com/'),null);
});
test('crawl stays on the supplied company site and saves partial-page limitations',async()=>{
 const seen:string[]=[];const read=async(url:string)=>{seen.push(url);return {url,status:200,html:url.endsWith('robots.txt')?'User-agent: *\nDisallow: /private':url.endsWith('/contact')?'Email info@example.com':'<a href="/contact">Contact</a><a href="https://other.test/contact">Other</a><a href="/private/contact">Private</a>'};};
 const r=await researchCompanyWebsite('https://example.com',read);
 assert.equal(r.contacts[0].email,'info@example.com');assert.equal(r.contacts[0].source_url,'https://example.com/contact');
 assert.equal(seen.length,3);assert.ok(seen.every(u=>new URL(u).hostname==='example.com'));
 await assert.rejects(researchCompanyWebsite('https://example.com',async url=>({url,status:200,html:'User-agent: *\nDisallow: /'})),/does not permit/);
});
