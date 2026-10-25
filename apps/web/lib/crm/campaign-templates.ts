import {industries} from './industries';
export type CampaignPillar='suite'|'build'|'grow'|'automate';
export const campaignPillars:Record<CampaignPillar,string>={suite:'We Build · We Grow · We Automate',build:'We Build',grow:'We Grow',automate:'We Automate'};
export function campaignTemplate(industry:string,pillar:CampaignPillar='suite'){
 const trucking=/truck|logistics|freight|courier|fleet/i.test(industry);
 const workflow=trucking?'a new business inquiry → a customer record → a scheduled conversation → a reviewed follow-up':'a new inquiry → a customer record → a booked conversation → a reviewed follow-up';
 const offer=pillar==='build'?'Build a clearer path from your website inquiry to your customer record.':pillar==='grow'?'Prepare relevant outreach, review each message, and track follow-ups in one place.':pillar==='automate'?'Keep customer context, tasks and follow-ups connected so your team can see the next action.':'We Build: a clearer customer journey. We Grow: reviewed outreach and follow-ups. We Automate: connected customer records, tasks and business context.';
 const subject=pillar==='suite'?'A more connected customer journey for {{company}}':campaignPillars[pillar]+': the next step for {{company}}';
 return {name:('Onixus Workspace · '+industry+' · '+campaignPillars[pillar]).slice(0,120),subject,body:`Hi {{name}},

When a new inquiry reaches {{company}}, how does your team keep the conversation moving?

Onixus Workspace brings CRM, Mail and Chat into a connected workspace. ${offer}

For a ${industry.toLowerCase()} business, we can explore this workflow together: ${workflow}. We’ll confirm which connections and setup your team needs during the demo.

Would a short walkthrough be useful? Reply with a good time, or book a conversation:
https://www.onixus.xyz/book?objective=Explore%20Veltra

The Onixus team`,followSubject:'Worth a walkthrough, {{company}}?',followBody:`Hi {{name}},

Following up on Onixus Workspace for {{company}}. We can walk through one real inquiry and show how customer context, next steps and reviewed follow-ups fit together.

Would you like to see that workflow?
https://www.onixus.xyz/book?objective=Explore%20Veltra

The Onixus team`,story:workflow,visual:trucking?'trucking-v1':'business-v1',industry,pillar};
}
export function campaignBriefIntent(text:string){
 const m=/^(?:please\s+)?(?:start|prepare|create|draft)\s+(?:an?\s+)?(?:email\s+)?(?:outreach\s+)?campaign\s+(?:to|for)\s+(.{2,180}?)(?:\s+about\s+.{1,300})?[.!]?$/i.exec(text.trim());
 if(!m)return null;
 const q=m[1].toLowerCase().replace(/ companies| businesses| industry/g,'').trim();
 const industry=/truck|logistics/.test(q)?'Trucking & logistics':industries.find(i=>i.toLowerCase()===q)||industries.find(i=>i.toLowerCase().includes(q));
 return industry?{industry,pillar:'suite' as CampaignPillar}:null;
}
