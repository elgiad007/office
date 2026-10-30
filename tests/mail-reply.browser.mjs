import assert from 'node:assert/strict';

export async function testMailReply(page,url) {
  const message=(id,folder,serverFolder)=>({id,kind:'mail',title:'Received '+id,body:'Original body '+id,revision:1,meta:{remote:true,account:'reply-account',folder,serverFolder,from:'Sender <sender@example.com>',date:'Thu, 29 Oct 2026 12:00:00 +0000',source:'source-only-marker'}});
  let records=[message('inbox-a','Inbox','INBOX'),message('inbox-b','Inbox','INBOX'),message('custom-a','Custom folder','Travel')],sequence=0,reject=false;
  const routes=target=>target.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');let json;
    if(action==='status')json={authenticated:true,csrf:'fixture',preferences:{}};
    else if(action==='accounts')json={accounts:[{id:'reply-account',label:'Reply account',type:'imap',folders:[{id:'Travel',name:'Travel',delimiter:'/',protected:false}]}]};
    else if(action==='records')json={records};
    else if(action==='sync'||action==='mail-folder-sync')json={count:0};
    else if(action==='save'){
      if(reject)return route.fulfill({status:500,json:{error:'Reply save failed for test'}});
      const input=route.request().postDataJSON(),record={...input,id:input.id||'reply-'+(++sequence),revision:(input.revision||0)+1,updated:new Date().toISOString()};
      records=records.filter(r=>r.id!==record.id);records.push(record);json={record};
    }else throw Error('Unexpected reply fixture API: '+action);
    await route.fulfill({json});
  });
  const ids=()=>page.locator('#items .item').evaluateAll(items=>items.map(item=>item.dataset.id));
  const folder=page.locator('#mail-folder'),search=page.locator('#search'),body=page.locator('[name="body"]');
  try{
    await page.goto(url+'#mail');await page.reload();await page.locator('#sync-status').filter({hasText:'Checked'}).waitFor();
    for(const trigger of ['toolbar','keyboard','menu']){
      await folder.selectOption('Inbox');await search.fill('source-only-marker');
      await page.locator('[data-id="inbox-a"]').click();const before=await ids();
      if(trigger==='toolbar')await page.getByRole('button',{name:'Reply',exact:true}).click();
      else if(trigger==='keyboard')await page.keyboard.press('r');
      else {await page.locator('[data-id="inbox-a"]').click({button:'right'});await page.getByRole('menuitem',{name:'Reply',exact:true}).click();}
      await body.waitFor();
      assert.equal(await folder.inputValue(),'Inbox');assert.equal(await search.inputValue(),'source-only-marker');
      assert.deepEqual(await ids(),before,'Reply keeps the source list even when its search excludes the draft');
      assert.equal(await page.locator('[name="to"]').inputValue(),'sender@example.com');
      assert.equal(await page.getByLabel('Send using',{exact:true}).inputValue(),'reply-account');
      assert.match(await body.inputValue(),/> Original body inbox-a/);
      const quotedBody=await body.inputValue(),replyText='Saved reply '+trigger;
      assert.equal(await body.evaluate(el=>el===document.activeElement),true,'Reply focuses the body immediately');
      await page.keyboard.type(replyText);
      assert.equal(await body.inputValue(),replyText+quotedBody,'Typing starts above the intact quoted email');
      assert.equal(await page.locator('.title-input').inputValue(),'Re: Received inbox-a','Typing leaves the subject intact');
      // Selecting another message must save the reply without losing the list.
      await page.locator('[data-id="inbox-b"]').click();
      assert.equal(records.find(r=>r.id==='reply-'+sequence).body,replyText+quotedBody);
      assert.equal(records.find(r=>r.id==='reply-'+sequence).meta.folder,'Drafts');
      assert.deepEqual(await ids(),before);
    }
    const tree=page.locator('[data-account-tree="reply-account"]');await tree.locator(':scope > summary').click();
    await tree.locator('[data-open-folder="Travel"]').click();await page.locator('#folder-refresh:not([disabled])').waitFor();
    await page.locator('[data-id="custom-a"]').click();
    await page.getByRole('button',{name:'Reply',exact:true}).click();await body.waitFor();
    assert.equal(await folder.inputValue(),'account-folder');assert.deepEqual(await ids(),['custom-a']);
    await body.fill('Scoped reply stays open');await page.keyboard.press('Escape');await page.getByText('Saved',{exact:true}).waitFor();
    const previousEditor=await body.elementHandle();
    await page.locator('#folder-refresh').click();
    // The editor must survive the records reload after folder synchronization.
    await page.waitForFunction(editor=>!editor.isConnected,previousEditor);
    await page.waitForFunction(()=>document.querySelector('[name="body"]')?.value==='Scoped reply stays open'&&!document.querySelector('#folder-refresh')?.disabled);
    assert.deepEqual(await ids(),['custom-a']);
    const draftId='reply-'+sequence;
    await search.fill('');await folder.selectOption('Drafts');await page.locator(`[data-id="${draftId}"]`).click();
    assert.equal(await body.inputValue(),'Scoped reply stays open','Reply can be reopened in Drafts');
    await folder.selectOption('Inbox');await search.fill('source-only-marker');await page.locator('[data-id="inbox-a"]').click();
    reject=true;await page.getByRole('button',{name:'Reply',exact:true}).click();
    await page.locator('#notice').filter({hasText:'Reply save failed for test'}).waitFor();
    assert.equal(await folder.inputValue(),'Inbox');assert.deepEqual(await ids(),['inbox-a','inbox-b']);
    assert.equal(await page.locator('#selected-item').getAttribute('data-id'),'inbox-a');
    console.log('PASS mail reply: toolbar/keyboard/menu, original folder/search/list, recipient/account/quote, save on navigation, scoped refresh, draft reopening and failed creation.');
  }finally{await page.unroute(routes);await page.reload();}
}
