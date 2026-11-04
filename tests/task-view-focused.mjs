import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {testTaskView} from './task-view.browser.mjs';
import {testMailView} from './mail-view.browser.mjs';
import {testConnectedMail} from './connected-mail.browser.mjs';
const require=createRequire(process.env.OFFICE_NODE_MODULES||new URL('../package.json',import.meta.url));
const {chromium}=require('playwright');
const server=createServer(async(req,res)=>{
  try{
    const pathname=new URL(req.url,'http://localhost').pathname;
    const file=pathname==='/'?'index.php':pathname.slice(1);
    if(!/^[a-z-]+\.(php|js|css)$/.test(file)){res.writeHead(404);res.end();return;}
    let data=await readFile(new URL('../public/'+file,import.meta.url));
    if(file==='index.php')data=data.toString().replace(/^<\?php[\s\S]*?\?>/,'');
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'");
    res.end(data);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  await mkdir('test-results',{recursive:true});
  browser=await chromium.launch({headless:true,...(process.env.OFFICE_BROWSER_CHANNEL?{channel:process.env.OFFICE_BROWSER_CHANNEL}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await testTaskView(page,`http://127.0.0.1:${server.address().port}/`);
  await page.goto('about:blank');
  await testMailView(page,`http://127.0.0.1:${server.address().port}/`);
  await testConnectedMail(page,`http://127.0.0.1:${server.address().port}/`);
  assert.deepEqual(errors,[]);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
