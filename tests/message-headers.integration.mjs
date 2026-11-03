import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {testMessageHeaders} from './message-headers.browser.mjs';

const require=createRequire(process.env.OFFICE_NODE_MODULES||new URL('../package.json',import.meta.url));
const {chromium}=require('playwright');
const root=resolve('public');
const server=createServer(async(req,res)=>{
  try {
    const pathname=new URL(req.url,'http://localhost').pathname;
    const file=resolve(root,'.'+(pathname==='/'?'/index.php':pathname));
    if(!file.startsWith(root+'/')&&!file.startsWith(root+'\\'))throw Error('Invalid path');
    res.setHeader('Content-Type',({'.php':'text/html','.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(file)]||'application/octet-stream');
    const source=await readFile(file);
    res.end(extname(file)==='.php'?source.toString().replace(/^<\?php[\s\S]*?\?>/,''):source);
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({headless:true,...(process.env.OFFICE_BROWSER_CHANNEL?{channel:process.env.OFFICE_BROWSER_CHANNEL}:{})});
  const page=await browser.newPage();page.setDefaultTimeout(10000);
  await testMessageHeaders(page,`http://127.0.0.1:${server.address().port}/`);
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
