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
 return `Build or refine the website requested below. Return one complete self-contained index.html, at most 6500 characters, with inline CSS and JavaScript. No imports, remote fonts, external images, requests or dependencies. Use inline SVG or CSS visuals. Make it responsive and accessible, with meaningful working local interactions. Do not invent live payments, sending, saved server data or published URLs. Use the user's requested visual direction; do not force Veltra branding onto their website. Keep plan and review concise.\n\n${brief}`.slice(0,4000);
}
