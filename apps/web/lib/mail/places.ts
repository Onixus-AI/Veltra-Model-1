import zipcodes from 'zipcodes';

// Estimated road miles when Google Maps finds no route: what a rate request says ("Ashland, VA
// 23005", "Greensboro, NC", "NIT", "Norfolk Intl Terminal, VA") placed at a US ZIP centroid, then
// straight line × 1.2 road factor. No network call. Ported from Onixus TMS (apps/api/src/places.ts).
// A place that can't be placed returns null; nothing is guessed.

type Point = {zip: string; lat: number; lng: number};
type Z = {zip: string; latitude: number; longitude: number; city: string; state: string; country: string};

const STATES = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']);
export const ROAD_FACTOR = 1.2;

// Port and rail terminals brokers name without a city (Port of Virginia first: Onixus's home port).
const TERMINALS: [RegExp, string][] = [
  [/\b(nit|norfolk int(?:ernationa)?l|norfolk intl)\b/i, '23505'],
  [/\b(vig|virginia int(?:ernationa)?l gateway|apm)\b/i, '23703'],
  [/\b(pmt|portsmouth marine)\b/i, '23704'],
  [/\b(richmond marine terminal|rmt)\b/i, '23224'],
  [/\b(vip|virginia inland port|front royal)\b/i, '22630'],
  [/\bport of (ny|new york)|\bpnct\b|\bmaher\b|port newark|port elizabeth\b/i, '07114'],
  [/\b(garden city terminal|gct)\b/i, '31408'],
  [/\b(wando|north charleston terminal)\b/i, '29405'],
  [/\bseagirt\b/i, '21224'],
];
// Brokers often write just the port city with no state: tried only after "City, ST" found nothing.
const PORT_CITIES: [RegExp, string][] = [
  [/\bnorfolk\b/i, '23505'], [/\bportsmouth\b/i, '23704'], [/\bsavannah\b/i, '31408'],
  [/\bcharleston\b/i, '29405'], [/\bbaltimore\b/i, '21224'],
];

const point = (z: Z | undefined | null): Point | null =>
  z && z.country === 'US' && Number.isFinite(z.latitude) && Number.isFinite(z.longitude) ? {zip: z.zip, lat: z.latitude, lng: z.longitude} : null;

export function placeOf(text: string): Point | null {
  const t = text.trim();
  if (!t || t.length > 300) return null;
  // A ZIP right after a state code is the most precise ("VA 23005"); street numbers are five digits too.
  const afterState = [...t.matchAll(/\b([A-Za-z]{2})[,.\s]+(\d{5})(?:-\d{4})?\b/g)].filter(m => STATES.has(m[1]!.toUpperCase())).map(m => m[2]!);
  const anyZip = [...t.matchAll(/\b(\d{5})(?:-\d{4})?\b/g)].map(m => m[1]!);
  for (const zip of [...afterState.reverse(), ...anyZip.reverse()]) { const p = point(zipcodes.lookup(zip) as Z); if (p) return p; }
  for (const [re, zip] of TERMINALS) if (re.test(t)) { const p = point(zipcodes.lookup(zip) as Z); if (p) return p; }
  // "City, ST": try the words before the state, longest first ("Norfolk Intl Terminal" → "Norfolk").
  for (const m of t.matchAll(/([A-Za-z][A-Za-z .'-]{1,60}?)[,\s]+([A-Za-z]{2})\b/g)) {
    if (!STATES.has(m[2]!.toUpperCase())) continue;
    const words = m[1]!.trim().split(/\s+/);
    for (let n = words.length; n >= 1; n--) {
      const found = zipcodes.lookupByName(words.slice(0, n).join(' '), m[2]!.toUpperCase()) as Z[];
      const p = point(found?.[0]);
      if (p) return p;
    }
  }
  for (const [re, zip] of PORT_CITIES) if (re.test(t)) { const p = point(zipcodes.lookup(zip) as Z); if (p) return p; }
  return null;
}

/** Estimated road miles between two written places, or null when either can't be placed. */
export function estimateMiles(from: string, to: string): number | null {
  const a = placeOf(from), b = placeOf(to);
  if (!a || !b) return null;
  const rad = (d: number) => (d * Math.PI) / 180, R = 3958.8;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  const straight = 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  return Math.max(1, Math.round(straight * ROAD_FACTOR));
}
