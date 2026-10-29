/** Approved new-sale catalog. This is not an entitlement or wallet mutation.
 * Cost-backed credits must be activated server-side before enrollment.
 * Existing subscriptions and legacy balances are not converted by this file. */
export const CREDITS_PER_PROVIDER_DOLLAR = 1000;
export const TRIAL_DAYS = 14;
export const TOP_UP_PACKS = [
 {id:'credits-25',priceCents:2500,credits:5000},
 {id:'credits-50',priceCents:5000,credits:12000},
] as const;
export const PLANS = [
 {id:'personal',name:'Personal',priceCents:1999,credits:4000,description:'An assistant that works with your personal projects.',features:['Onyx with saved projects and preferences','Google Docs, Sheets, Drive and Calendar connections','Visual website builder and HTML export','Writing, research and personal workflows'],business:false},
 {id:'creator',name:'Creator',priceCents:3900,credits:8000,description:'Create content, brand assets and websites.',features:['Everything in Personal','Signal creative workflows and brand assets','Image and content creation using your allowance','Website creation and export'],business:false},
 {id:'dev',name:'Dev',priceCents:6900,credits:15000,description:'Build, test and review your next product.',features:['Everything in Personal','Coding tasks and isolated verification','Repository connections and pull-request review','Website creation and HTML import/export'],business:false},
 {id:'business',name:'Business',priceCents:9900,credits:20000,description:'Your connected business, with Business OS included.',features:['Chat, creative and developer tools','Business OS, CRM and Mail automation','Campaign, follow-up and booking workflows','Shared team wallet and approval controls','TMS included while subscribed'],business:true},
] as const;
export const ADDITIONAL_BUSINESS_USER_CENTS = 3500;
export const ADDITIONAL_BUSINESS_USER_CREDITS = 7000;
function assertUsers(users:number){if(!Number.isSafeInteger(users)||users<1||users>10000)throw Error('Choose a whole number of users between 1 and 10,000.');}
export function businessMonthlyPriceCents(users:number):number {assertUsers(users);return 9900+(users-1)*ADDITIONAL_BUSINESS_USER_CENTS;}
export function businessMonthlyCredits(users:number):number {assertUsers(users);return 20000+(users-1)*ADDITIONAL_BUSINESS_USER_CREDITS;}
export const BUSINESS_SETUP_PACKAGES = [
 {id:'launch',name:'Business Launch',priceCents:29900,description:'Business profile, supported Mail and Calendar connections, CRM configuration and handover.'},
 {id:'growth',name:'Business Growth',priceCents:69900,description:'Launch setup plus one defined lead capture, follow-up and booking workflow.'},
] as const;
