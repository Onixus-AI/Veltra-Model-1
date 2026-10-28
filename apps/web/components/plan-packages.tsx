'use client';
import Link from 'next/link';
import {useState} from 'react';
import {PLANS,TOP_UP_PACKS,TRIAL_DAYS,businessMonthlyPriceCents} from '@/lib/plan-catalog';
import './plan-packages.css';
const dollars=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:cents%100?2:0}).format(cents/100);
export default function PlanPackages(){
 const [users,setUsers]=useState(1);
 return <section className="plan-packages" aria-labelledby="package-heading">
  <header><h2 id="package-heading">Your workspace. Your way.</h2><p>Website Builder in every plan. Draft visually, then use your credits for AI generation. Buy extra credits only when you choose.</p></header>
  <div className="package-grid">{PLANS.map(plan=><article key={plan.id} className="package-option">
   <h3>{plan.name}</h3><p>{plan.description}</p><div className="package-price"><strong>{dollars(plan.business?businessMonthlyPriceCents(users):plan.priceCents)}</strong><span>/month</span></div>
   {plan.business?<label className="package-users">Paid users<input type="number" min={1} max={10000} step={1} value={users} onChange={e=>{const n=Number(e.target.value);if(Number.isSafeInteger(n)&&n>=1&&n<=10000)setUsers(n);}}/><small>First user included. $30/month per additional user; included credits increase with each paid user.</small></label>:<p className="package-seat">One user</p>}
   <ul>{plan.features.map(feature=><li key={feature}>{feature}</li>)}</ul>
   {!plan.business&&<p className="package-exclusion">CRM, business Mail automation and campaigns are Business features.</p>}
  </article>)}</div>
  <div className="package-details"><section><h3>{TRIAL_DAYS}-day free trial</h3><p>Credit or debit card required when signup opens. Review the selected subscription price and first billing date before starting.</p></section><section><h3>Top up when you need to</h3><p>{TOP_UP_PACKS.map(pack=>dollars(pack.priceCents)).join(' or ')} one-time credit packs, separate from your subscription.</p></section></div>
  <p className="package-availability" role="status">Package configuration preview. Checkout, trial enrollment and plan enforcement are not active. Included credit quantities and top-up conversions must be finalized before sale. Hosting, domains and external services are not included in these prices.</p>
  <div className="package-links"><Link href="/websites">Open website builder</Link><Link href="/?canvas=build">Open developer tools</Link></div>
 </section>;
}
