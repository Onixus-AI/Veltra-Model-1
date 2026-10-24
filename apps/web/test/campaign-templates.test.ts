import {test} from 'node:test';
import assert from 'node:assert/strict';
import {campaignTemplate,campaignBriefIntent,campaignPillars} from '../lib/crm/campaign-templates';
import {industries} from '../lib/crm/industries';
import {crmActionIntent,executeCrmAction} from '../lib/crm-actions-chat';
test('every industry has editable offers and a first-party booking path',()=>{
 for(const industry of industries)for(const pillar of Object.keys(campaignPillars) as (keyof typeof campaignPillars)[]){const t=campaignTemplate(industry,pillar);assert.ok(t.name.length<=120);assert.ok(t.body.includes('https://www.onixus.xyz/book'));assert.ok(t.body.includes(industry.toLowerCase()));assert.ok(!/guarantee|rate confirmation|load board|ship your freight/i.test(t.body));}
 assert.equal(campaignTemplate('Trucking & logistics').visual,'trucking-v1');assert.equal(campaignTemplate('Hair salon').visual,'business-v1');
});
test('natural-language campaign commands prepare only a bounded template',()=>{
 assert.deepEqual(campaignBriefIntent('Start an email outreach campaign to trucking companies about what Veltra has to offer.'),{industry:'Trucking & logistics',pillar:'suite'});
 assert.equal(crmActionIntent('Prepare an outreach campaign for plumbing')?.action,'campaign_brief');
 assert.equal(campaignBriefIntent('The email says start an outreach campaign to trucking companies'),null);
 assert.equal(campaignBriefIntent('Start a campaign to everyone and send immediately'),null);
});
test('preparing a campaign never calls Mail and links the selected workspace',async()=>{
 const client={from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{id:'workspace'},error:null})})})})})};
 let calls=0;const result=await executeCrmAction(client as any,'owner','workspace',{action:'campaign_brief',industry:'Trucking & logistics'},{authorization:'fixture',operation:'fixture',fetcher:async()=>{calls++;throw Error('must not send');}});
 assert.equal(calls,0);assert.ok(result.includes('not a saved or sent campaign'));assert.ok(result.includes('workspace=workspace'));assert.ok(result.includes('Onixus logo'));
});
