'use client';
import { useState } from 'react';
import Link from 'next/link';
import { BUSINESS_SETUP_PACKAGES, PLANS, TOP_UP_PACKS, TRIAL_DAYS, businessMonthlyCredits, businessMonthlyPriceCents } from '@/lib/plan-catalog';
import './plan-packages.css';
const money = (cents:number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:cents%100?2:0}).format(cents/100);
export default function PlanPackages(){
 const [users,setUsers]=useState(1);
 const [setup,setSetup]=useState<'launch'|'growth'>('launch');
 const selectedSetup=BUSINESS_SETUP_PACKAGES.find(p=>p.id===setup)!;
 const monthly=businessMonthlyPriceCents(users);
 return <section id="workspace-plans" className="workspace-packages scroll-mt-28" aria-labelledby="workspace-plan-heading">
  <header><h2 id="workspace-plan-heading">One workspace. Choose your way.</h2><p>Software access and an AI allowance in every plan. Business OS is included in Business.</p></header>
  <div className="workspace-plan-grid">{PLANS.map(plan=><article className={`workspace-plan ${plan.business?'workspace-plan-business':''}`} key={plan.id}>
   <h3>{plan.name}</h3><p>{plan.description}</p><div className="workspace-plan-price"><strong>{money(plan.business?monthly:plan.priceCents)}</strong><span>/month</span></div>
   {plan.business?<label className="workspace-users">Paid users<input type="number" min={1} max={10000} step={1} value={users} onChange={e=>{const n=Number(e.target.value);if(Number.isSafeInteger(n)&&n>=1&&n<=10000)setUsers(n);}}/><small>First user included. Each additional user adds $35/month and 7,000 shared credits.</small></label>:<p className="workspace-seat">One user · self-service</p>}
   <p className="workspace-credit-amount"><strong>{(plan.business?businessMonthlyCredits(users):plan.credits).toLocaleString()}</strong> monthly AI credits</p>
   <ul>{plan.features.map(feature=><li key={feature}>{feature}</li>)}</ul>
   {!plan.business&&<p className="workspace-plan-note">Business CRM, Mail automation and campaigns require Business.</p>}
   <Link className="workspace-plan-link" href={`https://www.onixus.xyz/contact?objective=${encodeURIComponent(`Request ${plan.name} Workspace${plan.business?` for ${users} paid users`:''}`)}`}>Request {plan.name}</Link>
  </article>)}</div>
  <section id="business-setup" className="workspace-setup" aria-labelledby="setup-heading"><div><h2 id="setup-heading">Business setup. Done with you.</h2><p>Choose one onboarding package. Growth replaces Launch; you never pay both. Personal, Creator and Dev have no mandatory setup fee.</p></div>
   <div className="workspace-setup-options">{BUSINESS_SETUP_PACKAGES.map(p=><button type="button" key={p.id} aria-pressed={setup===p.id} onClick={()=>setSetup(p.id)}><span>{p.name}</span><strong>{money(p.priceCents)} once</strong><span>{p.description}</span></button>)}</div>
   <div className="workspace-estimate" aria-live="polite"><h3>Your Business estimate · {users} {users===1?'user':'users'}</h3><dl><div><dt>One-time {selectedSetup.name} setup</dt><dd>{money(selectedSetup.priceCents)}</dd></div><div><dt>Monthly subscription</dt><dd>{money(monthly)}/month</dd></div><div><dt>Setup + first paid month</dt><dd>{money(monthly+selectedSetup.priceCents)}</dd></div></dl><p>Before applicable taxes. Trial dates and when setup is payable must be confirmed in your order. Extra usage and external services are separate.</p><Link href={`https://www.onixus.xyz/contact?objective=${encodeURIComponent(`${selectedSetup.name}: ${users} Business users; setup ${money(selectedSetup.priceCents)}; subscription ${money(monthly)}/month; first paid month plus setup ${money(monthly+selectedSetup.priceCents)}`)}`}>Request this package</Link></div>
   <p>Need migration, multiple workflows or custom integrations? <Link href="https://www.onixus.xyz/book">Scope a custom implementation.</Link> Custom scope and pricing agreed before work begins.</p>
  </section>
  <div className="workspace-plan-details"><section><h3>Credits that follow actual usage</h3><p>New-plan definition: 1,000 credits covers $1 of provider usage. Token quantities vary by model; image, video and voice costs also count. Economical routing can stretch the allowance but free capacity is not guaranteed.</p><p>These allocations require cost-backed metering before activation. Your existing balance is not revalued or converted by this page.</p></section><section><h3>Optional top-ups</h3>{TOP_UP_PACKS.map(p=><p key={p.id}><strong>{money(p.priceCents)}</strong> · {p.credits.toLocaleString()} additional credits · one-time purchase</p>)}<p>No automatic top-up purchase. Credit expiry and rollover terms must be shown before enrollment.</p></section><section><h3>{TRIAL_DAYS}-day trial</h3><p>Card required when trial enrollment is enabled. You’ll see the trial allowance, first subscription charge date and cancellation terms before starting. A trial does not include free setup.</p></section><section><h3>What is separate?</h3><p>Hosting, domains, ad spend, SMS, external subscriptions, custom development and ongoing human management. Connecting a tool does not include a managed service.</p></section></div>
  <p className="workspace-sales-status" role="note">New packages are available by scope request. Automated checkout, trial enrollment and the new credit conversion are not activated here. Existing subscription and renewal terms remain unchanged.</p>
 </section>;
}
