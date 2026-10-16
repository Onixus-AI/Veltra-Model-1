'use client';
import { useState } from 'react';
import { industryGroups, industries } from '@/lib/crm/industries';
export function IndustryOptions() {
  return <datalist id="veltra-industries">{industries.map(industry => <option key={industry} value={industry}/>)}</datalist>;
}
export default function IndustryLibrary() {
  const [query, setQuery] = useState('');
  const groups = industryGroups.map(group => ({...group, industries: group.industries.filter(industry => `${group.name} ${industry}`.toLowerCase().includes(query.trim().toLowerCase()))})).filter(group => group.industries.length);
  return <section aria-label="Business industries">
    <section className="crm-panel"><h2>Made for small businesses</h2><p>{industries.length} categories across {industryGroups.length} groups. Choose a category during workspace setup or when adding a customer. You can also enter your own.</p><label>Find an industry<input type="search" placeholder="Try trucking, salon, nursing or plumbing" value={query} onChange={event => setQuery(event.target.value)}/></label><p>These categories organize your business and customers. Industry-specific workflows and integrations are still being built.</p></section>
    <div className="crm-industry-grid">{groups.map(group => <section className="crm-panel" key={group.name}><h2>{group.name}</h2><ul>{group.industries.map(industry => <li key={industry}>{industry}</li>)}</ul></section>)}</div>
    {!groups.length && <p role="status">No matching category. You can enter a custom industry during setup or when adding a customer.</p>}
  </section>;
}
