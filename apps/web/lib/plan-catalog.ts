/** Product catalogue, not a payment or authorization source. Activation requires
 * server-side entitlements and a verified payment-provider subscription. */
export const TRIAL_DAYS = 14;
export const TOP_UP_PACKS = [{id:'credits-25',priceCents:2500},{id:'credits-50',priceCents:5000}] as const;
export const PLANS = [
 {id:'personal',name:'Personal',priceCents:1199,description:'Think, write and make something of your own.',features:['Onyx Chat and personal projects','Google documents, sheets, files and Calendar','Visual website builder and HTML export','Developer tools and repository connections'],business:false},
 {id:'creator',name:'Creator',priceCents:2900,description:'Turn your ideas into content and websites.',features:['Everything in Personal','Creative briefs, image and content workflows','Brand assets and Signal creative workflows','More included AI capacity than Personal'],business:false},
 {id:'dev',name:'Dev',priceCents:4900,description:'Build, test and review your next product.',features:['Everything in Personal','Coding tasks and isolated verification','Repository changes and pull-request review','More included AI capacity for development'],business:false},
 {id:'business',name:'Business',priceCents:7900,description:'Keep your customers, inbox and operations moving.',features:['Chat, creative and developer tools','CRM, Mail and business automation','Campaigns, follow-ups and booking workflows','Shared team wallet; more credits per paid user','TMS included while subscribed'],business:true},
] as const;
export const ADDITIONAL_BUSINESS_USER_CENTS = 3000;
export function businessMonthlyPriceCents(users:number):number {
 if(!Number.isSafeInteger(users)||users<1||users>10000)throw Error('Choose a whole number of users between 1 and 10,000.');
 return 7900+(users-1)*ADDITIONAL_BUSINESS_USER_CENTS;
}
