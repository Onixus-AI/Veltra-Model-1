/** Display only persisted work. A proposal is never a completed business action. */
export const workStages=['Scheduled','Working','Review','Blocked','Complete'] as const;
export type WorkStage=typeof workStages[number];
export type OperationalJob={id:string;kind:string;status:string;run_at:string;updated_at:string;finished_at:string|null;attempts:number;max_attempts:number;last_error:unknown;cancel_reason:string|null};
export function workStage(job:OperationalJob):WorkStage{
 if(job.status==='succeeded')return 'Complete';
 if(['failed','dead','cancelled','blocked'].includes(job.status))return 'Blocked';
 if(['running','claimed'].includes(job.status))return 'Working';
 if(['review','awaiting_review','draft'].includes(job.status))return 'Review';
 return 'Scheduled';
}
export function blockerText(job:OperationalJob){if(job.cancel_reason)return job.cancel_reason;if(typeof job.last_error==='string')return job.last_error;if(job.last_error&&typeof job.last_error==='object'&&'message' in job.last_error)return String(job.last_error.message);return workStage(job)==='Blocked'?'Open the source job to inspect its blocker.':null;}
export const dailyRoutine=[
 {owner:'onyx',title:'Inspect the business',detail:'Check overdue commitments, unanswered enquiries, failed jobs and upcoming work.'},
 {owner:'onixa',title:'Choose the next improvement',detail:'Evaluate evidence, urgency and expected benefit before assigning work.'},
 {owner:'onixelia',title:'Execute permitted work',detail:'Run supported tasks within the business permissions and record attempts and blockers.'},
 {owner:'onyx',title:'Verify the result',detail:'Check the source receipt and outcome before calling a business action complete.'},
 {owner:'onixa',title:'Improve the industry playbook',detail:'Propose a reusable procedure from verified outcomes. Review it before reuse; exclude client data.'},
] as const;
