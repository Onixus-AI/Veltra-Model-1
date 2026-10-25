'use client';

import {useEffect, useState} from 'react';
import {browserSupabase} from '@/lib/supabase';
import '../revenue.css';

type Status = {status: string; confirmed_by_provider: boolean; amount_paid_cents: number; currency: string; onboarding: {status: string} | null};

// Stripe returns the payer here. A redirect proves nothing about payment, so the customer only sees a
// neutral message; signed-in workspace members see the status confirmed by the signed webhook.
export default function Paid() {
  const [cancelled, setCancelled] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setCancelled(p.get('cancelled') === '1');
    const w = p.get('w'), proposal = p.get('proposal'), db = browserSupabase();
    if (!w || !proposal || !db) return;
    let tries = 0, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const {data} = await db.auth.getSession();
      if (!data.session) return;
      const r = await fetch(`/api/revenue/proposal?${new URLSearchParams({w, id: proposal})}`, {headers: {Authorization: `Bearer ${data.session.access_token}`}, cache: 'no-store'});
      if (!r.ok) return;
      const s = await r.json() as Status;
      setStatus(s);
      if (!s.confirmed_by_provider && ++tries < 20) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => clearTimeout(timer);
  }, []);
  return <div className="rev rev-standalone"><main className="rev-main"><section className="rev-panel">
    {cancelled ? <><h1>Payment not completed</h1><p>No payment was taken. You can use the same link again when you are ready.</p></>
      : <><h1>Thank you</h1><p>Your payment is being confirmed with the payment provider. You will receive an email once it is confirmed.</p></>}
    {status && <div className="rev-banner" role="status">
      {status.confirmed_by_provider
        ? <>Payment confirmed by the provider ({new Intl.NumberFormat(undefined, {style: 'currency', currency: status.currency}).format(status.amount_paid_cents / 100)}). {status.onboarding ? `Onboarding is ${status.onboarding.status.replace(/_/g, ' ')}.` : ''}</>
        : <>Status: {status.status.replace(/_/g, ' ')}. Not confirmed by the provider yet — this page checks again automatically.</>}
    </div>}
  </section></main></div>;
}
