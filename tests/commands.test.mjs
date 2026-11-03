import assert from 'node:assert/strict';
import test from 'node:test';
import {CommandError,resolveCommand} from '../public/commands.js';
const navigation={mail:['m'],calendar:['cal'],tasks:['t'],contacts:['con'],docs:['doc','d'],sheets:['sh'],wiki:['w'],settings:['set']};
test('navigation names and exact aliases resolve to canonical commands without arguments',()=>{
 for(const [canonical,aliases] of Object.entries(navigation))for(const name of [canonical,...aliases]){
  assert.deepEqual(resolveCommand(': '+name+' '),{name:canonical,argument:undefined});
  assert.throws(()=>resolveCommand(':'+name+' extra more'),error=>error instanceof CommandError&&error.message==='Unknown parameter: extra');
 }
 for(const name of ['ca','cont','documents','se','constructor','toString'])assert.throws(()=>resolveCommand(':'+name),error=>error instanceof CommandError&&error.message==='Unknown command: '+name);
});
test('commands normalize whitespace and validate every argument before dispatch',()=>{
 assert.deepEqual(resolveCommand(': new doc '),{name:'new',argument:'documents'});
 for(const type of ['mail','event','task','contact','doc','page','sheet'])assert.ok(resolveCommand(':new '+type).argument);
 for(const name of ['head','q','new','log','errors','warnings'])assert.equal(resolveCommand(':'+name).name,name);
 for(const name of ['log','errors','warnings'])assert.throws(()=>resolveCommand(':'+name+' extra'),{name:'Error',message:'Unknown parameter: extra'});
 for(const value of [':',':unknown',':__proto__',':new constructor',':head extra',':q extra',':new doc extra'])assert.throws(()=>resolveCommand(value));
});
test('command errors report only the first offending token',()=>{
 for(const [input,message] of [[':','Unknown command'],[':frob','Unknown command: frob'],[':new banana','Unknown parameter: banana'],[':new bad extra','Unknown parameter: bad'],[':new doc extra more','Unknown parameter: extra'],[':head extra','Unknown parameter: extra'],[':<img>','Unknown command: <img>']]){
  assert.throws(()=>resolveCommand(input),error=>error instanceof CommandError&&error.message===message);
 }
});
