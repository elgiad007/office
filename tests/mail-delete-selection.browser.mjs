import assert from 'node:assert/strict';

export async function testMailDeleteSelection(page,url) {
  let messages=[],rejectId=null,active=0;
  const held=new Map();
  const fixture=(id,remote=true)=>({id,kind:'mail',title:'Queue '+id,body:'Message '+id,revision:1,updated:new Date().toISOString(),meta:{read:true,folder:'Inbox',from:'sender@example.com',...(remote?{remote:true,account:'queue-account'}:{})}});
  const routes=target=>target.pathname.endsWith('/api.php')&&['records','accounts','mail-action','delete'].includes(target.searchParams.get('r'));
  await page.route(routes,async route=>{
    const target=new URL(route.request().url()),action=target.searchParams.get('r');
    if(action==='accounts')return route.fulfill({json:{accounts:[]}});
    if(action==='records')return route.fulfill({json:{records:messages}});
    const input=route.request().postDataJSON();
    active++;
    try{
    if(held.has(input.id))await held.get(input.id).promise;
    if(input.id===rejectId)return route.fulfill({status:400,json:{error:'Deletion rejected for test'}});
    const record=messages.find(r=>r.id===input.id);assert.ok(record);
    if(action==='delete')messages=messages.filter(r=>r.id!==input.id);
    else {assert.equal(input.action,'trash');record.meta.folder='Trash';record.revision++;}
    return route.fulfill({json:{record}});
    }finally{active--;}
  });
  const reset=async (ids,remote=true)=>{for(let i=0;active&&i<100;i++)await new Promise(r=>setTimeout(r,20));assert.equal(active,0);messages=ids.map(id=>fixture(id,remote));rejectId=null;await page.goto(url+'#mail');await page.reload();await page.locator('#mail-folder').selectOption('Inbox');await page.locator('.item').first().waitFor();};
  const hold=id=>{let release;const promise=new Promise(resolve=>{release=resolve;});held.set(id,{promise,release});};
  const release=id=>{held.get(id).release();held.delete(id);};
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
    assert.equal(await page.locator('#selected-item').getAttribute('data-id'),'c');
    assert.equal(await item('b').count(),1);

    await reset(['a','b','c']);await page.locator('#search').fill('Message b');await item('b').click();await trash();
    await page.getByRole('heading',{name:'No matching messages.',exact:true}).waitFor();
    assert.equal(await page.locator('#selected-item').count(),0);

    await reset(['a','b','c','d']);await item('b').click();await item('c').click({modifiers:['Control']});await menuTrash('b');await selected('d');
    assert.equal(await page.locator('.multi-selected').count(),0);

    // A partial failure restores the rejected mail without interrupting the next selection.
    await reset(['a','b','c']);await item('a').click();await item('b').click({modifiers:['Control']});rejectId='b';await menuTrash('a');
    await page.locator('#notice').filter({hasText:'1 of 2 items updated.'}).waitFor();await selected('c');assert.equal(await item('b').count(),1);

    // Requests remain blocked while the UI advances through consecutive deletions.
    await reset(['a','b','c','d']);hold('b');hold('c');await item('b').click();
    await page.getByRole('button',{name:'Move to Trash',exact:true}).click();await selected('c');assert.equal(await item('b').count(),0);
    await page.keyboard.press('d');await selected('d');assert.equal(await item('c').count(),0);
    // A refresh while requests are pending must keep both messages hidden.
    await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'Mail',exact:true}).click();
    assert.equal(await item('b').count(),0);assert.equal(await item('c').count(),0);
    await item('d').click();rejectId='b';release('c');await page.locator('#notice').filter({hasText:'Moved to Trash.'}).waitFor();release('b');
    await page.locator('#notice').filter({hasText:'Deletion rejected for test'}).waitFor();assert.equal(await item('b').count(),1);assert.equal(await item('c').count(),0);
    assert.equal(await page.locator('#selected-item').getAttribute('data-id'),'d');

    await reset(['a','b','c','d']);hold('b');await item('b').click();await item('c').click({modifiers:['Control']});await menuTrash('b');
    await selected('d');assert.equal(await item('b').count(),0);assert.equal(await item('c').count(),0);release('b');
    await page.locator('#notice').filter({hasText:'2 items updated.'}).waitFor();

    await reset(['a','b','c'],false);await item('b').click();
    await page.getByRole('button',{name:'Delete',exact:true}).click();await page.locator('#cancel').click();
    assert.equal(await page.locator('#selected-item').getAttribute('data-id'),'b');
    await page.keyboard.press('d');await page.locator('#confirm').click();await selected('c');
    await item('c').click({button:'right'});await page.getByRole('menuitem',{name:'Delete…',exact:true}).click();await page.locator('#confirm').click();await selected('a');
    console.log('PASS mail deletion selection: next, previous, empty list, focus, repeated shortcut, search, bulk, partial failure, rejection, local deletion and cancellation.');
  } finally {for(const gate of held.values())gate.release();await page.unroute(routes);await page.reload();}
  async function trashFailure(){await page.getByRole('button',{name:'Move to Trash',exact:true}).click();await page.locator('#notice').filter({hasText:'Deletion rejected for test'}).waitFor();}
}
