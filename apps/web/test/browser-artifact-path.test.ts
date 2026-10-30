import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,copyFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
test('packaged browser worker saves receipts next to itself regardless of runtime directory',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'onyx-worker-'));
 try{const worker=join(dir,'inspect-page.mjs');await copyFile(new URL('../lib/browser/inspect-page.mjs',import.meta.url),worker);const {saveInspectionResult}=await import(pathToFileURL(worker).href);const snapshot={url:'https://example.com/',title:'Example Domain',http_status:200};const screenshot=Buffer.from([255,216,255,217]);await saveInspectionResult({snapshot,screenshot});assert.deepEqual(JSON.parse(await readFile(join(dir,'result.json'),'utf8')),snapshot);assert.deepEqual(await readFile(join(dir,'screen.jpg')),screenshot);}finally{await rm(dir,{recursive:true,force:true});}
});
