'use client';
import ToolLogo from '@/components/tool-logo';

// Onixus TMS in Workspace (Business OS). The TMS runs at its own address (Vercel, since 2026-11);
// this panel opens it. The old in-panel connect form went through Railway Mail, which is retired.
const TMS_URL = 'https://onixus-tms.vercel.app/';

export default function TmsCanvas() {
  return <div className="workspace-tool-state tms-canvas">
    <h2><ToolLogo name="Onixus TMS"/> Onixus TMS</h2>
    <p>Business OS · Transport operations</p>
    <p>Loads, dispatch, drivers, fleet, billing and quotes for drayage, OTR and other transport services. Sign in with the same email you use here.</p>
    <div className="actions"><a className="button" href={TMS_URL} target="_blank" rel="noreferrer">Open Onixus TMS ↗</a></div>
    <h3>First time?</h3>
    <ol>
      <li>Open the TMS and create your company.</li>
      <li>Setup asks what you run (drayage, OTR and your equipment, warehousing and more) and what to connect.</li>
      <li>Rates you save in the TMS are what Onixus Mail quotes from.</li>
    </ol>
  </div>;
}
