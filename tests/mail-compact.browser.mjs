import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {openMailAttachments} from './mail-reader-ui.mjs';

export async function testMailCompact(page,url) {
  await page.goto('about:blank');
  const ordinary={id:'compact',kind:'mail',title:'A compact message header',body:'A readable message body.',revision:1,meta:{remote:true,account:'compact-account',folder:'Inbox',serverFolder:'INBOX',source:'imap-folder:INBOX:1:10',read:true,from:'Alex <alex@example.com>',to:'Luc <luc@example.com>',date:'Mon, 02 Nov 2026 15:04:05 -0500',hasHtml:true,hasAttachments:false}};
  const records=[ordinary,{...ordinary,id:'plain',title:'Text message',meta:{...ordinary.meta,hasHtml:false}},{...ordinary,id:'unknown',title:'Unknown attachments',meta:{...ordinary.meta,hasAttachments:undefined}},{...ordinary,id:'long',title:'A very long subject '.repeat(18),meta:{...ordinary.meta,from:'Very long sender name '+('sender'.repeat(20))+'@example.com',to:'recipient'.repeat(30)+'@example.com'}},{...ordinary,id:'recovery',title:'Recovery warning',meta:{...ordinary.meta,folder:'Recovery copies'}}];
  let fileRequests=0;
  const routes=target=>target.pathname.endsWith('/api.php')&&target.searchParams.get('r')!=='activity';
  const htmlRoute=target=>target.pathname.endsWith('/mail-view.php');
  const mailView=await readFile(new URL('../public/mail-view.php',import.meta.url),'utf8');
  const bridge=mailView.match(/\$bridge=<<<'JS'\r?\n([\s\S]*?)\r?\nJS;/)[1];
  const scroll=await readFile(new URL('../public/keyboard-scroll.js',import.meta.url),'utf8');
  await page.route(htmlRoute,route=>route.fulfill({contentType:'text/html',body:`<p style="margin-top:400px">HTML message body</p><script type="module">${scroll}\n${bridge}</script>`}));
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');
    if(action==='status')return route.fulfill({json:{authenticated:true,csrf:'fixture',preferences:{}}});
    if(action==='accounts')return route.fulfill({json:{accounts:[]}});
    if(action==='records')return route.fulfill({json:{records}});
    if(action==='mail-files'){
      const input=route.request().postDataJSON();assert.equal(input.action,'list','Opening files fetches metadata only');fileRequests++;
      if(fileRequests===1)return route.fulfill({status:503,json:{error:'Attachment manifest unavailable'}});
      const record=records.find(r=>r.id===input.id);record.meta.hasAttachments=false;record.meta.attachments=[];
      return route.fulfill({json:{record,attachments:[]}});
    }
    throw Error('Unexpected compact fixture route '+action);
  });
  const select=async id=>{const folder=page.locator('#mail-folder');if(await folder.inputValue()!=='all')await folder.selectOption('all');await page.locator(`#items [data-id="${id}"]`).click();};
  const positionedMenu=()=>page.waitForFunction(()=>{
    const header=document.querySelector('.mail-reader-header').getBoundingClientRect(),trigger=document.querySelector('[data-mail-disclosure="more"] > summary').getBoundingClientRect(),menu=document.querySelector('.mail-more-popover').getBoundingClientRect();
    const expectedLeft=Math.max(header.left,Math.min(trigger.left,header.right-menu.width));
    return Math.abs(menu.left-expectedLeft)<2&&Math.abs(menu.top-trigger.bottom-4)<2&&menu.left>=header.left-1&&menu.right<=header.right+1;
  });
  const firstFrameMenu=async key=>{
    const summary=page.locator('[data-mail-disclosure="more"] > summary');
    await summary.evaluate(node=>{window.compactMoreFirstFrame=new Promise(resolve=>node.addEventListener('click',()=>requestAnimationFrame(()=>{
      const header=document.querySelector('.mail-reader-header').getBoundingClientRect(),trigger=node.getBoundingClientRect(),menu=document.querySelector('.mail-more-popover').getBoundingClientRect();
      resolve({open:node.parentElement.open,left:menu.left,right:menu.right,top:menu.top,expectedLeft:Math.max(header.left,Math.min(trigger.left,header.right-menu.width)),expectedTop:trigger.bottom+4,headerLeft:header.left,headerRight:header.right});
    }),{once:true}));});
    if(key){await summary.focus();await summary.press(key);}else await summary.click();
    const frame=await page.evaluate(()=>window.compactMoreFirstFrame);
    assert.ok(frame.open&&Math.abs(frame.left-frame.expectedLeft)<2&&Math.abs(frame.top-frame.expectedTop)<2&&frame.left>=frame.headerLeft-1&&frame.right<=frame.headerRight+1,'More is positioned on its first animation frame: '+JSON.stringify(frame));
  };
  const assertBodyGap=async()=>{
    const spacing=await page.locator('#detail').evaluate(panel=>{const body=panel.querySelector('.mail-html,.mail-body');return {gap:body.getBoundingClientRect().top-panel.querySelector('.mail-reader-actions').getBoundingClientRect().bottom,inset:parseFloat(getComputedStyle(body).paddingTop)};});
    assert.ok(spacing.gap>=0&&spacing.gap<=1,'Only the divider separates actions from the message body: '+spacing.gap+'px');
    assert.equal(spacing.inset,8,'Both plain text and HTML have a small reader inset');
  };
  try {
    await page.setViewportSize({width:1440,height:1000});await page.goto(url+'?compact-reader-test#mail');
    await page.getByRole('heading',{name:ordinary.title,exact:true}).waitFor();
    assert.equal(await page.locator('#detail .detail-toolbar').count(),0);
    assert.deepEqual(await page.locator('#detail .badge').allTextContents(),['Inbox','Cached']);
    assert.equal(await page.locator('#detail [data-mail-disclosure="files"]').count(),0,'Known empty attachments are hidden');
    assert.equal(await page.locator('#detail [data-mail-disclosure][open]').count(),0);
    assert.equal(fileRequests,0,'Viewing the message does not request attachment metadata');
    const size=await page.locator('#detail').evaluate(panel=>{const header=panel.querySelector('.mail-reader-header'),frame=panel.querySelector('.mail-html');return {header:header.getBoundingClientRect().height,bodyOffset:frame.getBoundingClientRect().top-panel.getBoundingClientRect().top,frame:frame.getBoundingClientRect().height,available:panel.clientHeight-(frame.getBoundingClientRect().top-panel.getBoundingClientRect().top)-parseFloat(getComputedStyle(panel).paddingBottom)};});
    assert.ok(size.header<=170&&size.bodyOffset<=195,JSON.stringify(size));
    assert.ok(Math.abs(size.frame-size.available)<2,'HTML fills available reader height: '+JSON.stringify(size));
    await assertBodyGap();
    await page.screenshot({path:'test-results/mail-compact-desktop.png',fullPage:true});
    const details=page.locator('[data-mail-disclosure="metadata"] > summary');
    await details.focus();await page.keyboard.press('Enter');
    await page.locator('.mail-metadata-popover').getByText(ordinary.meta.date,{exact:true}).waitFor();
    assert.ok(await page.locator('.mail-metadata-popover').getByText(/Downloaded copy from Inbox/).isVisible());
    await page.keyboard.press('Escape');assert.equal(await details.evaluate(node=>node===document.activeElement),true);
    assert.equal(await page.locator('[data-mail-disclosure="metadata"]').evaluate(d=>d.open),false);
    const more=page.locator('[data-mail-disclosure="more"]');
    const assertClosed=()=>page.waitForFunction(()=>!document.querySelector('[data-mail-disclosure="more"]').open);
    await firstFrameMenu();await page.screenshot({path:'test-results/mail-compact-more-desktop.png',fullPage:true});
    await page.frameLocator('.mail-html').getByText('HTML message body',{exact:true}).click();await assertClosed();
    await firstFrameMenu();await page.locator('.mail-subject-row h1').click();await assertClosed();
    await firstFrameMenu();await page.getByRole('button',{name:'Text only',exact:true}).click();await assertClosed();
    assert.equal(await page.locator('[data-mail-disclosure="more"] > summary').evaluate(node=>node===document.activeElement),true);
    await firstFrameMenu();await page.getByRole('button',{name:'HTML',exact:true}).focus();await page.keyboard.press('Enter');await assertClosed();
    assert.equal(await page.locator('.mail-html').count(),1,'Keyboard selection still changes display mode');
    await firstFrameMenu();await page.getByRole('button',{name:'Original colors',exact:true}).click();await assertClosed();
    await firstFrameMenu();await page.getByRole('button',{name:'Load images',exact:true}).click();await assertClosed();
    await firstFrameMenu();await more.getByRole('button',{name:'Export',exact:true}).click();await assertClosed();
    // Pointer events cover taps without needing a separate touch browser context.
    await firstFrameMenu();await page.locator('.mail-subject-row h1').dispatchEvent('pointerdown',{pointerType:'touch'});await assertClosed();
    await firstFrameMenu();await page.frameLocator('.mail-html').getByText('HTML message body',{exact:true}).dispatchEvent('pointerdown',{pointerType:'touch'});await assertClosed();
    await firstFrameMenu();await page.keyboard.press('Escape');assert.equal(await more.evaluate(d=>d.open),false);
    await select('plain');assert.equal(await page.locator('#detail [data-mail-mode]').count(),0,'Plain messages have no HTML/text controls');
    await assertBodyGap();
    await firstFrameMenu('Enter');await page.setViewportSize({width:900,height:650});await positionedMenu();await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:1000});await firstFrameMenu('Space');
    await select('unknown');assert.equal(fileRequests,0);
    await openMailAttachments(page);await page.locator('[data-file-status]').filter({hasText:'You can retry.'}).waitFor();
    await page.getByRole('button',{name:'Check attachments',exact:true}).click();await page.locator('[data-file-status]').filter({hasText:'No file attachments.'}).waitFor();assert.equal(fileRequests,2);
    await page.reload();await select('unknown');assert.equal(await page.locator('[data-mail-disclosure="files"]').count(),0,'Confirmed empty manifest hides on subsequent renders');
    for(const viewport of [{width:900,height:650},{width:390,height:844}]){
      await page.setViewportSize(viewport);await select('long');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Long subject and addresses fit viewport');
      await firstFrameMenu();assert.ok(await page.locator('.mail-more-popover').evaluate(node=>node.getBoundingClientRect().right<=innerWidth+1));
      await page.keyboard.press('Escape');await page.screenshot({path:`test-results/mail-compact-${viewport.width}.png`,fullPage:true});
    }
    await page.setViewportSize({width:1440,height:1000});await page.locator('#mail-folder').selectOption('Recovery copies');await page.locator('#detail .recurrence-note').filter({hasText:'This copy is absent'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Save locally',exact:true}).isVisible(),true);
    console.log('PASS compact mail reader: '+JSON.stringify(size)+'; metadata, disclosures, focus/Escape, plain mail, lazy attachment failure/retry, recovery warning and responsive wrapping.');
  } finally {await page.goto('about:blank');await page.unroute(routes);await page.unroute(htmlRoute);await page.setViewportSize({width:1440,height:1000});await page.goto(url+'#mail',{waitUntil:'domcontentloaded'});}
}
