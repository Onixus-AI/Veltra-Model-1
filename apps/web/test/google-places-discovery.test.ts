import {test} from 'node:test';import assert from 'node:assert/strict';
import {discoverPage,placesLeads,placesSearchText,PLACES_ENDPOINT,PLACES_FIELD_MASK} from '../lib/crm/discovery-source';

const place=(id:string,extra:Record<string,unknown>={})=>({id,displayName:{text:'Biz '+id},formattedAddress:'1 Main St, Fort Lauderdale, FL',nationalPhoneNumber:'(954) 555-0100',websiteUri:'https://example.com/',...extra});
const ok=(body:unknown)=>new Response(JSON.stringify(body),{status:200});

test('places search text is trimmed and bounded',()=>{
 assert.equal(placesSearchText('  plumbers   in Broward County, FL '),'plumbers in Broward County, FL');
 assert.throws(()=>placesSearchText('ab'));
 assert.throws(()=>placesSearchText('x'.repeat(161)));
 assert.throws(()=>placesSearchText(42));
});

test('places leads keep no-website businesses, drop closed and malformed ones, never carry email',()=>{
 const {leads,next}=placesLeads({places:[
  place('ChIJAAAAAAAAAAAA'),
  place('ChIJBBBBBBBBBBBB',{websiteUri:undefined}),
  place('ChIJCCCCCCCCCCCC',{businessStatus:'CLOSED_PERMANENTLY'}),
  place('bad id!'),
  place('ChIJDDDDDDDDDDDD',{displayName:{text:'  '}}),
  place('ChIJEEEEEEEEEEEE',{websiteUri:'javascript:alert(1)'})
 ],nextPageToken:'tok'});
 assert.deepEqual(leads.map(l=>l.source_key),['google_places/ChIJAAAAAAAAAAAA','google_places/ChIJBBBBBBBBBBBB','google_places/ChIJEEEEEEEEEEEE']);
 assert.equal(leads[0].source_url,'https://www.google.com/maps/place/?q=place_id:ChIJAAAAAAAAAAAA');
 assert.equal(leads[1].website,'');assert.equal(leads[2].website,'');
 assert.ok(leads.every(l=>l.email===null));
 assert.equal(next,'tok');
 assert.deepEqual(placesLeads({}).leads,[]);
 assert.throws(()=>placesLeads({places:'nope'}));
});

test('one run reads at most three pages, sends the key only to Google, and rests afterwards',async()=>{
 const calls:{url:string;init:RequestInit}[]=[];
 const fetcher=(async(url:string,init:RequestInit)=>{calls.push({url,init});const n=calls.length;return ok({places:[place('ChIJPAGE'+n+'AAAAAA'),place('ChIJSHAREDAAAAAAA')],nextPageToken:'p'+n});}) as unknown as typeof fetch;
 const page=await discoverPage({provider:'google_places',category:'local_businesses',bounds:[0,0,1,1],phase:0,cursor:0,search_text:'plumbers in Broward County, FL'},fetcher,{placesKey:'test-key'});
 assert.equal(calls.length,3);
 for(const c of calls){
  assert.equal(c.url,PLACES_ENDPOINT);
  const h=c.init.headers as Record<string,string>;
  assert.equal(h['X-Goog-Api-Key'],'test-key');assert.equal(h['X-Goog-FieldMask'],PLACES_FIELD_MASK);
 }
 assert.equal(JSON.parse(String(calls[0].init.body)).pageToken,undefined);
 assert.equal(JSON.parse(String(calls[1].init.body)).pageToken,'p1');
 assert.equal(page.leads.length,4,'shared place is saved once');
 assert.deepEqual([page.next_phase,page.next_cursor,page.exhausted],[3,0,true]);
});

test('missing key, quota and outage are reported without advancing',async()=>{
 const job={provider:'google_places',category:'local_businesses',bounds:[0,0,1,1] as [number,number,number,number],phase:0,cursor:0,search_text:'barbers in Miami, FL'};
 await assert.rejects(discoverPage(job,fetch,{}),/GOOGLE_PLACES_API_KEY/);
 await assert.rejects(discoverPage(job,(async()=>new Response('',{status:429})) as unknown as typeof fetch,{placesKey:'k'}),/daily limit/);
 await assert.rejects(discoverPage(job,(async()=>new Response('',{status:500})) as unknown as typeof fetch,{placesKey:'k'}),/unavailable \(500\)/);
});

test('a later page failing keeps the businesses already found',async()=>{
 let n=0;
 const fetcher=(async()=>++n===1?ok({places:[place('ChIJFIRSTAAAAAAAA')],nextPageToken:'p'}):new Response('',{status:503})) as unknown as typeof fetch;
 const page=await discoverPage({provider:'google_places',category:'local_businesses',bounds:[0,0,1,1],phase:0,cursor:0,search_text:'salons in Miami, FL'},fetcher,{placesKey:'k'});
 assert.equal(page.leads.length,1);
});
