import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionLayout,visibleConnectionItems,GRAPH_LIMIT} from '../public/connection-layout.js';
const items=Array.from({length:1400},(_,i)=>({id:'n'+i,title:'Item '+i,kind:'tasks'}));
const links=items.slice(1).map(item=>({a:'n0',b:item.id}));

test('large hub uses bounded visible nodes and retains selected and center items',()=>{
 const visible=visibleConnectionItems(items,links,'n1399','n0');
 assert.equal(visible.length,GRAPH_LIMIT);assert.ok(visible.some(item=>item.id==='n1399'));assert.ok(visible.some(item=>item.id==='n0'));
 const positions=connectionLayout(visible,links,'n0');assert.equal(positions.length,GRAPH_LIMIT);
 assert.equal(new Set(positions.map(p=>`${p.x},${p.y}`)).size,GRAPH_LIMIT);
 assert.ok(positions.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
 const reversed=links.map(link=>({a:'n1399',b:link.b==='n1399'?'n0':link.b}));
 assert.equal(visibleConnectionItems(items,reversed,'n1399','n1')[0].id,'n1399');
});
test('cyclic and disconnected graphs place each node once, deterministically',()=>{
 const sample=items.slice(0,8),edges=[{a:'n0',b:'n1'},{a:'n1',b:'n2'},{a:'n2',b:'n0'},{a:'n4',b:'n5'},{a:'missing',b:'n0'}];
 const first=connectionLayout(sample,edges,'n1');assert.deepEqual(first,connectionLayout(sample,edges,'n1'));
 assert.equal(first.length,8);assert.equal(first[0].id,'n1');assert.equal(new Set(first.map(p=>`${p.x},${p.y}`)).size,8);
 assert.deepEqual(connectionLayout([],[]),[]);
});
