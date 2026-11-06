import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {testAppEntry} from './app-entry.browser.mjs';

const require=createRequire(process.env.OFFICE_NODE_MODULES||new URL('../package.json',import.meta.url));
const {chromium}=require('playwright');
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  try {
    const file=pathname==='/'?'index.php':pathname.slice(1);
    let data=await readFile(new URL('../public/'+file,import.meta.url));
    if(file==='index.php')data=data.toString().replace(/^<\?php[\s\S]*?\?>/,'');
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
    res.end(data);
  } catch {res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({headless:true,...(process.env.OFFICE_BROWSER_CHANNEL?{channel:process.env.OFFICE_BROWSER_CHANNEL}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
  await testAppEntry(page,'http://127.0.0.1:'+server.address().port+'/');
  assert.deepEqual(errors,[]);
  console.log('PASS app entry: selection and focus restoration, empty lists, reload, slow Mail, rapid switching, and retry.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
