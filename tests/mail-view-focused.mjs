import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {testMailView} from './mail-view.browser.mjs';
import {testMailSort} from './mail-sort.browser.mjs';
import {testMailSelectionSync} from './mail-selection-sync.browser.mjs';
const require=createRequire(process.env.OFFICE_NODE_MODULES||new URL('../package.json',import.meta.url));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,...(process.env.OFFICE_BROWSER_CHANNEL?{channel:process.env.OFFICE_BROWSER_CHANNEL}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));await mkdir('test-results',{recursive:true});
const url=process.env.OFFICE_TEST_URL||'http://127.0.0.1:8787/';
try{
  await testMailView(page,url);
  await testMailSort(page,url);
  await testMailSelectionSync(page,url);
  assert.deepEqual(errors,[]);
}catch(error){await page.screenshot({path:'test-results/mail-view-failure.png',fullPage:true});throw error;}finally{await browser.close();}
