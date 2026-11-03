export const HTML_IMPORT_LIMIT = 250_000;
export function readHtmlFile(name:string,source:string):string {
 if(!/\.html?$/i.test(name))throw Error('Choose an .html or .htm file.');
 if(!source.trim())throw Error('This HTML file is empty.');
 if(new TextEncoder().encode(source).byteLength>HTML_IMPORT_LIMIT)throw Error('Choose an HTML file smaller than 250 KB.');
 return source;
}
/** Preview only: original source remains unchanged for editing and export. */
export function importedHtmlPreview(source:string,parser:DOMParser=new DOMParser(),interactive=false):string {
 const doc=parser.parseFromString(source,'text/html');
 for(const element of doc.querySelectorAll(interactive?'script[src],iframe,frame,frameset,object,embed,base,meta[http-equiv],link,template':'script,iframe,frame,frameset,object,embed,base,meta[http-equiv],link,template'))element.remove();
 for(const element of doc.querySelectorAll('*'))for(const attribute of Array.from(element.attributes)){
  if((!interactive&&/^on/i.test(attribute.name))||['href','target','action','formaction','srcdoc'].includes(attribute.localName.toLowerCase()))element.removeAttribute(attribute.name);
 }
 const policy=`default-src 'none'; script-src ${interactive?"'unsafe-inline'":"'none'"}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'`;
 const security=doc.createElement('meta');security.httpEquiv='Content-Security-Policy';security.content=policy;
 const referrer=doc.createElement('meta');referrer.name='referrer';referrer.content='no-referrer';
 const viewport=doc.createElement('meta');viewport.name='viewport';viewport.content='width=device-width,initial-scale=1';
 doc.head.prepend(security,referrer,viewport);
 return '<!doctype html>'+doc.documentElement.outerHTML;
}
