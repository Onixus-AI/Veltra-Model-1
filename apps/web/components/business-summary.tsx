'use client';
import {useEffect,useId,useState} from 'react';
import {Activity,ArrowUpRight,CalendarClock,CheckCircle2,CircleDollarSign,Clock,Inbox,Layers,MailCheck,RefreshCw,Sparkles,TrendingUp,Trophy,Users} from 'lucide-react';
import BusinessLiveActivity from './business-live-activity';
import {gatewayAuthorizationHeaders} from '@/lib/client-session';
import {businessTeam,memberName} from '@/lib/business-team/catalog';
import type {BusinessPeriod} from '@/lib/business-period';
import {change,greeting,onyxInsight,pipelineStages,replyRate,smoothPath,trendGeometry,type Metrics,type TrendBin} from '@/lib/overview-dashboard';

type Summary={trend:TrendBin[]|null;workspace:string;period:BusinessPeriod;range:{zone:string};overview:{generated_at:string;unknowns:string[];metrics:Metrics};previous:{metrics:Metrics}|null;completed:number|null;priorities:{kind:string;who:string;why:string;action:string;link:string}[];tasks:{id:string;title:string;due_at:string|null}[]|null;jobs:{id:string;kind:string;status:string;run_at:string;last_error:string|null}[]|null;team:{id:string;status:string;receipts:{member:string;action:string;status:string;at:string}[]}[]|null;reports:{id:string;report_day:string}[]|null};
const PERIODS:[BusinessPeriod,string][]=[['today','Today'],['week','Week'],['month','Month']];

export default function BusinessSummary({workspace}:{workspace:string}){return <SummaryView key={workspace} workspace={workspace}/>;}

function SummaryView({workspace}:{workspace:string}){
 const [data,setData]=useState<Summary|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[period,setPeriod]=useState<BusinessPeriod>('today'),[loading,setLoading]=useState(false);
 useEffect(()=>{let active=true,inFlight=false;const controller=new AbortController();setData(null);
  async function load(){if(inFlight)return;inFlight=true;setLoading(true);try{const response=await fetch('/api/workspace/overview?workspace='+encodeURIComponent(workspace)+'&period='+period,{headers:await gatewayAuthorizationHeaders(),cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])});if(!response.ok)throw Error();const next=await response.json();if(next.workspace!==workspace)throw Error();if(active){setData(next);setError('');}}catch{if(active)setError('Figures could not be refreshed. Try again.');}finally{inFlight=false;if(active)setLoading(false);}}
  void load();const timer=setInterval(()=>{if(!document.hidden)void load();},60000);return()=>{active=false;controller.abort();clearInterval(timer);};},[workspace,refresh,period]);
 const href=(path:string)=>path+(path.includes('?')?'&':'?')+(path.startsWith('/crm')||path.startsWith('/workspace')?'workspace=':path.startsWith('/?')?'crm_workspace=':'w=')+encodeURIComponent(workspace);
 const toolbar=(attention?:number)=><div className="ox-overview-bar">
  <p className="ox-overview-greeting">{greeting(new Date().getHours())}.{attention!=null&&<> <strong>{attention} {attention===1?'item needs':'items need'} attention</strong> {period==='today'?'today':'this '+period}.</>}</p>
  <div className="ox-overview-actions">
   <div className="ox-seg" role="group" aria-label="Reporting period">{PERIODS.map(([value,label])=><button key={value} aria-pressed={period===value} onClick={()=>setPeriod(value)}>{label}</button>)}</div>
   <button className="ox-btn" onClick={()=>setRefresh(v=>v+1)} aria-label="Refresh figures"><RefreshCw size={14} className={loading?'ox-spin':''}/>Refresh</button>
   <a className="ox-btn-primary" href="/?view=chat"><Sparkles size={15}/>Ask Onyx</a>
  </div></div>;
 if(!data)return <section className="business-summary ox-overview">{toolbar()}{error?<p role="alert" className="ox-overview-error">{error}</p>:<div className="ox-overview-loading" role="status" aria-label="Checking your business"><div className="ox-kpis">{[0,1,2,3,4].map(i=><div key={i} className="ox-card ox-skeleton" style={{height:104}}/>)}</div><div className="ox-row-trend"><div className="ox-card ox-skeleton" style={{height:300}}/><div className="ox-card ox-skeleton" style={{height:300}}/></div></div>}</section>;

 const m=data.overview.metrics,before=data.previous?.metrics,stagesOpen=Object.values(m.pipeline.open_by_stage),open=stagesOpen.reduce((n,v)=>n+v.count,0),value=stagesOpen.reduce((n,v)=>n+v.value_cents,0),mixed=m.pipeline.currencies.length>1;
 const money=(amount:number)=>new Intl.NumberFormat(undefined,{style:'currency',currency:m.pipeline.currencies[0]||'USD',maximumFractionDigits:0,notation:amount>=1e8?'compact':'standard'}).format(amount/100);
 const attention=m.outreach.awaiting_approval+m.commitments.overdue+m.failures.failed_sends+m.failures.dead_jobs;
 const kpis=[
  {label:'Open pipeline',icon:Layers,value:mixed?String(open):money(value),badge:{text:`${open} open`,tone:'brand' as const},path:'/revenue?view=pipeline',hint:'Current estimate of open opportunities'},
  {label:'Deals won',icon:Trophy,value:String(m.pipeline.won),badge:change(m.pipeline.won,before?.pipeline.won),path:'/revenue?view=pipeline',hint:'Compared with the previous elapsed period'},
  {label:'Replies received',icon:MailCheck,value:String(m.outreach.replies_received),badge:change(m.outreach.replies_received,before?.outreach.replies_received),path:'/revenue?view=mail',hint:`${m.outreach.threads_sent} threads sent`},
  {label:'Awaiting review',icon:Inbox,value:String(m.outreach.awaiting_approval),badge:m.outreach.awaiting_approval?{text:'Needs you',tone:'warn' as const}:{text:'Clear',tone:'up' as const},path:'/revenue?view=mail',hint:'Drafts that send only after approval'},
  {label:'Revenue collected',icon:CircleDollarSign,value:m.payments.known&&!mixed?money(m.payments.collected_cents):'—',badge:m.payments.known&&!mixed?change(m.payments.collected_cents,before?.payments.collected_cents):{text:'Not connected',tone:'neutral' as const},path:'/revenue?view=overview',hint:'Confirmed payments only'},
 ];
 const insight=onyxInsight(m);
 return <section className="business-summary ox-overview">
  {toolbar(attention)}
  {error&&<p role="alert" className="ox-overview-error">{error}</p>}
  <div className="ox-kpis">{kpis.map(k=><a key={k.label} className="ox-kpi" href={href(k.path)} title={k.hint}>
   <span className="ox-kpi-label"><span className="ox-icon-chip"><k.icon/></span>{k.label}</span>
   <span className="ox-kpi-value"><strong>{k.value}</strong><span className="ox-badge" data-tone={k.badge.tone}>{k.badge.text}</span></span>
  </a>)}</div>

  <div className="ox-row-trend">
   <TrendCard data={data} metrics={m} period={period} setPeriod={setPeriod}/>
   <ReplyGauge metrics={m} href={href}/>
  </div>

  <div className="ox-row-work">
   <PipelineCard metrics={m} money={mixed?null:money} href={href}/>
   <QueueCard data={data} metrics={m} href={href}/>
   <section className="ox-card ox-assistant" aria-label="Onyx assistant">
    <img className="ox-orb" src="/brands/onyx-orb-v1.webp" alt="" width={96} height={96}/>
    <p className="ox-assistant-eyebrow">Onyx assistant</p>
    <p className="ox-assistant-sub">Insight · Review first</p>
    <h3>{insight.headline}</h3>
    <p className="ox-assistant-detail">{insight.detail}</p>
    {insight.share>0&&<div className="ox-assistant-meter"><span>Share of today’s queue</span><i style={{['--fill' as string]:`${Math.round(insight.share*100)}%`}}/></div>}
    <div className="ox-assistant-actions"><a className="ox-btn-primary" href={href(insight.href)}>{insight.action}</a><a className="ox-btn-ghost" href="/?view=chat">Ask Onyx</a></div>
   </section>
  </div>

  <div className="ox-row-more">
   <section className="ox-card ox-departments" aria-labelledby="ox-departments-title">
    <header className="ox-card-head"><h2 className="ox-card-title" id="ox-departments-title"><span className="ox-icon-chip"><TrendingUp/></span>Across your business</h2></header>
    {[
     ['Sales & acquisition',`${m.leads.total} new contacts`,`${m.pipeline.won} won · ${open} open`,'Onixa','/revenue?view=pipeline'],
     ['Marketing & Signal','Review in Signal','Content and publishing calendar','Onixa','/?canvas=signal&mode=business'],
     ['Mail & customer service',`${m.outreach.replies_received} replies`,`${m.outreach.awaiting_approval} awaiting review · ${m.failures.failed_sends} failed sends`,'Onixa','/?canvas=mail&mode=business'],
     ['Operations & delivery',`${m.commitments.overdue} overdue`,`${m.bookings.upcoming} upcoming meetings · ${m.failures.dead_jobs} failed jobs`,'Onixelia','/workspace/team'],
     ['Finance',m.payments.known&&!mixed?money(m.payments.outstanding_cents)+' outstanding':'Payments not connected','Only confirmed payments count','Onyx','/revenue?view=overview'],
    ].map(([name,result,detail,owner,path])=><a className="ox-department" href={href(path)} key={name}><span><strong>{name}</strong><small>{detail}</small></span><span className="ox-department-result">{result}</span><span className="ox-pill" data-tone="brand">{owner}</span><ArrowUpRight size={15} aria-hidden/></a>)}
   </section>
   <section className="ox-card ox-team" aria-labelledby="ox-team-title">
    <header className="ox-card-head"><h2 className="ox-card-title" id="ox-team-title"><span className="ox-icon-chip"><Users/></span>Your business team</h2><a className="ox-link" href={href('/workspace/team')}>Receipts <ArrowUpRight size={13}/></a></header>
    {businessTeam.map(member=>{const receipt=data.team?.flatMap(job=>job.receipts).filter(r=>r.member===member.id).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];return <a href={href('/workspace/team')} key={member.id} className="ox-member"><img src={'/team/'+member.id+'-v1.png'} alt=""/><span><strong>{memberName(member.id)}</strong><small>{member.id==='onyx'?'Build & lead':member.id==='onixa'?'Grow':'Automate'}</small></span><span className="ox-member-receipt">{receipt?<><span className="ox-pill" data-tone={receipt.status==='succeeded'||receipt.status==='completed'?'ok':receipt.status==='failed'?'urgent':'warn'}><i/>{receipt.status}</span><small>{receipt.action}</small></>:<small>No recent receipt</small>}</span></a>;})}
   </section>
   <section className="ox-card ox-live" aria-label="Live activity"><header className="ox-card-head"><h2 className="ox-card-title"><span className="ox-icon-chip"><Activity/></span>Live activity</h2></header><BusinessLiveActivity workspace={workspace} task={null} inline/></section>
  </div>

  <footer className="ox-overview-foot">
   <span>Checked {new Date(data.overview.generated_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})} · {data.range.zone}</span>
   <a className="ox-link" href={href('/workspace/team')+(data.reports?.[0]?'&report='+data.reports[0].id:'')}>{data.reports?.[0]?'Daily report · '+data.reports[0].report_day:'Daily report settings'} <ArrowUpRight size={13}/></a>
   <details><summary>What these figures include</summary><p>New contact records are not qualified leads. A won deal is not necessarily a new customer. Completed jobs do not prove revenue. Spend and website health stay unmeasured until their sources are connected.</p>{data.overview.unknowns.map(note=><p key={note}>{note}</p>)}</details>
  </footer>
 </section>;
}

function TrendCard({data,metrics,period,setPeriod}:{data:Summary;metrics:Metrics;period:BusinessPeriod;setPeriod:(p:BusinessPeriod)=>void}){
 const id=useId().replace(/:/g,''),[hover,setHover]=useState<number|null>(null);
 const trend=data.trend??[],g=trendGeometry(trend),sent=smoothPath(g.sent),completed=smoothPath(g.completed);
 const totals={sent:trend.reduce((n,b)=>n+b.sent,0),completed:trend.reduce((n,b)=>n+b.completed,0),contacts:trend.reduce((n,b)=>n+b.contacts,0)};
 const label=(at:string)=>{const d=new Date(at);return period==='today'?d.toLocaleTimeString([], {hour:'numeric'}):d.toLocaleDateString([], {month:'short',day:'numeric'});};
 const ticks=trend.length?[0,Math.floor((trend.length-1)/2),trend.length-1].filter((v,i,a)=>a.indexOf(v)===i):[];
 const bin=hover!=null?trend[hover]:null;
 return <section className="ox-card ox-trend" aria-labelledby={`${id}-title`}>
  <header className="ox-card-head"><h2 className="ox-card-title" id={`${id}-title`}><span className="ox-icon-chip"><Activity/></span>Emails sent vs work completed</h2><div className="ox-seg" role="group" aria-label="Chart period">{PERIODS.map(([value,text])=><button key={value} aria-pressed={period===value} onClick={()=>setPeriod(value)}>{text==='Today'?'1D':text==='Week'?'7D':'30D'}</button>)}</div></header>
  <dl className="ox-trend-stats"><div><dt>Emails sent</dt><dd><i data-series="sent"/>{totals.sent.toLocaleString()}</dd></div><div><dt>Work completed</dt><dd><i data-series="completed"/>{totals.completed.toLocaleString()}</dd></div><div><dt>New contacts</dt><dd><i data-series="contacts"/>{totals.contacts.toLocaleString()}</dd></div><div><dt>Replies</dt><dd className="ox-gradient-text">+{metrics.outreach.replies_received}</dd></div></dl>
  {trend.length?<div className="ox-trend-plot" onMouseLeave={()=>setHover(null)}>
   <svg viewBox={`0 0 ${g.width} ${g.height}`} role="img" aria-label={`Emails sent ${totals.sent}, work completed ${totals.completed}, new contacts ${totals.contacts}`} preserveAspectRatio="none">
    <defs>
     <linearGradient id={`${id}-sent`} x1="0" x2="1"><stop offset="0" stopColor="#b300ff"/><stop offset=".55" stopColor="#ff00b8"/><stop offset="1" stopColor="#00e5ef"/></linearGradient>
     <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#ff00b8" stopOpacity=".22"/><stop offset="1" stopColor="#b300ff" stopOpacity="0"/></linearGradient>
     <linearGradient id={`${id}-col`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#ffffff" stopOpacity=".09"/><stop offset="1" stopColor="#ffffff" stopOpacity=".02"/></linearGradient>
    </defs>
    {[0,1,2,3].map(i=><line key={i} className="ox-grid-line" x1="0" x2={g.width} y1={14+i*((g.height-40)/3)} y2={14+i*((g.height-40)/3)}/>)}
    {g.columns.map((c,i)=><rect key={i} x={c.x} y={g.height-26-c.height} width={c.width} height={c.height} rx="5" fill={hover===i?'rgba(0,229,239,.16)':`url(#${id}-col)`}/>)}
    {g.sent.length>1&&<path d={`${sent} L${g.sent[g.sent.length-1][0]},${g.height-26} L${g.sent[0][0]},${g.height-26} Z`} fill={`url(#${id}-fill)`}/>}
    <path d={completed} fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="1.6" strokeDasharray="4 5" vectorEffect="non-scaling-stroke"/>
    <path d={sent} fill="none" stroke={`url(#${id}-sent)`} strokeWidth="2.6" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
    {hover!=null&&<g><line x1={g.sent[hover][0]} x2={g.sent[hover][0]} y1="10" y2={g.height-26} stroke="rgba(255,255,255,.2)" strokeDasharray="2 4"/><circle cx={g.sent[hover][0]} cy={g.sent[hover][1]} r="4.5" fill="#07060b" stroke="#ff5fcf" strokeWidth="2"/><circle cx={g.completed[hover][0]} cy={g.completed[hover][1]} r="4" fill="#07060b" stroke="#fff" strokeWidth="1.6"/></g>}
    {trend.map((b,i)=><rect key={b.at} x={(g.sent[i]?.[0]??0)-g.width/trend.length/2} y="0" width={g.width/trend.length} height={g.height} fill="transparent" onMouseEnter={()=>setHover(i)} onFocus={()=>setHover(i)} tabIndex={-1}/>)}
   </svg>
   <div className="ox-trend-axis">{ticks.map(i=><span key={i}>{label(trend[i].at)}</span>)}</div>
   {bin&&<div className="ox-tooltip" style={{left:`${(g.sent[hover!][0]/g.width)*100}%`}} role="status"><strong>{label(bin.at)}</strong><span><i data-series="sent"/>Sent <b>{bin.sent}</b></span><span><i data-series="completed"/>Completed <b>{bin.completed}</b></span><span><i data-series="contacts"/>Contacts <b>{bin.contacts}</b></span></div>}
  </div>:<p className="ox-empty">No recorded activity in this period yet.</p>}
 </section>;
}

function ReplyGauge({metrics,href}:{metrics:Metrics;href:(p:string)=>string}){
 const rate=replyRate(metrics),ticks=44,lit=rate==null?0:Math.round(rate/100*ticks),cx=120,cy=118,r1=82,r2=100;
 const color=(i:number)=>{const t=i/(ticks-1);const stops=[[179,0,255],[255,0,184],[0,229,239]];const seg=t<.5?0:1,local=t<.5?t*2:(t-.5)*2;const a=stops[seg],b=stops[seg+1];return `rgb(${a.map((v,k)=>Math.round(v+(b[k]-v)*local)).join(',')})`;};
 return <section className="ox-card ox-gauge" aria-labelledby="ox-gauge-title">
  <header className="ox-card-head"><h2 className="ox-card-title" id="ox-gauge-title"><span className="ox-icon-chip"><Clock/></span>Reply rate</h2><a className="ox-icon-link" href={href('/revenue?view=mail')} aria-label="Open Mail results"><ArrowUpRight size={15}/></a></header>
  <div className="ox-gauge-body">
   <svg viewBox="0 0 240 150" role="img" aria-label={rate==null?'No emails sent yet':`${rate}% of sent threads received a reply`}>
    {Array.from({length:ticks},(_,i)=>{const a=Math.PI*(1.08-i/(ticks-1)*1.16);const long=i%4===0;return <line key={i} x1={cx+Math.cos(a)*(long?r1-4:r1)} y1={cy-Math.sin(a)*(long?r1-4:r1)} x2={cx+Math.cos(a)*r2} y2={cy-Math.sin(a)*r2} stroke={i<lit?color(i):'rgba(255,255,255,.1)'} strokeWidth={long?3:2.2} strokeLinecap="round"/>;})}
    <text x={cx} y={cy-6} textAnchor="middle" className="ox-gauge-value">{rate==null?'—':rate}<tspan className="ox-gauge-unit" dx="2">{rate==null?'':'%'}</tspan></text>
    <text x={cx} y={cy+16} textAnchor="middle" className="ox-gauge-caption">{metrics.outreach.replies_received} of {metrics.outreach.threads_sent} threads replied</text>
   </svg>
   <div className="ox-gauge-side">
    <div><span className="ox-label">Awaiting approval</span><strong>{metrics.outreach.awaiting_approval}</strong><small>drafts send only after you approve</small></div>
    <div><span className="ox-label">Due today</span><strong>{metrics.commitments.due_today}</strong><small>{metrics.commitments.overdue} already overdue</small></div>
   </div>
  </div>
 </section>;
}

function PipelineCard({metrics,money,href}:{metrics:Metrics;money:((n:number)=>string)|null;href:(p:string)=>string}){
 const stages=pipelineStages(metrics),segments=16,open=stages.reduce((n,s)=>n+s.count,0);
 return <section className="ox-card ox-pipeline" aria-labelledby="ox-pipeline-title">
  <header className="ox-card-head"><div><h2 className="ox-card-title" id="ox-pipeline-title"><span className="ox-icon-chip"><Layers/></span>Open pipeline</h2><p className="ox-card-sub">{open} active · by stage</p></div><a className="ox-icon-link" href={href('/revenue?view=pipeline')} aria-label="Open pipeline"><ArrowUpRight size={15}/></a></header>
  {stages.length?<div className="ox-stage-bars" role="list">{stages.map((s,i)=><div role="listitem" key={s.name} className="ox-stage" title={money?`${s.name}: ${s.count} · ${money(s.value_cents)}`:`${s.name}: ${s.count}`} data-lost={/lost/i.test(s.name)||undefined}>
   <div className="ox-stage-stack" aria-hidden>{Array.from({length:segments},(_,k)=><i key={k} data-on={segments-k<=s.filled||undefined} style={{['--stage-hue' as string]:String(i)}}/>)}</div>
   <span className="ox-stage-name">{s.name.replaceAll('_',' ')}</span><strong>{s.count}</strong>
  </div>)}</div>:<p className="ox-empty">No open opportunities yet.</p>}
 </section>;
}

function QueueCard({data,metrics,href}:{data:Summary;metrics:Metrics;href:(p:string)=>string}){
 const [tab,setTab]=useState<'attention'|'today'|'jobs'>('attention');
 const tabs:[typeof tab,string,number|null][]=[['attention','Needs attention',data.priorities.length],['today','Due today',data.tasks?.length??null],['jobs','Workflows',data.jobs?.length??null]];
 const when=(at:string|null)=>{if(!at)return '—';const ms=Date.parse(at)-Date.now(),h=Math.round(Math.abs(ms)/36e5);return h<1?'now':h<24?`${h} h${ms<0?' ago':''}`:`${Math.round(h/24)} d${ms<0?' ago':''}`;};
 return <section className="ox-card ox-queue" aria-label="Work queue">
  <div className="ox-tabs" role="tablist">{tabs.map(([key,label,count])=><button key={key} role="tab" aria-selected={tab===key} onClick={()=>setTab(key)}>{label}{count!=null&&<span className="ox-badge" data-tone={key==='attention'&&count?'down':'neutral'}>{count}</span>}</button>)}</div>
  {tab==='attention'&&(data.priorities.length?<table className="ox-table"><thead><tr><th>Who</th><th>Why</th><th>Next step</th></tr></thead><tbody>{data.priorities.map((p,i)=><tr key={p.kind+i}><td className="ox-primary-cell"><strong>{p.who||'Business'}</strong><small>{p.kind.replaceAll('_',' ')}</small></td><td>{p.why}</td><td><a className="ox-pill" data-tone={/overdue|failed|lapse/i.test(p.why)?'urgent':'warn'} href={href(p.link)}><i/>{p.action}</a></td></tr>)}</tbody></table>:<p className="ox-empty"><CheckCircle2 size={16}/> Nothing in the checked queues needs you.</p>)}
  {tab==='today'&&(data.tasks===null?<p className="ox-empty">Commitments could not be loaded.</p>:data.tasks.length?<table className="ox-table"><thead><tr><th>Commitment</th><th>Due</th></tr></thead><tbody>{data.tasks.map(t=><tr key={t.id}><td className="ox-primary-cell"><strong>{t.title}</strong></td><td><span className="ox-pill" data-tone={t.due_at&&Date.parse(t.due_at)<Date.now()?'urgent':'brand'}><CalendarClock size={12}/>{when(t.due_at)}</span></td></tr>)}</tbody></table>:<p className="ox-empty">No open commitments recorded.</p>)}
  {tab==='jobs'&&(data.jobs===null?<p className="ox-empty">Workflow queue could not be loaded.</p>:data.jobs.length?<table className="ox-table"><thead><tr><th>Workflow</th><th>Status</th><th>Runs</th></tr></thead><tbody>{data.jobs.map(j=><tr key={j.id}><td className="ox-primary-cell"><strong>{j.kind.replaceAll('.',' ').replaceAll('_',' ')}</strong>{j.last_error&&<small>{j.last_error.slice(0,60)}</small>}</td><td><span className="ox-pill" data-tone={j.status==='failed'||j.status==='dead'?'urgent':j.status==='succeeded'?'ok':'brand'}><i/>{j.status}</span></td><td className="ox-mono">{when(j.run_at)}</td></tr>)}</tbody></table>:<p className="ox-empty">No scheduled workflows.</p>)}
  <footer className="ox-queue-foot"><span>{metrics.commitments.overdue} overdue{metrics.failures.paused?' · Automation paused':''}</span><a className="ox-link" href={href('/workspace/team')}>Open queue <ArrowUpRight size={13}/></a></footer>
 </section>;
}
