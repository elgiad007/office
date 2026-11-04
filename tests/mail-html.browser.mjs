import {settleScroll} from './keyboard-scroll-ui.mjs';
import assert from 'node:assert/strict';
import {openMailMore} from './mail-reader-ui.mjs';

export async function testMailHtml(page,url) {
  const status=await (await page.request.get(url+'api.php?r=status')).json();
  const headers={'X-CSRF-Token':status.csrf};
  const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=';
  const html='<html><head><style>.hero{color:rgb(180, 30, 60);font-size:24px}body{background-image:url(https://mail-images.invalid/background.png)}</style><meta http-equiv="refresh" content="0;url=https://mail-images.invalid/redirect"></head><body><table><tr><td class="hero">Styled newsletter</td></tr></table><img alt="Embedded logo" src="cid:logo"><img alt="Remote logo" src="https://mail-images.invalid/logo.png" onerror="parent.mailExecuted=true"><script>parent.mailExecuted=true</script><form action="https://mail-images.invalid/form"><input name="secret"></form><a href="https://example.com">Visit website</a></body></html>';
  const themedHtml=html.replace('</body>','<p id="default-colors">Default colors</p><div id="explicit-colors" style="background:#fff;color:#111 !important">Sender colors</div><table><tr><td id="legacy-background" bgcolor="#ffffff"><font color="#000000">Legacy background</font></td></tr></table><a id="explicit-link" href="https://example.com" style="color:#123456">Sender link</a><p class="MsoNormal" style="margin:0"><o:p>&nbsp;</o:p></p><p id="after-spacer" style="margin:0">After spacer</p></body>');
  const raw=['Subject: HTML reader verification','Date: Tue, 03 Nov 2026 12:00:00 +0000','Content-Type: multipart/related; boundary=related','','--related','Content-Type: multipart/alternative; boundary=alternative','','--alternative','Content-Type: text/plain; charset=UTF-8','','Newsletter text alternative','--alternative','Content-Type: text/html; charset=UTF-8','',''+themedHtml,'--alternative--','--related','Content-Type: image/png','Content-ID: <logo>','Content-Disposition: inline; filename=logo.png','Content-Transfer-Encoding: base64','',pixel,'--related--',''].join('\r\n');
  const imported=await page.request.post(url+'api.php?r=import',{headers,data:{format:'eml',base64:Buffer.from(raw).toString('base64')}});
  assert.equal(imported.status(),200);
  assert.equal((await page.request.post(url+'api.php?r=import-items',{headers,data:{records:[{kind:'mail',title:'HTML navigation next item',body:'Older plain message',meta:{folder:'Inbox',read:true,date:'2000-01-01T12:00:00Z'}}]}})).status(),200);
  const marginCases=[
    ['CSS','<html><head><style>body{margin:24px 12px 18px 9px}</style></head><body><div>Sender margins</div></body></html>',['24px','12px','18px','9px']],
    ['inline','<html><body style="margin:27px 13px 19px 8px"><div>Sender margins</div></body></html>',['27px','13px','19px','8px']],
  ];
  for(const [name,body] of marginCases){
    const source='Subject: Sender margin '+name+'\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n'+body;
    assert.equal((await page.request.post(url+'api.php?r=import',{headers,data:{format:'eml',base64:Buffer.from(source).toString('base64')}})).status(),200);
  }
  let remoteRequests=0;
  const routePattern='https://mail-images.invalid/**';
  await page.route(routePattern,route=>{remoteRequests++;return route.fulfill({contentType:'image/png',body:Buffer.from(pixel,'base64')});});
  try {
    await page.goto(url+'#mail');await page.reload();
    await page.locator('#mail-folder').selectOption('all');
    await page.locator('.item').filter({hasText:'HTML reader verification'}).click();
    const frame=page.frameLocator('.mail-html');
    await frame.getByText('Styled newsletter',{exact:true}).waitFor();
    assert.equal(await frame.locator('form,iframe,meta[http-equiv]').count(),0);
    assert.equal(await frame.locator('script').count(),1,'Only the trusted keyboard bridge survives');
    assert.ok(await frame.locator('script').evaluate(node=>node.nonce));
    assert.equal((await page.locator('.mail-html').getAttribute('sandbox')).includes('allow-same-origin'),false);
    // Exercise the real opaque-origin reader, not a same-origin fixture frame.
    await frame.locator('body').evaluate(node=>{const div=document.createElement('div');div.style.height='3000px';node.append(div);});
    await page.locator('#selected-item').focus();await page.keyboard.press('Tab');
    assert.equal(await page.locator('.mail-html').evaluate(node=>node===document.activeElement),true);
    assert.equal(await page.locator('#detail').evaluate(node=>getComputedStyle(node).outlineStyle),'solid');
    const selected=await page.locator('#selected-item').getAttribute('data-id');
    await page.keyboard.press('j');
    await settleScroll(frame.locator('html'));
    const down=await frame.locator('body').evaluate(()=>scrollY);assert.ok(down>0,'HTML j scrolls down');
    await page.keyboard.press('k');await settleScroll(frame.locator('html'));
    assert.ok(await frame.locator('body').evaluate(()=>scrollY)<down,'HTML k scrolls up');
    await page.keyboard.press('G');await settleScroll(frame.locator('html'));
    assert.ok(await frame.locator('body').evaluate(()=>scrollY)>1000,'HTML G reaches bottom');
    await page.keyboard.press('g');await page.keyboard.press('g');await settleScroll(frame.locator('html'));
    assert.equal(await frame.locator('body').evaluate(()=>scrollY),0,'HTML gg reaches top');
    assert.equal(await page.locator('#selected-item').getAttribute('data-id'),selected,'HTML scrolling keeps selected message');
    await page.keyboard.press('n');
    await page.waitForFunction(id=>document.querySelector('#selected-item')?.dataset.id!==id,selected);
    assert.equal(await page.locator('#detail').evaluate(node=>node.contains(document.activeElement)),true,'HTML n navigates messages and retains content focus');
    await page.keyboard.press('N');await page.locator('#selected-item[data-id="'+selected+'"]').waitFor();
    await frame.getByText('Styled newsletter',{exact:true}).waitFor();
    assert.equal(await page.locator('.mail-html').evaluate(node=>node===document.activeElement),true,'HTML N returns with content focus');
    await page.keyboard.press('v');
    await page.locator('#selected-item.multi-selected').waitFor();
    assert.equal(await page.locator('.mail-html').evaluate(node=>node===document.activeElement),true,'HTML selection keeps reader focus');
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#items .multi-selected'));
    await frame.locator('body').evaluate(node=>{node.tabIndex=-1;node.focus();});
    await page.keyboard.press('Shift+F10');await page.getByRole('menu',{name:'Item actions'}).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.mail-html').evaluate(node=>node===document.activeElement),true,'HTML action menu restores reader focus');
    assert.equal(await frame.locator('body').evaluate(node=>node.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true}))),false,'HTML save chord is handled by Office');
    // Forged sibling/top messages cannot act as an iframe keyboard event.
    await page.evaluate(()=>window.postMessage({type:'office-mail-key',key:'h',shiftKey:false},'*'));
    await frame.locator('body').evaluate(()=>parent.postMessage({type:'office-mail-key',key:'h',shiftKey:'invalid'},'*'));
    await page.waitForTimeout(30);
    assert.equal(await page.locator('.mail-html').evaluate(node=>node===document.activeElement),true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('#selected-item').evaluate(node=>node===document.activeElement),true);
    assert.equal(await frame.getByAltText('Embedded logo').evaluate(img=>img.complete && img.naturalWidth),1);
    assert.equal(await frame.getByAltText('Remote logo').getAttribute('src'),null);
    assert.equal(remoteRequests,0);
    assert.equal(await page.evaluate(()=>window.mailExecuted),undefined);
    assert.equal(await frame.getByRole('link',{name:'Visit website',exact:true}).getAttribute('target'),'_blank');
    const bodyMargins=()=>frame.locator('body').evaluate(node=>{const style=getComputedStyle(node);return [style.marginTop,style.marginRight,style.marginBottom,style.marginLeft];});
    assert.deepEqual(await bodyMargins(),['0px','16px','16px','16px'],'Office adds no top body margin while retaining side/bottom spacing');
    assert.equal(await page.locator('.mail-html').evaluate(node=>getComputedStyle(node).paddingTop),'8px','Reader inset sits outside sender-controlled HTML');
    for(const [name,,margins] of marginCases){
      await page.locator('.item').filter({hasText:'Sender margin '+name}).click();await frame.getByText('Sender margins',{exact:true}).waitFor();
      assert.deepEqual(await bodyMargins(),margins,'Sender-authored '+name+' body margins are preserved');
    }
    await page.locator('.item').filter({hasText:'HTML reader verification'}).click();
    for(const theme of ['light','dark','system']) {
      await page.emulateMedia({colorScheme:'dark'});
      await page.request.post(url+'api.php?r=preferences',{headers,data:{preferences:{...status.preferences,theme,accent:'blue',mailDisplay:'html'}}});
      await page.reload();await page.locator('#mail-folder').selectOption('all');
      await page.locator('.item').filter({hasText:'HTML reader verification'}).click();
      const dark=theme!=='light';
      await frame.getByText('Default colors',{exact:true}).waitFor();
      assert.equal(await frame.locator('html').evaluate(node=>getComputedStyle(node).backgroundColor),dark?'rgb(32, 38, 34)':'rgb(255, 255, 255)');
      assert.equal(await frame.locator('#default-colors').evaluate(node=>getComputedStyle(node).color),dark?'rgb(226, 232, 223)':'rgb(40, 45, 39)');
      assert.equal(await frame.getByRole('link',{name:'Visit website',exact:true}).evaluate(node=>getComputedStyle(node).color),dark?'rgb(157, 191, 231)':'rgb(54, 93, 138)');
      if(dark) {
        // Measure rendered colors, including relative CSS colors, in sRGB.
        for(const selector of ['#explicit-colors','#legacy-background font','#explicit-link','.hero']) {
          const contrast=await frame.locator(selector).evaluate(node=>{
            const ctx=document.createElement('canvas').getContext('2d',{willReadFrequently:true});ctx.canvas.width=ctx.canvas.height=1;
            const luminance=color=>{
              ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);
              const rgb=[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;});
              return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
            };
            let surface=node;
            while(surface.parentElement&&getComputedStyle(surface).backgroundColor==='rgba(0, 0, 0, 0)')surface=surface.parentElement;
            const a=luminance(getComputedStyle(node).color),b=luminance(getComputedStyle(surface).backgroundColor);
            return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
          });
          assert.ok(contrast>=4.5,`${selector} has readable dark-mode contrast: ${contrast}`);
        }
        await page.screenshot({path:'test-results/mail-html-dark.png',fullPage:true});
        await openMailMore(page);await page.getByRole('button',{name:'Original colors',exact:true}).click();
        await frame.getByText('Sender colors',{exact:true}).waitFor();
        assert.equal(await page.locator('[data-mail-colors]').getAttribute('aria-pressed'),'true');
      }
      assert.deepEqual(await frame.locator('#explicit-colors').evaluate(node=>[getComputedStyle(node).backgroundColor,getComputedStyle(node).color]),['rgb(255, 255, 255)','rgb(17, 17, 17)']);
      assert.equal(await frame.locator('#legacy-background').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(255, 255, 255)');
      assert.equal(await frame.locator('#explicit-link').evaluate(node=>getComputedStyle(node).color),'rgb(18, 52, 86)');
      assert.equal(await frame.locator('.hero').evaluate(node=>getComputedStyle(node).color),'rgb(180, 30, 60)');
      assert.ok(await frame.locator('.MsoNormal').evaluate(node=>node.getBoundingClientRect().height)>0,'Outlook empty paragraph retains its height');
      if(dark) {
        await openMailMore(page);await page.getByRole('button',{name:'Text only',exact:true}).click();
        await openMailMore(page);await page.getByRole('button',{name:'HTML',exact:true}).click();
        assert.equal(await page.locator('[data-mail-colors]').getAttribute('aria-pressed'),'true');
        await openMailMore(page);await page.getByRole('button',{name:'Original colors',exact:true}).click();
        await frame.getByText('Sender colors',{exact:true}).waitFor();
        assert.equal(await page.locator('[data-mail-colors]').getAttribute('aria-pressed'),'false');
      }
      if(theme==='system') {
        await page.emulateMedia({colorScheme:'light'});
        await page.waitForFunction(()=>document.querySelector('.mail-html').src.includes('theme=light'));
        await frame.getByText('Default colors',{exact:true}).waitFor();
        assert.equal(await frame.locator('html').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(255, 255, 255)');
      }
    }
    const src=await page.locator('.mail-html').getAttribute('src');
    const response=await page.request.get(new URL(src,url).href);
    assert.match(response.headers()['content-security-policy'],/sandbox allow-scripts allow-popups/);
    assert.match(response.headers()['content-security-policy'],/script-src 'nonce-[^']+'/);
    assert.doesNotMatch(response.headers()['content-security-policy'],/allow-same-origin|unsafe-eval/);
    const anonymous=await fetch(new URL(src,url));assert.equal(anonymous.status,401);
    await page.screenshot({path:'test-results/mail-html.png',fullPage:true});
    await openMailMore(page);await page.getByRole('button',{name:'Text only',exact:true}).click();
    assert.equal(await page.locator('.mail-body').textContent(),'Newsletter text alternative');
    assert.equal(await page.locator('.mail-html').count(),0);
    await openMailMore(page);await page.getByRole('button',{name:'HTML',exact:true}).click();
    await openMailMore(page);await page.getByRole('button',{name:'Load images',exact:true}).click();
    await frame.getByAltText('Remote logo').evaluate(img=>img.decode());
    assert.ok(remoteRequests>0);
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByLabel('Default email display',{exact:true}).selectOption('text');
    await page.getByRole('button',{name:'Save mail preferences',exact:true}).click();
    await page.locator('#notice').filter({hasText:'Mail preferences saved.'}).waitFor();
    await page.goto(url+'#mail');await page.reload();await page.locator('#mail-folder').selectOption('all');
    await page.locator('.item').filter({hasText:'HTML reader verification'}).click();
    assert.equal(await page.locator('.mail-body').textContent(),'Newsletter text alternative');
    assert.equal(await page.locator('.mail-html').count(),0);
    await page.setViewportSize({width:390,height:844});
    await openMailMore(page);await page.getByRole('button',{name:'HTML',exact:true}).click();
    await frame.getByText('Styled newsletter',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:'test-results/mail-html-mobile.png',fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.request.post(url+'api.php?r=preferences',{headers,data:{preferences:{...status.preferences,mailDisplay:'html',keys:{...status.preferences?.keys,down:'J',up:'K'}}}});
    await page.reload();await page.locator('#mail-folder').selectOption('all');await page.locator('.item').filter({hasText:'HTML reader verification'}).click();
    await frame.getByText('Styled newsletter',{exact:true}).waitFor();
    await frame.locator('body').evaluate(node=>{const div=document.createElement('div');div.style.height='3000px';node.append(div);node.tabIndex=-1;node.focus();});
    const remappedId=await page.locator('#selected-item').getAttribute('data-id');
    await page.keyboard.press('J');await settleScroll(frame.locator('html'));
    const remappedDown=await frame.locator('body').evaluate(()=>scrollY);assert.ok(remappedDown>0,'HTML remapped down scrolls');
    await page.keyboard.press('K');await settleScroll(frame.locator('html'));
    assert.ok(await frame.locator('body').evaluate(()=>scrollY)<remappedDown,'HTML remapped up scrolls');
    assert.equal(await page.locator('#selected-item').getAttribute('data-id'),remappedId,'HTML remapped scrolling keeps message');

  } finally {
    await page.emulateMedia({colorScheme:null});
    await page.setViewportSize({width:1440,height:1000});
    await page.unroute(routePattern);
    await page.request.post(url+'api.php?r=preferences',{headers,data:{preferences:status.preferences}});
  }
}
