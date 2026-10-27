import {test} from 'node:test';import assert from 'node:assert/strict';
import {googleBookingId,campaignBookingLink} from '../lib/crm/booking-link';
test('booking embeds accept only public Google appointment schedule IDs',()=>{
 const url='https://calendar.google.com/calendar/appointments/schedules/AcZssZ_fixture-123?gv=true';
 assert.equal(googleBookingId(url),'AcZssZ_fixture-123');
 assert.equal(campaignBookingLink(url,'https://workspace.example/else'),'https://workspace.example/book?calendar=AcZssZ_fixture-123');
 for(const bad of ['https://calendar.google.com.evil.test/calendar/appointments/schedules/valid','https://evil.test/book','javascript:alert(1)','https://user@calendar.google.com/calendar/appointments/schedules/valid','https://calendar.google.com/calendar/u/0/r'])assert.equal(googleBookingId(bad),null);
 assert.equal(campaignBookingLink('https://calendly.com/example','https://workspace.example'),'https://calendly.com/example');
});
