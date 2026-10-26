export type MailHealth={paused?:boolean;health?:{at:string;error?:string|null;reconnect?:boolean;running?:boolean;current_handled?:number;current_failed?:number;last_progress_at?:string;started_at?:string;last_model?:string}|null};
/** A linked mailbox is not evidence of a healthy processing worker. */
export function mailHealthSummary(data:MailHealth|null,now=Date.now()){
 if(data?.paused)return {label:'Processing paused',healthy:false};
 const status=data?.health;
 if(!status)return {label:'Connected · scan not verified',healthy:false};
 if(status.running){const progress=Date.parse(status.last_progress_at??status.started_at??status.at);if(!Number.isFinite(progress)||now-progress>600000)return {label:'Scan needs attention',healthy:false};return {label:`Processing inbox · ${status.current_handled??0} handled${status.current_failed?` · ${status.current_failed} failed`:''}`,healthy:false};}
 if(status.reconnect)return {label:'Mailbox needs reconnecting',healthy:false};
 if(status.error)return {label:'Processing needs attention',healthy:false};
 const at=Date.parse(status.at);if(!Number.isFinite(at)||now-at>600000)return {label:'Connected · scan overdue',healthy:false};
 return {label:'Connected · last scan passed',healthy:true};
}
