export function designHtml(files:unknown):string|null{
 if(!Array.isArray(files))return null;
 const file=files.find(f=>f&&f.path==='index.html'&&typeof f.content==='string');
 return file&&file.content.length<=60000?file.content:null;
}
/** Opaque-origin preview with no network, forms, frames or parent access. */
export function designPreview(source:string):string{
 const policy="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";
 return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0">${source}</body></html>`;
}
export function designTask(brief:string):string{
 return `Build or refine the website requested below. Return one complete self-contained index.html, with complete content and polished custom styling, with inline CSS and JavaScript. No imports, remote fonts, external images, requests or dependencies. Use inline SVG or CSS visuals. Make it responsive and accessible, with meaningful working local interactions. Do not invent live payments, sending, saved server data or published URLs. Use the user's requested visual direction; do not force Onixus or Onixus Workspace branding onto their website. Act as a senior web designer and frontend engineer. Default to a premium product-focused visual system: large clear headlines, generous whitespace, off-white #f5f5f7 surfaces, charcoal #1d1d1f text, one restrained blue #0071e3 accent, rounded borderless sections and a translucent sticky header. Prefer system sans-serif fonts, one primary hero CTA, alternating feature stories, responsive layouts and quiet 400–600ms transitions; respect prefers-reduced-motion. No Apple logos, proprietary fonts or copied product imagery. Let customer branding and explicit style requests override this default. Establish a coherent type scale, a distinctive business-specific visual concept, strong hero composition, generous rhythm and intentional color. Avoid repetitive generic cards and placeholder copy. Include navigation, meaningful sections, polished footer, mobile menu, keyboard focus and reduced-motion support. Implement relevant interactions such as filters, tabs, accordions or a local calculator. Show honest local success states for demo forms; never imply real submission. Keep plan and review concise.\n\n${brief}`.slice(0,4000);
}
