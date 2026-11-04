import test from 'node:test';
import assert from 'node:assert/strict';
import {elapsedTime,timestampTime,timestampText,timestampLabel,configureTimeLabels,refreshTimeLabels} from '../public/time-labels.js';

test('elapsed labels show now below one minute, then minutes, hours and days',()=>{
  const now=Date.parse('2026-11-04T12:00:00Z');
  for(const seconds of [0,1,59,59.999]){
    assert.equal(elapsedTime(new Date(now-seconds*1000).toISOString(),now),'now');
    assert.equal(elapsedTime(new Date(now+seconds*1000).toISOString(),now),'now');
    assert.equal(timestampText(new Date(now-seconds*1000).toISOString(),'Date',now),'Date (now)');
  }
  for(const [seconds,label] of [[60,'1 minute'],[3599,'59 minutes'],[3600,'1 hour'],[86399,'23 hours'],[86400,'1 day'],[172800,'2 days'],[400*86400,'400 days']]){
    assert.equal(elapsedTime(new Date(now-seconds*1000).toISOString(),now),label+' ago');
    if(seconds)assert.equal(elapsedTime(new Date(now+seconds*1000).toISOString(),now),'in '+label);
  }
  assert.equal(elapsedTime('invalid',now),'');
  assert.equal(elapsedTime('',now),'');
  assert.equal(timestampText('invalid','Original date',now),'Original date');
});

test('date-only values use local midnight, timestamps honor explicit offsets',()=>{
  assert.equal(timestampTime('2026-11-04'),+new Date(2026,10,4));
  assert.equal(timestampTime('2026-11-04T07:00:00-05:00'),timestampTime('2026-11-04T12:00:00Z'));
});

test('labels escape values and update existing nodes; disabling hides elapsed text everywhere',t=>{
  const oldDocument=globalThis.document;
  const node={dataset:{elapsedTime:'2026-11-04T12:00:00Z'},textContent:'',hidden:false};
  globalThis.document={querySelectorAll:()=>[node]};
  t.after(()=>{configureTimeLabels(true);globalThis.document=oldDocument;});
  const now=Date.parse(node.dataset.elapsedTime)+60000;
  assert.equal(timestampText(node.dataset.elapsedTime,'Date',now),'Date (1 minute ago)');
  assert.match(timestampLabel(node.dataset.elapsedTime,'<Date>'),/^&lt;Date&gt;<span data-elapsed-time=/);
  assert.equal(timestampLabel('bad"<date>','<Bad>'),'&lt;Bad&gt;');
  refreshTimeLabels(document,now);
  assert.equal(node.textContent,' (1 minute ago)');
  refreshTimeLabels(document,now+3600000);
  assert.equal(node.textContent,' (1 hour ago)');
  configureTimeLabels(false);
  assert.equal(node.hidden,true);
  assert.equal(timestampText(node.dataset.elapsedTime,'Date',now),'Date');
  assert.match(timestampLabel(node.dataset.elapsedTime,'Date'),/ hidden>/);
  configureTimeLabels(true);
  assert.equal(node.hidden,false);
});
