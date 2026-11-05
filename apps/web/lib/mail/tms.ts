import type {QuoteLane} from './employee';

// Prices come from the company's own TMS (Onixus TMS POST /quotes: a saved lane, else its per-mile
// bands). Mail never makes up a price: no TMS, no rate, or any error means "a rate will follow".

export function tmsQuoteLane(o: {url?: string; key?: string; orgId?: string | null; fetcher?: typeof fetch}): QuoteLane | null {
  if (!o.url || !o.key || !o.orgId) return null;
  const fetcher = o.fetcher ?? fetch;
  const base = o.url.replace(/\/$/, '');
  return async lane => {
    const r = await fetcher(`${base}/quotes`, {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: {Authorization: `Bearer ${o.key}`, 'X-Org-Id': o.orgId!, 'Content-Type': 'application/json'},
      body: JSON.stringify({origin: lane.origin, destination: lane.destination, equipment_type: lane.equipment_type, ...(lane.container_size ? {container_size: lane.container_size} : {})})});
    if (!r.ok) return null;
    const q = await r.json().catch(() => null) as Record<string, unknown> | null;
    return q && typeof q.total === 'number' ? q : null;
  };
}
