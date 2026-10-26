import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/react-global';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CalendarReviewDialog,describeWhen,localInput,type CalendarReview} from '../components/google-calendar';

const review=(o:Partial<CalendarReview>={}):CalendarReview=>({ticket:'t'.repeat(30),action:'create',account:{email:'owner@studio.test'},calendar_id:'primary',title:'Discovery call',
 when:{all_day:false,start:'2026-12-01T14:00:00.000Z',end:'2026-12-01T14:30:00.000Z',time_zone:'America/New_York'},
 plan:{send_updates:'all',notified:['lee@park.test','sam@site.test'],added:['lee@park.test','sam@site.test'],removed:[],kept:[]},warnings:[],...o});
const render=(r:CalendarReview)=>renderToStaticMarkup(createElement(CalendarReviewDialog,{review:r,busy:false,onConfirm:()=>undefined,onBack:()=>undefined}));

test('the review names the calendar account, the time in its zone and every person Google will email; saving starts disabled',()=>{
 const html=render(review());
 assert.match(html,/Create “Discovery call” in owner@studio\.test\?/);
 assert.match(html,/09:00.*America\/New_York/);
 assert.match(html,/these 2 people an invitation/);
 assert.ok(html.includes('lee@park.test')&&html.includes('sam@site.test'));
 assert.match(html,/<button[^>]*disabled=""[^>]*>Create and email 2 people<\/button>/,'nothing is sent until every address is ticked');
});

test('cancellations and quiet changes say exactly what happens; customer text stays inert',()=>{
 const cancel=render(review({action:'cancel',title:'<img src=x onerror=alert(1)>',plan:{send_updates:'all',notified:['lee@park.test'],added:[],removed:['lee@park.test'],kept:[]}}));
 assert.match(cancel,/this person a cancellation/);assert.ok(!cancel.includes('<img'));
 const quiet=render(review({action:'update',plan:{send_updates:'none',notified:[],added:[],removed:[],kept:['lee@park.test']},warnings:['Google will not email anyone.']}));
 assert.match(quiet,/Nobody will be emailed/);
 assert.match(quiet,/<button[^>]*>Save changes to without emailing anyone<\/button>/);
 assert.ok(!/<button[^>]*disabled=""[^>]*>Save changes to/.test(quiet));
});

test('times shown and edited in the event zone, including all-day ranges',()=>{
 assert.equal(localInput('2027-03-14T14:30:00.000Z','America/New_York'),'2027-03-14T10:30');
 assert.equal(localInput('2026-11-01T06:30:00.000Z','America/New_York'),'2026-11-01T01:30');
 assert.equal(describeWhen({all_day:true,start_date:'2026-12-01',end_date:'2026-12-01'}),'2026-12-01 (all day)');
 assert.equal(describeWhen({all_day:true,start_date:'2026-12-01',end_date:'2026-12-03'}),'2026-12-01 to 2026-12-03 (all day)');
});
