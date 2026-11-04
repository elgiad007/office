import assert from 'node:assert/strict';

export async function testTaskCompletion(page,url) {
  const status=await(await page.request.get(url+'api.php?r=status')).json();
  const titles=['Completion checkbox fixture','Completion shortcut fixture'];
  const imported=await page.request.post(url+'api.php?r=import-items',{
    headers:{'X-CSRF-Token':status.csrf},
    data:{records:titles.map(title=>({kind:'tasks',title,body:'Keep these notes',meta:{}}))},
  });
  assert.equal(imported.status(),200);
  const records=async()=>(await(await page.request.get(url+'api.php?r=records&kind=tasks')).json()).records;
  // Exercise the actual PHP response: empty metadata arrives as [], not {}.
  for(const record of (await records()).filter(r=>titles.includes(r.title)))assert.deepEqual(record.meta,[]);
  const item=title=>page.locator('#items [data-id]').filter({hasText:title});
  const completed=page.getByLabel('Completed',{exact:true});
  const saved=()=>page.locator('#save-status').filter({hasText:/^Saved$/}).waitFor();
  const persisted=async(title,done)=>{
    await saved();
    const record=(await records()).find(r=>r.title===title);
    assert.equal(record.meta.done,done);
    assert.equal(record.body,'Keep these notes');
  };
  await page.getByRole('button',{name:'Tasks',exact:true}).click();
  await item(titles[0]).click();
  await completed.check();await persisted(titles[0],true);
  await item(titles[1]).click();await item(titles[0]).click();
  assert.equal(await completed.isChecked(),true);
  await page.reload();await item(titles[0]).click();
  assert.equal(await completed.isChecked(),true);
  await completed.uncheck();await persisted(titles[0],false);
  await page.reload();await item(titles[0]).click();
  assert.equal(await completed.isChecked(),false);
  await item(titles[1]).click();await page.keyboard.press('x');
  await persisted(titles[1],true);
  await page.reload();await item(titles[1]).click();
  assert.equal(await completed.isChecked(),true);
}
