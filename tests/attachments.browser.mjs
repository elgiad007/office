import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {openMailAttachments} from './mail-reader-ui.mjs';

function samplePdf(){
  const stream='BT /F1 18 Tf 30 100 Td (Attachment PDF preview) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 350 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});
  const xref=pdf.length;pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(pdf);
}

export async function testAttachments(page,url){
  const status=await(await page.request.get(url+'api.php?r=status')).json(),headers={'X-CSRF-Token':status.csrf};
  const post=async(route,data)=>{const response=await page.request.post(url+'api.php?r='+route,{headers,data});const json=await response.json();assert.equal(response.status(),200,JSON.stringify(json));return json;};
  const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=','base64');
  const file=Buffer.alloc(2*1048576,0x42);file[0]=0;file[1]=255;
  await page.goto(url+'#mail');await page.reload();
  await page.getByRole('button',{name:'Compose',exact:true}).click();
  await page.getByLabel('Title',{exact:true}).fill('Attachment workflow test');
  await page.getByLabel('To (one recipient)',{exact:true}).fill('recipient@example.com');
  await page.getByLabel('Message',{exact:true}).fill('Text stays intact while attaching.');
  await page.keyboard.press('Control+s');await page.locator('#save-status').filter({hasText:/^Saved$/}).waitFor();
  await page.locator('[data-attach-input]').setInputFiles([{name:'résumé.bin',mimeType:'application/octet-stream',buffer:file},{name:'logo.png',mimeType:'image/png',buffer:pixel}]);
  await page.locator('[data-file-status]').filter({hasText:'Attachments saved.'}).waitFor();
  assert.equal(await page.locator('.mail-attachment').count(),2);
  const records=await(await page.request.get(url+'api.php?r=records&kind=mail&summaries=1')).json();
  let draft=records.records.find(r=>r.title==='Attachment workflow test');assert.ok(draft);assert.equal(draft.body,'Text stays intact while attaching.');
  assert.equal(draft.meta.attachments.length,2);assert.equal(JSON.stringify(draft).includes(file.toString('base64')),false,'normal list contains metadata only');
  const downloadEvent=page.waitForEvent('download');await page.locator('.mail-attachment').filter({hasText:'résumé.bin'}).getByRole('button',{name:'Download',exact:true}).click();
  const download=await downloadEvent;assert.equal(download.suggestedFilename(),'résumé.bin');assert.deepEqual(await readFile(await download.path()),file);
  const retryRoute=target=>target.pathname.endsWith('/api.php')&&target.searchParams.get('r')==='mail-files';
  await page.route(retryRoute,route=>route.fulfill({status:503,json:{error:'Attachment connection interrupted'}}));
  await page.locator('.mail-attachment').filter({hasText:'résumé.bin'}).getByRole('button',{name:'Download',exact:true}).click();
  await page.locator('[data-file-status]').filter({hasText:'You can retry.'}).waitFor();await page.unroute(retryRoute);
  const retryDownload=page.waitForEvent('download');await page.locator('.mail-attachment').filter({hasText:'résumé.bin'}).getByRole('button',{name:'Download',exact:true}).click();assert.deepEqual(await readFile(await(await retryDownload).path()),file,'failed download can be retried without losing the cached bytes');
  await page.reload();await page.locator('#mail-folder').selectOption('Drafts');await page.locator('.item').filter({hasText:'Attachment workflow test'}).click();
  assert.equal(await page.locator('.mail-attachment').count(),2,'draft files survive reload');
  const dragBytes=Buffer.from('dragged attachment');
  const transfer=await page.evaluateHandle(data=>{const transfer=new DataTransfer();transfer.items.add(new File([data],'dropped.txt',{type:'text/plain'}));return transfer;},dragBytes.toString());
  await page.locator('#record-form').dispatchEvent('drop',{dataTransfer:transfer});await transfer.dispose();
  await page.locator('[data-file-status]').filter({hasText:'Attachments saved.'}).waitFor();assert.equal(await page.locator('.mail-attachment').count(),3);
  await page.getByRole('button',{name:'Remove dropped.txt',exact:true}).click();await page.locator('[data-file-status]').filter({hasText:'Attachment removed.'}).waitFor();
  const full=await(await page.request.get(url+'api.php?r=record&id='+draft.id)).json();draft=full.record;
  const archived=await post('save',{...draft,meta:{...draft.meta,folder:'Archive',from:'sender@example.com'}});draft=archived.record;
  await page.reload();await page.locator('#mail-folder').selectOption('Archive');await page.locator('.item').filter({hasText:'Attachment workflow test'}).click();
  await openMailAttachments(page);
  await page.locator('.mail-attachment').filter({hasText:'logo.png'}).getByRole('button',{name:'Preview',exact:true}).click();
  await page.locator('#dialog iframe').waitFor();
  const previewUrl=await page.locator('#dialog iframe').getAttribute('src'),preview=await page.request.get(url+previewUrl);assert.equal(preview.status(),200);assert.equal(preview.headers()['content-type'],'image/png');assert.match(preview.headers()['content-security-policy'],/sandbox/);
  assert.equal(await page.frameLocator('#dialog iframe').locator('img').evaluate(async img=>{await img.decode();return img.naturalWidth;}),1,'image preview renders the actual image');
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  const zipEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Save all',exact:true}).click();const zip=await zipEvent;assert.equal(zip.suggestedFilename(),'attachments.zip');const zipBytes=await readFile(await zip.path());assert.equal(zipBytes.subarray(0,4).toString('hex'),'504b0304');assert.ok(zipBytes.includes(file));
  await page.getByRole('button',{name:'Forward',exact:true}).click();await page.getByLabel('Title',{exact:true}).waitFor();assert.equal(await page.getByLabel('Title',{exact:true}).inputValue(),'Fwd: Attachment workflow test');assert.equal(await page.locator('.mail-attachment').count(),2);
  await page.getByRole('button',{name:'Mail',exact:true}).click();await page.locator('#mail-folder').selectOption('Archive');await page.locator('.item').filter({hasText:'Attachment workflow test'}).click();
  await page.getByRole('button',{name:'Reply',exact:true}).click();await page.locator('[name="body"]').waitFor();assert.equal(await page.locator('.mail-attachment').count(),0,'replies omit the original files');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.locator('[data-draft-choice="discard"]').click();
  await page.getByRole('button',{name:'Backups settings',exact:true}).click();
  await page.getByRole('button',{name:'Prepare backup',exact:true}).click();
  const snapshotEvent=page.waitForEvent('download');
  await page.getByRole('button',{name:/Download SQLite backup/}).click();
  const snapshot=await snapshotEvent;
  assert.match(snapshot.suggestedFilename(),/^office-backup-\d{4}-\d{2}-\d{2}\.sqlite$/);
  const snapshotBytes=await readFile(await snapshot.path());
  assert.equal(snapshotBytes.subarray(0,16).toString(),'SQLite format 3\0');
  const backup=await(await page.request.get(url+'api.php?r=backup&format=json')).json();assert.equal(backup.mailFiles.filter(f=>f.record_id===draft.id).length,2);assert.ok(backup.mailFiles.some(f=>f.data===file.toString('base64')));
  // Replay the actual backup into this isolated test workspace after clearing its records.
  for(const r of backup.records)await post('delete',{id:r.id,revision:r.revision});
  const chooserEvent=page.waitForEvent('filechooser');
  await page.locator('#restore').click();
  await (await chooserEvent).setFiles({name:snapshot.suggestedFilename(),mimeType:'application/vnd.sqlite3',buffer:snapshotBytes});
  await page.locator('#confirm').click();
  await page.locator('#notice').filter({hasText:/Restored \d+ items/}).waitFor();
  const restored=await post('mail-files',{id:draft.id,action:'list'});assert.equal(restored.attachments.length,2);
  const restoredFile=await page.request.get(url+'mail-file.php?id='+draft.id+'&part='+encodeURIComponent(restored.attachments.find(a=>a.name==='résumé.bin').part));assert.deepEqual(await restoredFile.body(),file);
  const unsafe=await post('mail-files',{id:backup.records.find(r=>r.meta.folder==='Drafts' && r.title.startsWith('Fwd:')).id,revision:backup.records.find(r=>r.meta.folder==='Drafts' && r.title.startsWith('Fwd:')).revision,action:'upload',name:'unsafe.html',type:'text/html',data:Buffer.from('<script>alert(1)</script>').toString('base64')});
  const unsafePart=unsafe.attachments.find(a=>a.name==='unsafe.html');const unsafeResponse=await page.request.get(url+'mail-file.php?id='+unsafe.record.id+'&part='+unsafePart.part+'&preview=1');assert.equal(unsafeResponse.status(),400,'active documents are not previewed');
  const unauth=await page.context().browser().newContext();try{const response=await unauth.request.get(url+'mail-file.php?id='+draft.id+'&part='+restored.attachments[0].part);assert.equal(response.status(),401);}finally{await unauth.close();}
  const pdf=samplePdf();await post('import',{format:'eml',base64:Buffer.from('Subject: PDF preview verification\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=sample.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n'+pdf.toString('base64')).toString('base64')});
  await page.getByRole('button',{name:'Mail',exact:true}).click();await page.locator('#mail-folder').selectOption('Archive');await page.locator('.item').filter({hasText:'PDF preview verification'}).click();
  await openMailAttachments(page);
  await page.getByRole('button',{name:'Preview',exact:true}).click();await page.locator('#dialog iframe').waitFor();
  const pdfPreview=await page.request.get(url+await page.locator('#dialog iframe').getAttribute('src'));assert.equal(pdfPreview.status(),200);assert.equal(pdfPreview.headers()['content-type'],'application/pdf');assert.deepEqual(await pdfPreview.body(),pdf);
  await page.locator('#dialog iframe').evaluate(frame=>new Promise(resolve=>{if(frame.contentDocument?.readyState==='complete')resolve();else {const timer=setTimeout(resolve,2000);frame.addEventListener('load',()=>{clearTimeout(timer);resolve();},{once:true});}}));
  await page.waitForTimeout(1500); // Let the browser's native PDF renderer paint its first page.
  await page.screenshot({path:'test-results/attachment-pdf-preview.png',fullPage:true});await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.reload();await page.locator('#mail-folder').selectOption('Archive');await page.locator('.item').filter({hasText:'Attachment workflow test'}).click();await openMailAttachments(page);await page.screenshot({path:'test-results/attachments-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.locator('[data-mail-files]').scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'test-results/attachments-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});
  console.log('PASS attachment UI/API: attach, drag/drop, download bytes, reload, remove, preview isolation, ZIP, forward/reply, backup/restore, authentication and active-content rejection.');
}
