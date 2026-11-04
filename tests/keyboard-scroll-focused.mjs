import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {testKeyboardScroll} from './keyboard-scroll.browser.mjs';
import {testListArrows} from './list-arrows.browser.mjs';
import {testMailHtml} from './mail-html.browser.mjs';
const require=createRequire(process.env.OFFICE_NODE_MODULES||new URL('../package.json',import.meta.url));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,...(process.env.OFFICE_BROWSER_CHANNEL?{channel:process.env.OFFICE_BROWSER_CHANNEL}:{})});
const page=await browser.newPage({viewport:{width:1440,height:800}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const url=process.env.OFFICE_TEST_URL||'http://127.0.0.1:8787/';
try {
  await page.goto(url);
  await page.getByLabel('Setup token',{exact:true}).fill((await readFile(process.env.OFFICE_TEST_DATA+'/setup-token.txt','utf8')).trim());
  await page.getByLabel('Create password (at least 12 characters)',{exact:true}).fill('keyboard-tests-only-123');
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();
  await page.getByRole('button',{name:'+ Compose',exact:true}).waitFor();
  await testKeyboardScroll(page,url);
  console.log('PASS smooth keyboard scrolling in HTML and text, repeat/reversal, boundaries, and reduced motion.');
  await testMailHtml(page,url);
  console.log('PASS sandboxed HTML reader regressions.');
  await testListArrows(page,url);
  assert.deepEqual(errors,[]);
  console.log('PASS list arrow navigation across all seven apps.');
} finally {await browser.close();}
