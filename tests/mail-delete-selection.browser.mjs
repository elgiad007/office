import assert from 'node:assert/strict';

export async function testMailDeleteSelection(page,url) {
  let messages=[],rejectId=null;
  const fixture=(id,remote=true)=>({id,kind:'mail',title:'Queue '+id,body:'Message '+id,revision:1,updated:new Date().toISOString(),meta:{folder:'Inbox',from:'sender@example.com',...(remote?{remote:true,account:'queue-account'}:{})}});
  const routes=target=>target.pathname.endsWith('/api.php')&&['records','accounts','mail-action','delete'].includes(target.searchParams.get('r'));
  await page.route(routes,async route=>{
    const target=new URL(route.request().url()),action=target.searchParams.get('r');
    if(action==='accounts')return route.fulfill({json:{accounts:[]}});
    if(action==='records')return route.fulfill({json:{records:messages}});
    const input=route.request().postDataJSON();
    if(input.id===rejectId)return route.fulfill({status:400,json:{error:'Deletion rejected for test'}});
    const record=messages.find(r=>r.id===input.id);assert.ok(record);
    if(action==='delete')messages=messages.filter(r=>r.id!==input.id);
    else {assert.equal(input.action,'trash');record.meta.folder='Trash';record.revision++;}
    return route.fulfill({json:{record}});
  });
  const reset=async (ids,remote=true)=>{messages=ids.map(id=>fixture(id,remote));rejectId=null;await page.goto(url+'#mail');await page.reload();await page.locator('#mail-folder').selectOption('Inbox');await page.locator('.item').first().waitFor();};
  const item=id=>page.locator(`#items [data-id="${id}"]`);
  const selected=async id=>{
    await page.waitForFunction(id=>document.querySelector('#selected-item')?.dataset.id===id&&document.activeElement?.id==='selected-item',id);
    assert.equal(await page.locator('#detail h1').last().textContent(),'Queue '+id);
  };
  const trash=async()=>{await page.getByRole('button',{name:'Move to Trash',exact:true}).click();await page.locator('#notice').filter({hasText:'Moved to Trash.'}).waitFor();};
  const menuTrash=async id=>{await item(id).click({button:'right'});await page.getByRole('menuitem',{name:'Move to Trash',exact:true}).click();};
  try {
    await reset(['a','b','c']);await item('b').click();await trash();await selected('c');
    // Repeated keyboard processing works directly from the newly focused row.
    await page.keyboard.press('d');await selected('a');await page.keyboard.press('d');
    await page.getByRole('heading',{name:'No messages in this folder.',exact:true}).waitFor();
    assert.equal(await page.locator('#selected-item').count(),0);

    await reset(['a','b','c']);await item('b').click();rejectId='b';await trashFailure();
    assert.equal(await page.locator('#selected-item').getAttribute('data-id'),'b');

    await reset(['a','b','c']);await page.locator('#search').fill('Message b');await item('b').click();await trash();
    await page.getByRole('heading',{name:'No matching messages.',exact:true}).waitFor();
    assert.equal(await page.locator('#selected-item').count(),0);

    await reset(['a','b','c','d']);await item('b').click();await item('c').click({modifiers:['Control']});await menuTrash('b');await selected('d');
    assert.equal(await page.locator('.multi-selected').count(),0);

    // A partial bulk failure advances past successfully removed mail to the survivor.
    await reset(['a','b','c']);await item('a').click();await item('b').click({modifiers:['Control']});rejectId='b';await menuTrash('a');
    await selected('b');await page.locator('#notice').filter({hasText:'1 of 2 items updated.'}).waitFor();

    await reset(['a','b','c'],false);await item('b').click();
    await page.getByRole('button',{name:'Delete',exact:true}).click();await page.locator('#cancel').click();
    assert.equal(await page.locator('#selected-item').getAttribute('data-id'),'b');
    await page.keyboard.press('d');await page.locator('#confirm').click();await selected('c');
    await item('c').click({button:'right'});await page.getByRole('menuitem',{name:'Delete…',exact:true}).click();await page.locator('#confirm').click();await selected('a');
    console.log('PASS mail deletion selection: next, previous, empty list, focus, repeated shortcut, search, bulk, partial failure, rejection, local deletion and cancellation.');
  } finally {await page.unroute(routes);await page.reload();}
  async function trashFailure(){await page.getByRole('button',{name:'Move to Trash',exact:true}).click();await page.locator('#notice').filter({hasText:'Deletion rejected for test'}).waitFor();}
}
