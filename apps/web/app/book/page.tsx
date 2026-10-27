import type {Metadata} from 'next';
export const metadata:Metadata={title:'Book a consultation | Onixus Workspace',robots:{index:false,follow:false}};
export default async function BookingPage({searchParams}:{searchParams:Promise<{calendar?:string|string[]}>}){
 const {calendar}=await searchParams;
 if(typeof calendar!=='string'||! /^[A-Za-z0-9_-]{5,300}$/.test(calendar))return <main style={{maxWidth:760,margin:'48px auto',padding:24}}><h1>Choose a booking page</h1><p>Open the complete booking link from your invitation to see available appointments.</p></main>;
 const url=`https://calendar.google.com/calendar/appointments/schedules/${calendar}`;
 return <main style={{maxWidth:1100,margin:'0 auto',padding:'24px 16px',minHeight:'100dvh'}}><header><p>Onixus Workspace · Scheduling</p><h1>Book a consultation</h1><p>Choose an available date and time below. Google Calendar handles booking confirmation and the calendar invitation.</p></header><iframe title="Choose an appointment time" src={`${url}?gv=true`} loading="eager" style={{border:0,width:'100%',height:'min(850px, 80dvh)',minHeight:600,background:'#fff',borderRadius:16}} referrerPolicy="strict-origin-when-cross-origin"/><p>If the booking page does not load, <a href={url} target="_blank" rel="noopener noreferrer">open it in Google Calendar</a>.</p></main>;
}
