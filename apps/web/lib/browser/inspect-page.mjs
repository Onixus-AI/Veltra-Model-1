import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

/** Runs inside a fresh sandbox, with no user cookies or credentials. Never accepts code or selectors from the model. */
export async function inspectPage(job,chromium){
 const target=new URL(job.url),browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1200,height:800},acceptDownloads:false,serviceWorkers:'block',permissions:[],javaScriptEnabled:true});
  let blocked=0,requests=0;
  await context.route('**/*',async route=>{
   const request=route.request();let allowed=false;try{const u=new URL(request.url());allowed=u.origin===target.origin&&['GET','HEAD'].includes(request.method())&&++requests<=100;}catch{}
   if(!allowed){blocked++;return route.abort('blockedbyclient');}
   // Chromium redirect chains can bypass subsequent route callbacks. Fetch the first
   // response without following redirects and reject redirects before the browser sees them.
   try{const response=await route.fetch({maxRedirects:0,timeout:15000});
    if(response.status()>=300&&response.status()<400&&response.headers().location){blocked++;return route.abort('blockedbyclient');}
    return route.fulfill({response});
   }catch{blocked++;return route.abort('failed');}
  });
  await context.routeWebSocket('**/*',socket=>{blocked++;socket.close();});
  context.on('page',page=>{if(context.pages().length>1)void page.close();});
  const page=await context.newPage();page.on('dialog',dialog=>void dialog.dismiss());page.on('download',download=>void download.cancel());
  const response=await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:25000});
  let settled=true;await page.waitForLoadState('networkidle',{timeout:4000}).catch(()=>{settled=false;});
  if(new URL(page.url()).origin!==target.origin)throw Error('The page left the permitted origin.');
  await page.locator('body').waitFor({state:'visible',timeout:5000});
  const snapshot=await page.evaluate(()=>{
   const text=document.body.innerText??'';
   const links=[...document.querySelectorAll('a[href]')].filter(e=>e.getClientRects().length).slice(0,50).map(e=>({text:(e.innerText??'').slice(0,200),href:e.href}));
   const buttons=[...document.querySelectorAll('button,[role="button"]')].filter(e=>e.getClientRects().length).slice(0,40).map(e=>({text:(e.innerText??e.getAttribute('aria-label')??'').slice(0,200)}));
   const fields=[...document.querySelectorAll('input,textarea,select')].filter(e=>e.getClientRects().length).slice(0,50).map(e=>({type:e.getAttribute('type')??e.tagName.toLowerCase(),label:(e.labels?.[0]?.innerText??e.getAttribute('aria-label')??e.getAttribute('placeholder')??'').slice(0,200)}));
   return {title:document.title.slice(0,300),text:text.slice(0,30000),truncated_text:text.length>30000,links,buttons,fields};
  });
  const screenshot=await page.screenshot({type:'jpeg',quality:55,fullPage:false,timeout:5000});
  return {snapshot:{...snapshot,url:page.url(),http_status:response?.status()??null,observed_at:new Date().toISOString(),blocked_requests:blocked,network_idle:settled,limitation:'Public page inspection only. No login, clicks or form submission. Cross-origin resources and non-read requests were blocked.'},screenshot};
 }finally{await browser.close();}
}

export async function saveInspectionResult(result){
 await writeFile(new URL('./result.json',import.meta.url),JSON.stringify(result.snapshot));
 await writeFile(new URL('./screen.jpg',import.meta.url),result.screenshot);
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{const {chromium}=await import('playwright'),job=JSON.parse(await readFile(process.argv[2],'utf8')),result=await inspectPage(job,chromium);
  await saveInspectionResult(result);
 }catch{console.error('Browser inspection failed. No page result was verified.');process.exitCode=1;}
}
