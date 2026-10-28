export const HTML_IMPORT_LIMIT = 250_000;
export function readHtmlFile(name:string,source:string):string {
 if(!/\.html?$/i.test(name))throw Error('Choose an .html or .htm file.');
 if(!source.trim())throw Error('This HTML file is empty.');
 if(new TextEncoder().encode(source).byteLength>HTML_IMPORT_LIMIT)throw Error('Choose an HTML file smaller than 250 KB.');
 return source;
}
/** Preview only: original source remains unchanged for editing and export. */
export function importedHtmlPreview(source:string,parser:DOMParser=new DOMParser()):string {
 const doc=parser.parseFromString(source,'text/html');
 for(const element of doc.querySelectorAll('script,iframe,frame,frameset,object,embed,base,meta[http-equiv],link,template'))element.remove();
 for(const element of doc.querySelectorAll('*'))for(const attribute of Array.from(element.attributes)){
  if(/^on/i.test(attribute.name)||['href','target','action','formaction','srcdoc'].includes(attribute.localName.toLowerCase()))element.removeAttribute(attribute.name);
 }
 const policy="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";
 return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1">${doc.head.innerHTML}</head><body>${doc.body.innerHTML}</body></html>`;
}
