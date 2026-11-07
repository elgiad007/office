import assert from 'node:assert/strict';

export async function testMailView(page,url) {
  let preferences={},writes=0,reads=0,emptyRequests=0,gmailAuthorized=false;
  const day=new Date(),date=(offset,hour)=>new Date(day.getFullYear(),day.getMonth(),day.getDate()+offset,hour).toISOString();
  const mail=(id,when,from,title)=>({id,kind:'mail',title,body:'Body '+id,revision:1,meta:{date:when,from,folder:'Inbox',read:true,remote:true,account:'view-account'}});
  let records=[mail('a',date(0,14),'Zed <z@example.com>','Zebra'),mail('b',date(0,13),'Amy <a@example.com>','Alpha'),mail('c',date(-1,12),'Beta <b@example.com>','Charlie'),mail('u','invalid','','Undated')];
  const routes=target=>target.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');let json;
    if(action==='status')json={authenticated:true,csrf:'fixture',activity:false,preferences};
    else if(action==='connections')json={links:[],items:[],more:false};
    else if(action==='accounts')json={accounts:[
      {id:'view-account',type:'imap',label:'View fixture',folders:[{id:'Junk',name:'Junk',role:'Junk',protected:true}]},
      {id:'gmail-imap',type:'imap',label:'Gmail IMAP',gmailImap:true,
        folders:[{id:'[Gmail]/Spam',name:'[Gmail]/Spam',delimiter:'/',role:'Custom folder',protected:false}]},
      {id:'gmail-oauth',type:'google',label:'Google authorization',folders:[{id:'SPAM',name:'Spam',protected:true}]},
    ]};
    else if(action==='records'){reads++;json={records};}
    else if(action==='sync')json={count:0};
    else if(action==='preferences'){preferences=route.request().postDataJSON().preferences;writes++;json={ok:true};}
    else if(action==='activity')json={entries:[]};
    else if(action==='connections')json={links:[],items:[],more:false};
    else if(action==='mail-empty-junk'){
      const input=route.request().postDataJSON();
      if(input.action==='preview'){
        if(input.account==='gmail-imap'){
          assert.equal(input.folder,'[Gmail]/Spam');
          json=gmailAuthorized?{name:'Gmail IMAP / Spam',count:3,token:'gmail-confirmation'}:{authorize:true};
        }else{
          assert.equal(input.account,'view-account');assert.equal(input.folder,'Junk');
          json={name:'View fixture / Junk',count:1,token:'fixture-confirmation'};
        }
      }else{
        assert.equal(input.action,'empty');assert.ok(['fixture-confirmation','gmail-confirmation'].includes(input.token));
        emptyRequests++;
        records=records.filter(row=>row.id!=='flagged');
        json={deleted:1,skipped:0,unconfirmed:0};
      }
    }
    else if(action==='mail-action'){
      const input=route.request().postDataJSON(),record=records.find(r=>r.id===input.id);
      const folder={trash:'Trash',junk:'Junk','not-junk':'Inbox','block-domain':'Junk'}[input.action];
      assert.ok(folder);
      if(input.action==='block-domain')assert.equal(input.target,'example.com');
      record.meta.folder=folder;
      if(input.action==='not-junk')record.meta.junkReviewed=true;
      record.revision++;json={record};
    }else throw Error('Unexpected view fixture API: '+action);
    await route.fulfill({json});
  });
  const item=id=>page.locator(`#items [data-id="${id}"]`);
  const header=label=>page.locator('[data-mail-group-key]').filter({has:page.locator('.mail-group-label',{hasText:new RegExp('^'+label+'$')})});
  const order=()=>page.locator('#items .item').evaluateAll(nodes=>nodes.map(n=>n.dataset.id));
  const selected=id=>page.waitForFunction(id=>document.querySelector('#selected-item')?.dataset.id===id,id);
  const ready=()=>page.waitForFunction(()=>document.querySelector('#sync-status')?.textContent.startsWith('Checked '));
  const folder=async value=>{await page.locator('#mail-folder').selectOption(value);await page.waitForFunction(()=>!document.querySelector('#mail-folder')?.disabled);};
  const open=async()=>{if(!await page.locator('#mail-list-view').evaluate(node=>node.open))await page.locator('#mail-list-view > summary').click();};
  const save=async action=>{const before=writes;const response=page.waitForResponse(r=>r.url().includes('r=preferences'));await action();await(await response).finished();assert.ok(writes>before);};
  const choose=async(label,value)=>{await open();await save(()=>page.getByLabel(label,{exact:true}).selectOption(value));};
  const sync=async()=>{const before=reads;await page.locator('#sync-button').click();await page.waitForFunction(()=>document.querySelector('#sync-status')?.textContent.startsWith('Checked '));assert.ok(reads>before);};
  try{
    await page.goto('about:blank');await page.goto(url+'#mail');await selected('a');
    assert.deepEqual(await order(),['a','b','c','u']);
    assert.deepEqual(await page.locator('.mail-group-label').allTextContents(),['Today','Yesterday','Undated']);
    await choose('Sort mail by','subject-asc');assert.deepEqual(await order(),['b','a','c','u']);
    await choose('Group mail by','sender');assert.deepEqual(await order(),['b','c','u','a']);
    await choose('Sort mail by','sender-desc');assert.deepEqual(await order(),['a','u','c','b']);
    await choose('Group mail by','none');assert.equal(await page.locator('.mail-group-header').count(),0);
    await choose('Group mail by','date');await choose('Sort mail by','date-desc');
    await item('b').click();await page.keyboard.press('v');
    await save(()=>header('Today').click());
    assert.equal(await header('Today').getAttribute('aria-expanded'),'false');
    assert.deepEqual(await order(),['c','u']);assert.equal(await page.locator('#selection-count').textContent(),'1 selected');
    assert.equal(await page.locator('#detail h1').last().textContent(),'Alpha');
    await sync();assert.deepEqual(await order(),['c','u']);assert.equal(await page.locator('#selection-count').textContent(),'1 selected');
    await header('Today').focus();await page.keyboard.press('j');await selected('c');
    await item('c').click();await item('u').click({modifiers:['Shift']});
    assert.deepEqual(await page.locator('.multi-selected').evaluateAll(nodes=>nodes.map(n=>n.dataset.id)),['c','u']);
    await page.reload();await header('Today').waitFor();assert.deepEqual(await order(),['c','u']);
    await header('Today').focus();await save(()=>page.keyboard.press('Enter'));assert.equal(await header('Today').getAttribute('aria-expanded'),'true');
    await save(()=>page.keyboard.press('Space'));assert.equal(await header('Today').getAttribute('aria-expanded'),'false');
    await open();await save(()=>page.getByRole('button',{name:'Collapse all',exact:true}).click());
    assert.deepEqual(await order(),[]);
    await page.reload();await header('Today').waitFor();assert.deepEqual(await order(),[]);
    assert.equal(await page.locator('#selected-item').count(),0);
    await header('Today').focus();await save(()=>page.keyboard.press('Enter'));assert.deepEqual(await order(),['a','b']);
    await open();await save(()=>page.getByRole('button',{name:'Expand all',exact:true}).click());assert.equal((await order()).length,4);
    await page.locator('#mail-list-view > summary').click();
    await item('a').click();await save(()=>header('Today').click());
    await item('c').click();await page.keyboard.press('D');await selected('u');
    assert.deepEqual(await order(),['u'],'Delete advances within the expanded order');
    await folder('Trash');assert.equal(await page.getByLabel('Group mail by').inputValue(),'date');
    await folder('Inbox');assert.equal(await header('Today').getAttribute('aria-expanded'),'false');

    // Paging counts messages, skips collapsed rows, and can navigate past the cutoff.
    preferences={mailView:{group:'sender',sort:'date-desc',collapsed:[]}};
    records=Array.from({length:220},(_,n)=>mail((n<110?'a':'b')+String(n%110).padStart(3,'0'),'invalid',n<110?'Amy <a@example.com>':'Beta <b@example.com>','Page '+n));
    await page.reload();await selected('a000');await ready();assert.equal((await order()).length,100);
    await page.getByRole('button',{name:'Show next 100 messages',exact:true}).click();assert.equal((await order()).length,200);
    await save(()=>header('Amy <a@example.com>').click());assert.equal((await order()).length,100);assert.equal((await order())[0],'b000');
    await page.getByRole('button',{name:'Show next 100 messages',exact:true}).click();assert.equal((await order()).length,110);
    await header('Amy <a@example.com>').focus();await save(()=>page.keyboard.press('Enter'));
    await item('a000').click();await page.keyboard.press('G');await selected('b109');assert.equal((await order()).length,220);
    await open();await page.screenshot({path:'test-results/mail-view-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/mail-view-mobile.png',fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    const menu=await page.locator('.mail-view-menu').boundingBox();assert.ok(menu.x>=0&&menu.x+menu.width<=390);
    console.log('PASS mail list view: grouping/sorting, collapse and native keyboard activation, hidden selection/reader and sync, persistence, expanded navigation/range/delete order, collapse-all, paging and mobile menu.');
    await page.setViewportSize({width:1440,height:1000});
    records=[mail('flagged',date(0,14),'Sender <sender@example.com>','Flagged message'),mail('ordinary',date(0,13),'Other <other@example.com>','Ordinary message')];
    records[0].meta.junkReason='Spam verdict in the message headers';
    await page.reload();await item('flagged').waitFor();
    await item('flagged').getByText('Suspected junk', {exact:false}).waitFor();
    await folder('Suspected Junk');
    assert.deepEqual(await order(),['flagged']);
    await item('flagged').click({button:'right'});
    await page.getByRole('menuitem',{name:'Mark as Junk',exact:true}).click();
    await item('flagged').waitFor({state:'detached'});
    await folder('Junk');
    await item('flagged').click({button:'right'});
    await page.getByRole('menuitem',{name:'Not Junk',exact:true}).click();
    await item('flagged').waitFor({state:'detached'});
    await folder('Suspected Junk');
    assert.deepEqual(await order(),[]);
    await folder('Inbox');
    await item('flagged').click({button:'right'});
    await page.getByRole('menuitem',{name:'Block Domain…',exact:true}).click();
    await page.getByRole('dialog').getByText(/Block example\.com for this account/).waitFor();
    await page.getByRole('button',{name:'Block Domain',exact:true}).click();
    await item('flagged').waitFor({state:'detached'});
    console.log('PASS Junk browser flow: review filter, mark as Junk, restore and confirm exact domain.');
    await folder('Junk');
    await item('flagged').waitFor();
    await page.locator('[data-account-tree="view-account"] > summary').click();
    const junkFolder=page.getByRole('button',{name:'Junk',exact:true});
    const emptyMenu=page.getByRole('menuitem',{name:'Empty Junk Folder…',exact:true});
    const confirmation=page.getByRole('dialog');
    await junkFolder.click({button:'right'});
    await emptyMenu.click();
    await confirmation.getByText(/Permanently delete 1 message from View fixture \/ Junk/).waitFor();
    await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(emptyRequests,0);
    await junkFolder.focus();await page.keyboard.press('Shift+F10');
    await emptyMenu.click();
    await confirmation.getByRole('button',{name:'Empty Junk Folder',exact:true}).click();
    await item('flagged').waitFor({state:'detached'});
    assert.equal(emptyRequests,1);
    console.log('PASS Empty Junk browser flow: folder context menu, cancellation, keyboard access, confirmation and refresh.');
    await page.locator('[data-account-tree="gmail-imap"] > summary').click();
    const gmailSpam=page.locator('[data-open-folder="[Gmail]/Spam"]');
    const gmailMenu=page.getByRole('menuitem',{name:'Empty Spam Folder…',exact:true});
    await gmailSpam.click({button:'right'});
    await gmailMenu.click();
    await confirmation.getByText(/only need to grant this permission once per Gmail account/).waitFor();
    await confirmation.getByRole('button',{name:'Continue to Google',exact:true}).waitFor();
    await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(emptyRequests,1);
    gmailAuthorized=true;
    await gmailSpam.click({button:'right'});
    await gmailMenu.click();
    await confirmation.getByText(/Permanently delete 3 messages from Gmail IMAP \/ Spam/).waitFor();
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('r=mail-empty-junk') && response.request().postDataJSON().action==='empty'),
      confirmation.getByRole('button',{name:'Empty Spam Folder',exact:true}).click(),
    ]);
    assert.equal(emptyRequests,2);
    await page.locator('[data-account-tree="gmail-oauth"] > summary').click();
    await page.locator('[data-open-folder="SPAM"]').click({button:'right'});
    await page.getByRole('menuitem',{name:'Empty Spam Folder…',exact:true}).waitFor();
    console.log('PASS Gmail Spam menus: legacy IMAP explains one-time access and empties in Office after authorization.');
  }finally{await page.setViewportSize({width:1440,height:1000});await page.unroute(routes);await page.goto('about:blank');}
}
