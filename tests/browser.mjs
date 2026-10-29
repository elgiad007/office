import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {testAccountSetup} from './account-setup.browser.mjs';
const require=createRequire(process.env.OFFICE_NODE_MODULES || new URL('../package.json',import.meta.url));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,...(process.env.OFFICE_BROWSER_CHANNEL?{channel:process.env.OFFICE_BROWSER_CHANNEL}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
await mkdir('test-results',{recursive:true});
const url=process.env.OFFICE_TEST_URL||'http://127.0.0.1:8787/';
const data=process.env.OFFICE_TEST_DATA||'.runtime/browser-data';
try{
 await page.goto(url);
 await page.locator('#auth-form, .shell').waitFor();
 if(await page.getByLabel('Setup token',{exact:true}).count()){
   await page.getByLabel('Setup token',{exact:true}).fill((await readFile(data+'/setup-token.txt','utf8')).trim());
   await page.getByLabel('Create password (at least 12 characters)',{exact:true}).fill('test-only-password-123');await page.getByRole('button',{name:'Create workspace',exact:true}).click();
 }else if(await page.getByRole('button',{name:'Open workspace',exact:true}).count()){
   await page.getByLabel('Password',{exact:true}).fill('test-only-password-123');await page.getByRole('button',{name:'Open workspace',exact:true}).click();
 }
 await page.getByRole('button',{name:'+ Compose',exact:true}).waitFor();
 await page.screenshot({path:'test-results/mail-empty.png',fullPage:true});
 await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'+ New task',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Keyboard workflow');await page.getByLabel('Notes',{exact:true}).fill('Changes persist in SQLite.');await page.keyboard.press('Escape');
 await page.getByText('Saved',{exact:true}).waitFor();
 await page.getByRole('button',{name:'+ New task',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('Second task');await page.keyboard.press('Escape');await page.getByText('Saved',{exact:true}).waitFor();
 await page.locator('#main').focus();await page.keyboard.press('g');await page.keyboard.press('g');assert.equal(await page.locator('.item.selected').count(),1);await page.keyboard.press('j');assert.equal(await page.locator('.item.selected').count(),1);await page.keyboard.press('?');await page.getByRole('heading',{name:'Stay on the home row'}).waitFor();await page.keyboard.press('Escape');
 await page.reload();await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:/Keyboard workflow Changes persist/}).count();assert.ok((await page.locator('#items').textContent()).includes('Keyboard workflow'));
 await page.getByRole('button',{name:'Documents',exact:true}).click();await page.getByRole('button',{name:'+ New document',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('A place to think');await page.getByRole('textbox',{name:'Document content',exact:true}).fill('A simple document with room for your ideas.');await page.keyboard.press('Escape');await page.getByText('Saved',{exact:true}).waitFor();
 await page.screenshot({path:'test-results/document.png',fullPage:true});
 await page.getByRole('button',{name:'Wiki',exact:true}).click();await page.getByRole('button',{name:'+ New page',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('home:start');await page.getByLabel('Markdown source',{exact:true}).fill('# Welcome home\n\nMy reference shelf. [[home:ideas]]\n\n<script>window.bad = true</script>');await page.keyboard.press('Escape');await page.getByText('Saved',{exact:true}).waitFor();await page.getByRole('button',{name:'Preview',exact:true}).click();assert.equal(await page.evaluate(()=>window.bad),undefined);await page.getByRole('heading',{name:'Welcome home',exact:true}).waitFor();
 await page.getByRole('button',{name:'home:ideas',exact:true}).click();await page.getByRole('button',{name:'Create page',exact:true}).click();await page.keyboard.press('Escape');await page.getByText('Saved',{exact:true}).waitFor();await page.getByRole('button',{name:'Preview',exact:true}).click();assert.ok((await page.locator('#detail').textContent()).includes('home:start'));
 await page.screenshot({path:'test-results/wiki.png',fullPage:true});
 await page.getByRole('button',{name:'Sheets',exact:true}).click();await page.getByRole('button',{name:'+ New workbook',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('Small budget');await page.keyboard.press('Escape');
 await page.locator('[data-cell=A1]').click();await page.keyboard.press('i');await page.getByRole('textbox',{name:'Cell formula or value',exact:true}).fill('12');await page.keyboard.press('Escape');await page.keyboard.press('j');assert.equal(await page.locator('#cell-label').textContent(),'A2');await page.keyboard.press('i');await page.getByRole('textbox',{name:'Cell formula or value',exact:true}).fill('=A1*3');await page.keyboard.press('Escape');await page.getByText('Saved',{exact:true}).waitFor();assert.equal(await page.locator('[data-cell=A2]').textContent(),'36');
 await page.getByRole('button',{name:'Add sheet',exact:true}).click();await page.getByText('Saved',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Sheet 2',exact:true}).count(),1);
 await page.getByRole('button',{name:'Sheet 1',exact:true}).click();await page.locator('[data-cell=A2]').waitFor();assert.equal(await page.locator('[data-cell=A2]').textContent(),'36');
 await page.reload();await page.getByRole('button',{name:'Sheets',exact:true}).click();await page.locator('.item').filter({hasText:'Small budget'}).click();assert.equal(await page.locator('[data-cell=A2]').textContent(),'36');
 await page.screenshot({path:'test-results/sheets.png',fullPage:true});
 await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.getByRole('button',{name:'+ New event',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('Planning session');await page.keyboard.press('Escape');await page.getByText('Saved',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Contacts',exact:true}).click();await page.getByRole('button',{name:'+ New contact',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('Test Contact');await page.getByLabel('Email',{exact:true}).fill('contact@example.com');await page.keyboard.press('Escape');await page.getByText('Saved',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('Theme',{exact:true}).selectOption('dark');await page.getByRole('button',{name:'Save preferences',exact:true}).click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');await page.screenshot({path:'test-results/settings-dark.png',fullPage:true});
 await testAccountSetup(page,url);
 const status=await(await page.request.get(url+'api.php?r=status')).json();
 const forbidden=await page.request.post(url+'api.php?r=save',{data:{kind:'tasks',title:'unauthorized'}});assert.equal(forbidden.status(),403);
 const backup=await(await page.request.get(url+'api.php?r=backup')).json();assert.equal(backup.format,'portable-office');assert.ok(backup.records.length>=8);assert.equal(backup.owner,undefined);
 const badImport=await page.request.post(url+'api.php?r=import-items',{headers:{'X-CSRF-Token':status.csrf},data:{records:[{kind:'tasks',title:'Should roll back',body:'',meta:{}},{kind:'oops',title:'bad',body:'',meta:{}}]}});assert.equal(badImport.status(),400);
 const rows=await(await page.request.get(url+'api.php?r=records&kind=tasks')).json();assert.ok(!rows.records.some(r=>r.title==='Should roll back'));
 const first=rows.records[0];const stale=await page.request.post(url+'api.php?r=save',{headers:{'X-CSRF-Token':status.csrf},data:{...first,revision:first.revision-1}});assert.equal(stale.status(),409);
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.screenshot({path:'test-results/mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 assert.deepEqual(errors,[]);console.log('PASS browser: setup, all local apps, Vim navigation, autosave, persistence, wiki safety/backlinks, formulas, theme, mobile layout, CSRF, imports and stale writes.');
}catch(error){await page.screenshot({path:'test-results/failure.png',fullPage:true});console.error((await page.locator('body').innerText()).slice(0,3000));throw error;}finally{await browser.close();}
