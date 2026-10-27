/** Only Google's public appointment pages may be embedded. Never embed arbitrary saved URLs. */
export function googleBookingId(value:string):string|null{
 try{const url=new URL(value);if(url.protocol!=='https:'||url.hostname!=='calendar.google.com'||url.username||url.password||url.port)return null;
 const match=/^\/calendar\/appointments\/schedules\/([A-Za-z0-9_-]{5,300})\/?$/.exec(url.pathname);return match?.[1]??null;
 }catch{return null;}
}
export function campaignBookingLink(value:string,origin:string):string{
 const id=googleBookingId(value);return id?`${new URL(origin).origin}/book?calendar=${encodeURIComponent(id)}`:value;
}
