import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {testFocusNavigation} from './focus-navigation.browser.mjs';
import {testMailHtml} from './mail-html.browser.mjs';
const require=createRequire(process.env.OFFICE_NODE_MODULES||new URL('../package.json',import.meta.url));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,...(process.env.OFFICE_BROWSER_CHANNEL?{channel:process.env.OFFICE_BROWSER_CHANNEL}:{})});
const page=await browser.newPage({viewport:{width:1440,height:800}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const url=process.env.OFFICE_TEST_URL||'http://127.0.0.1:8787/';
await mkdir('test-results',{recursive:true});
try{
  await page.goto(url);await page.locator('#auth-form, .shell').waitFor();
  if(await page.getByLabel('Setup token',{exact:true}).count()){
    await page.getByLabel('Setup token',{exact:true}).fill((await readFile(process.env.OFFICE_TEST_DATA+'/setup-token.txt','utf8')).trim());
    await page.getByLabel('Create password (at least 12 characters)',{exact:true}).fill('test-only-password-123');
    await page.getByRole('button',{name:'Create workspace',exact:true}).click();
  }else if(await page.getByRole('button',{name:'Open workspace',exact:true}).count()){
    await page.getByLabel('Password',{exact:true}).fill('test-only-password-123');await page.getByRole('button',{name:'Open workspace',exact:true}).click();
  }
  await page.getByRole('button',{name:'+ Compose',exact:true}).waitFor();
  await testFocusNavigation(page,url);
  await testMailHtml(page,url);
  await page.locator('#selected-item').focus();await page.keyboard.press('Tab');
  await page.screenshot({path:'test-results/focus-content.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS focus navigation: seven apps, remapped keys, scroll owners, pane rings, native editor/cell Tab, opaque HTML bridge and sender-script isolation.');
}catch(error){await page.screenshot({path:'test-results/focus-failure.png'});throw error;}
finally{await browser.close();}
