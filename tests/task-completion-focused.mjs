import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {testTaskCompletion} from './task-completion.browser.mjs';

const require=createRequire(process.env.OFFICE_NODE_MODULES||new URL('../package.json',import.meta.url));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,...(process.env.OFFICE_BROWSER_CHANNEL?{channel:process.env.OFFICE_BROWSER_CHANNEL}:{})});
try {
  const page=await browser.newPage(),errors=[];
  page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
  const url=process.env.OFFICE_TEST_URL||'http://127.0.0.1:8787/';
  await page.goto(url);
  await page.getByLabel('Setup token',{exact:true}).fill((await readFile(process.env.OFFICE_TEST_DATA+'/setup-token.txt','utf8')).trim());
  await page.getByLabel('Create password (at least 12 characters)',{exact:true}).fill('task-completion-tests-123');
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();
  await page.getByRole('button',{name:'Compose',exact:true}).waitFor();
  await testTaskCompletion(page,url);
  assert.deepEqual(errors,[]);
  console.log('PASS task completion: empty PHP metadata, checkbox autosave, unchecking, shortcut, reopening and reload persistence.');
} finally {await browser.close();}
