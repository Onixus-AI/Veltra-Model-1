export type SiteBlock = {type:'Hero'|'Features'|'Story'|'Offer'|'Footer';props:{id:string;title:string;body:string;action:string;href:string}};
export type WebsiteData = {root:{props:{title:string}};content:SiteBlock[]};
const types=new Set(['Hero','Features','Story','Offer','Footer']);
export function safeSiteLink(value:string):string {
 if(/^#[a-z][\w-]*$/i.test(value))return value;
 try{const url=new URL(value);if(url.protocol==='https:')return url.href;}catch{}
 return '#contact';
}
/** Only bounded strings and known components survive an imported project. */
export function readWebsiteData(value:unknown):WebsiteData {
 if(!value||typeof value!=='object')throw Error('Choose an Onixus website project JSON file.');
 const raw=value as Record<string,unknown>;
 if(!Array.isArray(raw.content)||raw.content.length>40)throw Error('A website supports up to 40 sections.');
 const seen=new Set<string>();
 const content=raw.content.map((item:unknown):SiteBlock=>{
  if(!item||typeof item!=='object')throw Error('Invalid website section.');
  const block=item as SiteBlock;
  if(!types.has(block.type)||!block.props||typeof block.props!=='object')throw Error('Unsupported website section.');
  const props={} as SiteBlock['props'];
  for(const key of ['id','title','body','action','href'] as const){const text=block.props[key];if(typeof text!=='string'||text.length>(key==='body'?4000:500))throw Error('Invalid website field.');props[key]=text;}
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(props.id)||seen.has(props.id))throw Error('Website sections need unique IDs.');
  seen.add(props.id);props.href=safeSiteLink(props.href);return {type:block.type,props};
 });
 const root=(raw.root as WebsiteData['root']|undefined)?.props;
 return {root:{props:{title:typeof root?.title==='string'?root.title.slice(0,120):'My website'}},content};
}
export const starterWebsite:WebsiteData={root:{props:{title:'Your studio'}},content:[
 {type:'Hero',props:{id:'hero',title:'Good ideas deserve a clear home.',body:'Introduce your product or service with one simple promise. Replace this text with the outcome you help people achieve.',action:'Explore the details',href:'#features'}},
 {type:'Features',props:{id:'features',title:'Thoughtful in every detail.',body:'A clear offer.\nA simpler experience.\nA useful next step.',action:'',href:'#contact'}},
 {type:'Story',props:{id:'story',title:'Built around what matters.',body:'Tell the story behind your work. Explain how it helps your audience, using specific benefits and evidence you can stand behind.',action:'',href:'#contact'}},
 {type:'Offer',props:{id:'contact',title:'Let’s make something worthwhile.',body:'Add your real booking or contact link to help visitors take the next step.',action:'Get in touch',href:'#contact'}},
 {type:'Footer',props:{id:'footer',title:'Your studio',body:'Add your contact details, support and legal links before publishing.',action:'',href:'#contact'}},
]};
export const websiteStyles=`.onixus-site,.onixus-site *{box-sizing:border-box}.onixus-site{color-scheme:light;margin:0;background:#fff;color:#1d1d1f;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:19px;line-height:1.5}.onixus-site .site-nav{position:sticky;top:0;z-index:10;background:rgba(255,255,255,.88);backdrop-filter:blur(20px);display:flex;align-items:center;justify-content:space-between;padding:18px max(24px,calc((100% - 1080px)/2));gap:24px;font-size:13px}.onixus-site a{color:#0071e3;text-decoration:none}.onixus-site a:focus-visible{outline:3px solid #0071e3;outline-offset:5px}.onixus-site section{padding:100px 28px;scroll-margin-top:70px}.onixus-site h1{font-size:clamp(44px,7vw,88px);font-weight:650;line-height:1.05;letter-spacing:-.045em;max-width:950px;margin:0 auto 28px}.onixus-site h2{font-size:clamp(32px,5vw,56px);font-weight:600;line-height:1.12;letter-spacing:-.035em;margin:0 0 28px}.onixus-site p{color:#6e6e73;max-width:680px;margin:0 auto 32px;white-space:pre-line}.onixus-site .site-hero,.onixus-site .site-offer{text-align:center;padding-top:140px;padding-bottom:140px}.onixus-site .site-cta{display:inline-block;border-radius:12px;padding:14px 24px;background:#0071e3;color:white;font-size:17px;transition:background 450ms cubic-bezier(.28,.11,.32,1)}.onixus-site .site-cta:hover{background:#005bb5}.onixus-site .site-features{background:#f5f5f7;text-align:center}.onixus-site .site-feature-grid{max-width:1080px;display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin:48px auto 0}.onixus-site .site-feature-grid article{border-radius:24px;padding:52px 28px;background:#fff;font-size:24px;font-weight:600}.onixus-site .site-story{max-width:1080px;margin:auto;display:grid;grid-template-columns:2fr 3fr;gap:72px;align-items:center}.onixus-site .site-story p{margin:0;font-size:21px}.onixus-site footer{background:#f5f5f7;padding:44px max(24px,calc((100% - 1080px)/2));font-size:12px;color:#6e6e73}.onixus-site footer p{margin:12px 0 0;font-size:12px}.onixus-site .site-offer{background:#fafafa}@media(max-width:650px){.onixus-site section{padding:72px 24px}.onixus-site .site-hero,.onixus-site .site-offer{padding:88px 24px}.onixus-site .site-story,.onixus-site .site-feature-grid{grid-template-columns:1fr;gap:28px}.onixus-site .site-nav{padding:16px 24px}}@media(prefers-reduced-motion:reduce){.onixus-site{scroll-behavior:auto}.onixus-site *{transition:none!important;animation:none!important}}`;
const escape=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function exportWebsite(value:unknown):string {
 const data=readWebsiteData(value),title=escape(data.root.props.title);
 const sections=data.content.map(({type,props:p})=>{
  const title=escape(p.title),body=escape(p.body),id=escape(p.id);
  const cta=p.action?`<a class="site-cta" href="${escape(safeSiteLink(p.href))}">${escape(p.action)}</a>`:'';
  if(type==='Footer')return `<footer id="${id}"><strong>${title}</strong><p>${body}</p></footer>`;
  if(type==='Features')return `<section class="site-features" id="${id}"><h2>${title}</h2><div class="site-feature-grid">${p.body.split('\n').filter(Boolean).map(line=>`<article>${escape(line)}</article>`).join('')}</div></section>`;
  return `<section class="site-${type.toLowerCase()}" id="${id}"><${type==='Hero'?'h1':'h2'}>${title}</${type==='Hero'?'h1':'h2'}><div><p>${body}</p>${cta}</div></section>`;
 }).join('');
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="${escape(data.content.find(c=>c.type==='Hero')?.props.body.slice(0,160)??'')}"><style>${websiteStyles}</style></head><body class="onixus-site"><nav class="site-nav" aria-label="Main navigation"><strong>${title}</strong><a href="#contact">Contact</a></nav><main>${sections}</main></body></html>`;
}
