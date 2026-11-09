import assert from 'node:assert/strict';
import test from 'node:test';
import {senderDomain,renderMailListIcon} from '../public/mail-list.js';

test('sender domain uses the mailbox and rejects malformed domains',()=>{
  assert.equal(senderDomain('Display name <user@Example.COM>'),'example.com');
  assert.equal(senderDomain('user@news.example.com'),'news.example.com');
  for(const value of ['', 'Unknown sender','user@localhost','user@-example.com','user@example..com','user@example.com/path','user@example.com:443'])assert.equal(senderDomain(value),undefined,value);
});
test('mail identity keeps fallback, selection and connection count independent',()=>{
  const row={meta:{from:'user@example.com'},connectionCount:123};
  const html=renderMailListIcon(row,false,'<svg class="fallback"></svg>');
  assert.doesNotMatch(html,/sender-favicon.php/);
  assert.match(renderMailListIcon(row,false,'envelope',true),/sender-favicon.php\?domain=example.com/);
  assert.match(html,/class="fallback"/);
  assert.match(html,/aria-label="123 connections"/);
  const selected=renderMailListIcon(row,true,'envelope');
  assert.match(selected,/✓/);assert.doesNotMatch(selected,/<img/);assert.match(selected,/123 connections/);
  assert.match(renderMailListIcon({meta:{}},false,'envelope'),/mail-list-connections" hidden/);
});
