import assert from 'node:assert/strict';
import test from 'node:test';
import {helpEntries,searchHelp} from '../public/help.js';
import {commandRegistry,creationTypes,resolveCommand} from '../public/commands.js';
const keys={down:'j',up:'k',left:'h',right:'l',pageDown:'d',pageUp:'u',edit:'i',new:'c',search:'/',help:'?',select:'v',save:'s',archive:'a',reply:'r',move:'m',delete:'D',undoDelete:'U'};
test('help follows current bindings including help and Sheets movement',()=>{
 const rows=helpEntries({...keys,help:'!',left:'H',down:'J',up:'K',right:'L',edit:'I'});
 assert.equal(rows.find(r=>r.action==='Open keyboard and command help').shortcut,'!');
 assert.equal(rows.find(r=>r.action==='Move between cells').shortcut,'Arrow keys');
 assert.equal(rows.find(r=>r.action==='Edit selected cell').shortcut,'I / Enter');
 for(const key of Object.keys(keys))assert.ok(rows.some(r=>r.shortcut.includes(({help:'!',left:'H',down:'J',up:'K',right:'L',edit:'I'})[key]||keys[key])),key);
});
test('command help inventory and type options come from parser registry',()=>{
 const rows=helpEntries(keys).filter(r=>r.shortcut.startsWith(':')&&r.shortcut!==':');
 assert.deepEqual(rows.map(r=>r.shortcut),Object.keys(commandRegistry).map(n=>':'+n));
 for(const row of rows)assert.equal(resolveCommand(row.shortcut+([':link',':unlink'].includes(row.shortcut)?' example-id':'')).name,row.shortcut.slice(1));
 for(const [name,entry] of Object.entries(commandRegistry))if(entry.aliases)for(const alias of entry.aliases){
  const canonical=rows.find(row=>row.shortcut===':'+name);
  assert.ok(canonical.options.includes(':'+alias));
  assert.ok(searchHelp(rows,':'+alias).includes(canonical));
  assert.equal(rows.filter(row=>row.shortcut===':'+name).length,1);
 }
 for(const type of Object.keys(creationTypes)){assert.ok(rows.find(r=>r.shortcut===':new').options.includes(type));assert.equal(resolveCommand(':new '+type).argument,creationTypes[type]);}
});
test('search covers every column, ignores case and whitespace, and requires every term',()=>{
 const rows=helpEntries(keys);
 for(const query of [':warnings','restore focus','CURRENT APPLICATION','15 minutes','Quick Move search',':new Calendar'])assert.ok(searchHelp(rows,query).length,query);
 assert.equal(searchHelp(rows,'  ').length,rows.length);
 assert.equal(searchHelp(rows,'no-such-shortcut').length,0);
 assert.equal(searchHelp(rows,'warnings spreadsheet').length,0);
});
