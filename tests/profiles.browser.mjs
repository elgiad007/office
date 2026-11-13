import assert from 'node:assert/strict';

export async function testProfiles(page,url,ownerPassword) {
  const context=page.context();
  const owner=page.getByRole('button',{name:'Switch profile'});
  const ownerName=await owner.innerText();
  const staleTab=await context.newPage();
  try {
    await staleTab.goto(url);
    await staleTab.getByRole('button',{name:'Switch profile'}).waitFor();
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('button',{name:'Profiles settings',exact:true}).click();
    await page.getByRole('button',{name:'Create invitation',exact:true}).click();
    const invitation=page.getByRole('dialog',{name:'Profile invitation'});
    const code=await invitation.getByLabel('Invitation code').inputValue();
    assert.match(code,/^[0-9a-f]{32}$/);
    await invitation.getByRole('button',{name:'Close dialog'}).click();
    await owner.click();
    await staleTab.getByRole('heading',{name:'Sign in'}).waitFor();
    await page.getByRole('button',{name:'Create profile',exact:true}).click();
    await page.getByLabel('Profile name').fill('Family workspace');
    await page.getByLabel('Invitation code').fill(code);
    await page.getByLabel('Create password (at least 12 characters)').fill('browser-profile-password');
    await page.getByRole('button',{name:'Create profile',exact:true}).click();
    await owner.waitFor();
    assert.equal(await owner.innerText(),'Family workspace');
    await staleTab.getByRole('heading',{name:'Sign in'}).waitFor();
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('button',{name:'Profiles settings',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Create invitation',exact:true}).count(),0);
    await owner.click();
    await page.getByLabel('Choose profile').selectOption({label:ownerName});
    await page.getByLabel('Password',{exact:true}).fill(ownerPassword);
    await page.getByRole('button',{name:'Open workspace'}).click();
    await owner.waitFor();
    assert.equal(await owner.innerText(),ownerName);
    console.log('PASS browser profiles: invitation, creation, switching, and stale tabs.');
  } finally {await staleTab.close();}
}
