import {testMessageHeaders} from './message-headers.browser.mjs';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'node:net';
import {createServer as createHttpServer,request as httpRequest} from 'node:http';
import {testAttachments} from './attachments.browser.mjs';
import {testMailHtml} from './mail-html.browser.mjs';
import {testMailCache} from './mail-cache.browser.mjs';
import {testMailHeaders} from './mail-headers.browser.mjs';
import {testLargeMail} from './large-mail.browser.mjs';
import {testMailCompact} from './mail-compact.browser.mjs';
import {testMailReaderSync} from './mail-reader-sync.browser.mjs';

const require=createRequire(process.env.OFFICE_NODE_MODULES||new URL('../package.json',import.meta.url)),{chromium}=require('playwright');
await mkdir('.runtime',{recursive:true});await mkdir('test-results',{recursive:true});
const data=await mkdtemp(resolve('.runtime/attachments-integration-'));
const listener=createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
// PHP's single-threaded Windows test server can stall on idle browser preconnects.
// Forward only actual HTTP requests, and close each upstream connection.
const proxy=createHttpServer((incoming,outgoing)=>{
  const upstream=httpRequest({host:'127.0.0.1',port,path:incoming.url,method:incoming.method,headers:{...incoming.headers,connection:'close'},agent:false},response=>{outgoing.writeHead(response.statusCode,response.headers);response.pipe(outgoing);});
  upstream.on('error',()=>{if(!outgoing.headersSent)outgoing.writeHead(502);outgoing.end();});
  incoming.on('aborted',()=>upstream.destroy());outgoing.on('close',()=>{if(!outgoing.writableEnded)upstream.destroy();});incoming.pipe(upstream);
});
await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${proxy.address().port}/`;
const php=process.env.OFFICE_PHP||(process.platform==='win32'?resolve('runtime/windows/php.exe'):'php');
const ext=process.env.OFFICE_PHP_EXT||(process.platform==='win32'?resolve('runtime/windows/ext'):null);
const server=spawn(php,[...(ext?['-d','extension_dir='+ext]:[]),'-S',`127.0.0.1:${port}`,'-t',resolve('public')],{env:{...process.env,OFFICE_DATA_DIR:data},windowsHide:true,stdio:['ignore','ignore','pipe']});
let browser;const errors=[],serverLog=[],requests=new Set();server.stderr.on('data',chunk=>{serverLog.push(chunk.toString());if(serverLog.length>30)serverLog.shift();});
try{
  for(let i=0;i<60;i++){try{if((await fetch(url+'api.php?r=status')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  browser=await chromium.launch({headless:true,...(process.env.OFFICE_BROWSER_CHANNEL?{channel:process.env.OFFICE_BROWSER_CHANNEL}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>errors.push(error.message));
  page.on('request',r=>requests.add(r.url()));page.on('requestfinished',r=>requests.delete(r.url()));page.on('requestfailed',r=>requests.delete(r.url()));
  try{
    await page.goto(url);await page.getByLabel('Setup token',{exact:true}).fill((await readFile(data+'/setup-token.txt','utf8')).trim());
    await page.getByLabel('Create password (at least 12 characters)',{exact:true}).fill('attachment-tests-only-123');
    await page.getByRole('button',{name:'Create workspace',exact:true}).click();await page.getByRole('button',{name:'Compose',exact:true}).waitFor();
    await testMessageHeaders(page,url);await testMailReaderSync(page,url);await testMailCompact(page,url);await testAttachments(page,url);await testMailHtml(page,url);await testMailCache(page,url);await testMailHeaders(page,url);await testLargeMail(page,url);
    if(errors.length)throw Error(errors.join('\n'));
    console.log('PASS attachment integration and mail HTML, original-cache, header and large-message regressions.');
  }catch(error){console.error('Browser errors:',errors,'Pending requests:',Array.from(requests));console.error(serverLog.join('').slice(-3000));console.error((await page.locator('body').innerText()).slice(-1600));await page.screenshot({path:'test-results/attachments-failure.png',fullPage:true});throw error;}
}finally{await browser?.close();server.kill();proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}
