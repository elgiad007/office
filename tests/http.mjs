import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import net from 'node:net';

const php=process.env.OFFICE_PHP||'php',extensionDir=process.env.OFFICE_PHP_EXT;
const servers=[];
async function start(){
 await mkdir('.runtime',{recursive:true});const dir=await mkdtemp(join(resolve('.runtime'),'http-'));
 const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));
 const args=extensionDir?['-d','extension_dir='+resolve(extensionDir),'-d','extension=pdo_sqlite','-d','extension=openssl','-d','extension=curl']:[];
 const server=spawn(php,[...args,'-S','127.0.0.1:'+port,'-t',resolve('public')],{env:{...process.env,OFFICE_DATA_DIR:dir},windowsHide:true,stdio:['ignore','ignore','pipe']});servers.push(server);
 let logs='';server.stderr.on('data',chunk=>logs=(logs+chunk).slice(-4000));server.on('error',e=>console.error(e));
 const client={dir,csrf:'',cookie:'',url:'http://127.0.0.1:'+port+'/api.php?r='};
 client.call=async(route,body,expected=200,token=client.csrf)=>{
   const response=await fetch(client.url+route,{method:body===undefined?'GET':'POST',headers:{...(client.cookie?{Cookie:client.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':token})},body:body===undefined?undefined:JSON.stringify(body)});
   const cookies=response.headers.getSetCookie();if(cookies.length)client.cookie=cookies[0].split(';')[0];
   const result=await response.json();assert.equal(response.status,expected,route+': '+JSON.stringify(result));return result;
 };
 for(let i=0;i<50;i++){try{const status=await client.call('status');client.csrf=status.csrf;return client;}catch(error){if(server.exitCode!==null)throw Error(logs);if(i===49)throw error;await new Promise(r=>setTimeout(r,50));}}
}
async function setup(c){const before=c.cookie;const result=await c.call('setup',{token:(await readFile(c.dir+'/setup-token.txt','utf8')).trim(),password:'test-password-only-123'});c.csrf=result.csrf;assert.notEqual(c.cookie,before);}
try{
 const a=await start();await a.call('records&kind=tasks',undefined,401);await a.call('google-settings',undefined,401);await a.call('google-settings',{},401);await a.call('account-test',{},401);await a.call('setup',{token:'bad',password:'long-enough-password'},403);await setup(a);
 await a.call('google-settings',{},403,'bad-token');
 await a.call('google-connect',{email:'person@example.com'},400);
 const integration={client_id:'shared.apps.googleusercontent.com',client_secret:'shared-secret-not-exported',redirect:a.url.replace('api.php?r=','api.php?r=oauth-callback')};
 await a.call('google-settings',integration);
 const config=await a.call('google-settings');assert.equal(config.configured,true);assert.equal(config.client_id,integration.client_id);assert.ok(!JSON.stringify(config).includes(integration.client_secret));
 await a.call('google-settings',{...integration,client_secret:''});
 const connection=await a.call('google-connect',{email:'person@example.com',calendar:false});const auth=new URL(connection.url);
 assert.equal(auth.origin,'https://accounts.google.com');assert.equal(auth.searchParams.get('login_hint'),'person@example.com');assert.ok(!auth.searchParams.get('scope').includes('calendar'));
 assert.equal((await a.call('accounts')).accounts.length,0);
 const denied=await fetch(a.url+'oauth-callback&state='+auth.searchParams.get('state')+'&error=access_denied',{headers:{Cookie:a.cookie},redirect:'manual'});assert.equal(denied.status,303);
 assert.match((await a.call('google-settings')).notice.message,/cancelled/);assert.equal((await a.call('accounts')).accounts.length,0);
 const stale=await fetch(a.url+'oauth-callback&state=bad&code=unused',{headers:{Cookie:a.cookie},redirect:'manual'});assert.equal(stale.status,303);assert.match((await a.call('google-settings')).notice.message,/Expired or invalid/);
 await a.call('account-test',{},403,'bad-token');
 const googleDraft={type:'google',label:'Configuration only',email:'fixture@example.com',client_id:'fixture.apps.googleusercontent.com',client_secret:'not-a-real-google-secret',redirect:'http://127.0.0.1:8765/api.php?r=oauth-callback'};
 const googleCheck=await a.call('account-test',googleDraft);assert.equal(googleCheck.status,'authorization_required');assert.ok(!JSON.stringify(googleCheck).includes(googleDraft.client_secret));assert.equal((await a.call('accounts')).accounts.length,0);
 const privateCheck=await a.call('account-test',{type:'imap',label:'Blocked endpoint',email:'test@example.com',host:'127.0.0.1',smtp:'127.0.0.1',username:'test',password:'secret'});assert.equal(privateCheck.status,'failed');assert.equal(privateCheck.checks.length,2);assert.ok(privateCheck.checks.every(check=>check.status==='error'));assert.equal((await a.call('accounts')).accounts.length,0);
 await a.call('account-test',{...googleDraft,client_secret:[]},400);await a.call('account-save',{...googleDraft,redirect:'http://example.com/callback'},400);
 await a.call('save',{kind:'tasks',title:'CSRF',body:'',meta:{}},403,'bad-token');
 let {record}=await a.call('save',{kind:'wiki',title:'home:start',body:'# Start',meta:{}});
 await a.call('save',{kind:'wiki',title:'home:start',body:'duplicate',meta:{}},409);
 const old=record;({record}=await a.call('save',{...record,body:'# Second'}));assert.equal(record.revision,2);await a.call('save',old,409);
 const history=await a.call('history&id='+record.id);assert.equal(history.revisions.length,2);
 let sheet=(await a.call('save',{kind:'sheets',title:'Numbers',body:'',meta:{workbook:{sheets:[{name:'Sheet 1',cells:{}}]}}})).record;
 assert.ok(!Array.isArray(sheet.meta.workbook.sheets[0].cells));sheet.meta.workbook.sheets[0].cells.A1='=2+3';await a.call('save',sheet);
 const storedSheet=(await a.call('records&kind=sheets')).records[0];assert.equal(storedSheet.meta.workbook.sheets[0].cells.A1,'=2+3');
 await a.call('import-items',{records:[{kind:'tasks',title:'Not committed',body:'',meta:{}},{kind:'invalid',title:'bad',body:'',meta:{}}]},400);
 assert.equal((await a.call('records&kind=tasks')).records.length,0);
 const raw=Buffer.concat([Buffer.from('Subject: Binary\r\nContent-Type: text/plain; charset=iso-8859-1\r\n\r\n'),Buffer.from([0xe9,0xff])]);
 await a.call('import',{format:'eml',base64:raw.toString('base64')});const mail=(await a.call('records&kind=mail')).records[0];assert.deepEqual(Buffer.from(mail.meta.rawBase64,'base64'),raw);
 const ics='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:one\r\nSUMMARY:Meeting\r\nDTSTART;VALUE=DATE:20261029\r\nRRULE:FREQ=WEEKLY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
 await a.call('import',{format:'ics',text:ics});assert.equal((await a.call('records&kind=calendar')).records[0].meta.rawIcs,ics);
 const account=await a.call('account-save',{type:'imap',label:'Fixture account',host:'imap.example.com',smtp:'smtp.example.com',email:'test@example.com',username:'test@example.com',password:'a-secret-never-exported'});
 const listed=await a.call('accounts');assert.equal(listed.accounts.length,1);assert.ok(!JSON.stringify(listed).includes('secret'));
 const dbBytes=await readFile(a.dir+'/office.sqlite');assert.ok(!dbBytes.includes(Buffer.from('a-secret-never-exported')));
 await a.call('preferences',{preferences:{theme:'dark',density:'compact'}});const backup=await a.call('backup');assert.equal(backup.records.length,4);assert.ok(!JSON.stringify(backup).includes('a-secret-never-exported'));assert.ok(!JSON.stringify(backup).includes(integration.client_secret));assert.ok(!(await readFile(a.dir+'/office.sqlite')).includes(Buffer.from(integration.client_secret)));
 await a.call('restore',{backup},409);
 const b=await start();await setup(b);await b.call('restore',{backup:{...backup,records:[...backup.records,{kind:'bad',id:'bad',title:'bad',body:'',meta:{}}]}},400);assert.equal((await b.call('records&kind=wiki')).records.length,0);
 const restored=await b.call('restore',{backup});assert.equal(restored.count,4);assert.equal((await b.call('history&id='+record.id)).revisions.length,2);assert.equal((await b.call('status')).preferences.theme,'dark');assert.equal((await b.call('accounts')).accounts.length,0);assert.equal((await b.call('records&kind=sheets')).records[0].meta.workbook.sheets[0].cells.A1,'=2+3');
 await a.call('account-delete',{id:account.id});assert.equal((await a.call('accounts')).accounts.length,0);
 await a.call('logout',{});await a.call('records&kind=tasks',undefined,401);
 console.log('PASS HTTP integration: owner setup/session rotation, authentication, CSRF, stale edits, unique wiki names, atomic imports, binary EML preservation, ICS source, sheet persistence, encrypted accounts, backup/restore/history/preferences and logout.');
}finally{for(const server of servers){if(server.exitCode===null){server.kill();await once(server,'exit');}}}
