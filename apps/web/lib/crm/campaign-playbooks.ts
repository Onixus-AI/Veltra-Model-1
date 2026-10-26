export const campaignPlaybooks=[
 {id:'introduce',name:'Introduce your business',description:'Start a relevant conversation with a new prospect.',audience:'Choose prospects who are a good fit for your offer.',timing:'Introduction → follow-up after 3 days'},
 {id:'reconnect',name:'Reconnect with customers',description:'Open the door to another conversation.',audience:'Choose existing contacts you want to hear from again.',timing:'Check-in → follow-up after 5 days'},
 {id:'meeting',name:'Book a conversation',description:'Invite the right people to a call or consultation.',audience:'Choose people who would benefit from a conversation.',timing:'Invitation → reminder after 3 days'},
 {id:'proposal',name:'Follow up on a proposal',description:'Help a customer take the next step on your offer.',audience:'Choose only customers who have received the proposal you describe.',timing:'Proposal check-in → follow-up after 3 days'},
 {id:'welcome',name:'Welcome a customer',description:'Share a clear next step with a new customer.',audience:'Choose only new customers who should receive this welcome.',timing:'Welcome → check-in after 7 days'},
] as const;
export type PlaybookId=typeof campaignPlaybooks[number]['id'];
export type CampaignStep={subject:string;body:string;delay_days:number};
export function playbookSteps(id:PlaybookId,business:string,offer:string,booking=''):CampaignStep[]{
 const signature=business.trim(),detail=offer.trim(),cta=booking.trim()?`Choose a time here: ${booking.trim()}`:'Reply with a time that works for you.';
 const content:Record<PlaybookId,[string,string,string,string,number]>={
 introduce:['An idea for {{company}}',`I’m reaching out from ${signature}.\n\n${detail}\n\nWould this be useful for {{company}}?`,'Worth a conversation?',`Would you like to learn more about the offer below?\n\n${detail}\n\n${cta}`,3],
 reconnect:['A quick check-in for {{company}}',`I wanted to connect and see what your team is focused on.\n\n${detail}\n\nIs there something we can help you with?`,'Any questions?',`If this is relevant to {{company}}, I’m happy to discuss the details.\n\n${detail}\n\n${cta}`,5],
 meeting:['A conversation about {{company}}',`${detail}\n\nWould you be open to a conversation with ${signature}?\n\n${cta}`,'Would another time work?',`Would a conversation about this be useful?\n\n${detail}\n\n${cta}`,3],
 proposal:['Next steps for {{company}}',`I’m checking in on the proposal we shared.\n\n${detail}\n\nWhat questions can I answer to help you decide on the next step?`,'Questions about the proposal?',`Is there anything you would like to clarify about the proposal?\n\n${detail}\n\n${cta}`,3],
 welcome:['Welcome to '+signature,`Thanks for choosing ${signature}.\n\n${detail}\n\nReply here if you have any questions about getting started.`,'How is getting started going?',`Is there anything you need help with as you get started?\n\n${detail}\n\nYou can reply directly to this email.`,7],
 };
 const [subject,body,followSubject,followBody,delay]=content[id];
 return [{subject,body:`Hi {{name}},\n\n${body}\n\n${signature}`,delay_days:1},{subject:followSubject,body:`Hi {{name}},\n\n${followBody}\n\n${signature}`,delay_days:delay}];
}
export function personalizedPreview(step:CampaignStep,person:{company:string;name:string},address:string){
 const render=(s:string)=>s.replace(/{{\s*(company|name)\s*}}/g,(_,key:'company'|'name')=>(person[key]||person.company).replace(/[\r\n]/g,' '));
 return {subject:render(step.subject),body:render(step.body)+`\n\n${address}\nTo stop these messages, reply STOP or unsubscribe.`};
}
