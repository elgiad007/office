import test from 'node:test';
import assert from 'node:assert/strict';
import {headerMatches} from '../public/mail-headers.js';

test('header search is literal, case insensitive and preserves source offsets',()=>{
  assert.deepEqual(headerMatches('Received: A\r\nreceived: B','RECEIVED'),[0,13]);
  assert.deepEqual(headerMatches('.* [x] .*','.*'),[0,7]);
  assert.deepEqual(headerMatches('İ: Received','received'),[3]);
  assert.deepEqual(headerMatches('aaaa','aa'),[0,2]);
  assert.deepEqual(headerMatches('anything',''),[]);
  assert.deepEqual(headerMatches('anything','absent'),[]);
});
