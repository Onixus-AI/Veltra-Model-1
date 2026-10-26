import test from 'node:test';
import assert from 'node:assert/strict';
import {addMinutes,defaultEventZone,emptyForm,formWhen,normalizeZone,setWhen,validDate,validTime,zoneOptions,type EventForm} from '../lib/revenue/calendar-form';

test('new events use my time zone, then the calendar’s, then the browser’s, and UTC is called UTC',()=>{
 assert.equal(defaultEventZone({user:'Europe/Paris',calendar:'America/New_York',browser:'UTC'}),'Europe/Paris');
 assert.equal(defaultEventZone({user:null,calendar:'America/New_York',browser:'Etc/UTC'}),'America/New_York');
 assert.equal(defaultEventZone({user:'Not/AZone',calendar:null,browser:'Asia/Tokyo'}),'Asia/Tokyo');
 assert.equal(defaultEventZone({browser:'Etc/UTC'}),'UTC');
 assert.equal(defaultEventZone({}),'UTC');
 for(const alias of ['Etc/UTC','Etc/GMT','GMT','Etc/Universal','Zulu'])assert.equal(normalizeZone(alias),'UTC');
 assert.equal(normalizeZone('Africa/Abidjan'),'Africa/Abidjan');
});

test('zone choices start with UTC, drop its aliases and always include the zone in use',()=>{
 const supported=['Africa/Abidjan','America/New_York','Etc/UTC'];
 const options=zoneOptions(supported,['Pacific/Chatham']);
 assert.equal(options[0],'UTC');
 assert.deepEqual(options,['UTC','Africa/Abidjan','America/New_York','Pacific/Chatham']);
 assert.equal(zoneOptions([],['UTC']).length,1,'UTC is never listed twice');
});

test('dates and times must be complete and real',()=>{
 assert.ok(validDate('2026-10-27'));
 for(const bad of ['','2026-10-2','1027620-10-27','2026-02-30','0999-01-01','2026/10/27'])assert.equal(validDate(bad),false,bad);
 assert.ok(validTime('17:00'));
 for(const bad of ['','7:00','24:00','12:60','02:06 PM'])assert.equal(validTime(bad),false,bad);
});

const typed=(f:EventForm,steps:[Parameters<typeof setWhen>[1],string][])=>steps.reduce((x,[k,v])=>setWhen(x,k,v),f);

test('the end follows the start by 30 minutes until the person picks an end, keeping the length',()=>{
 let f=typed(emptyForm('America/New_York'),[['start_date','2026-10-27'],['start_time','17:00']]);
 assert.deepEqual([f.end_date,f.end_time],['2026-10-27','17:30']);
 f=setWhen(f,'end_time','17:15');
 f=setWhen(f,'start_time','18:00');
 assert.deepEqual([f.end_date,f.end_time],['2026-10-27','17:15'],'a chosen end is never moved');
 const fresh=typed(emptyForm('UTC'),[['start_date','2026-12-31'],['start_time','23:45']]);
 assert.deepEqual([fresh.end_date,fresh.end_time],['2027-01-01','00:15'],'crosses midnight and the year');
});

test('half-typed values are kept as typed and never reformatted',()=>{
 const f=typed(emptyForm('UTC'),[['start_date','2026-10-27'],['start_time','']]);
 assert.equal(f.start_time,'');
 assert.equal(f.start_date,'2026-10-27');
 assert.match(formWhen(f).error!,/start date and time/);
 const g=setWhen(f,'start_date','');
 assert.equal(g.start_date,'');
 assert.equal(g.end_date,'2026-10-27','an incomplete start leaves the end alone');
});

test('the approved test slot is 21:00–21:15 UTC; DST gaps are refused and repeated hours accepted',()=>{
 const base={...emptyForm('America/New_York'),start_date:'2026-10-27',start_time:'17:00',end_date:'2026-10-27',end_time:'17:15'};
 assert.deepEqual(formWhen(base),{start:'2026-10-27T17:00',end:'2026-10-27T17:15'});
 assert.match(formWhen({...base,start_date:'2027-03-14',start_time:'02:30',end_date:'2027-03-14',end_time:'03:30'}).error!,/does not exist in America\/New_York/);
 assert.deepEqual(formWhen({...base,start_date:'2026-11-01',start_time:'01:30',end_date:'2026-11-01',end_time:'02:00'}),{start:'2026-11-01T01:30',end:'2026-11-01T02:00'});
 assert.match(formWhen({...base,end_time:'16:45'}).error!,/end after it starts/);
 assert.deepEqual(addMinutes('2027-03-14','01:45',30),{date:'2027-03-14',time:'02:15'},'wall-clock arithmetic; the zone check happens on review');
});

test('all-day keeps the dates and the hidden times; end date defaults to the start date',()=>{
 let f=typed({...emptyForm('UTC'),all_day:true},[['start_date','2026-10-27']]);
 assert.equal(f.end_date,'2026-10-27');
 assert.deepEqual(formWhen(f),{start:'2026-10-27',end:'2026-10-27'});
 f=typed({...emptyForm('UTC')},[['start_date','2026-10-27'],['start_time','09:00']]);
 const back={...{...f,all_day:true},all_day:false};
 assert.deepEqual([back.start_time,back.end_time],['09:00','09:30']);
});
