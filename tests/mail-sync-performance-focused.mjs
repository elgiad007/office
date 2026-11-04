import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {testSyncProgress} from './sync-progress.browser.mjs';
import {testSyncScheduling,testOfflineSyncWindows} from './mail-sync-performance.browser.mjs';
import {testMailReaderSync,testHtmlReaderSync} from './mail-reader-sync.browser.mjs';
const require=createRequire(process.env.OFFICE_NODE_MODULES||new URL('../package.json',import.meta.url));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,...(process.env.OFFICE_BROWSER_CHANNEL?{channel:process.env.OFFICE_BROWSER_CHANNEL}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
try{
  const url=process.env.OFFICE_TEST_URL||'http://127.0.0.1:8787/';
  await testSyncScheduling(page,url);
  await testOfflineSyncWindows(page,url);
  await testSyncProgress(page,url);
  await testMailReaderSync(page,url);
  await testHtmlReaderSync(page,url);
  assert.deepEqual(errors,[]);
}finally{await browser.close();}
