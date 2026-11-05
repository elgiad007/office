import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionLayout,connectionGroupLayout,connectionTitleLines,connectionNeighbor,connectionArrivalPoint,visibleConnectionItems,GRAPH_LIMIT,GROUP_CARD} from '../public/connection-layout.js';
const items=Array.from({length:1400},(_,i)=>({id:'n'+i,title:'Item '+i,kind:'tasks'}));
const links=items.slice(1).map(item=>({a:'n0',b:item.id}));

test('arrival context reserves a clear side lane or a separate row on narrow maps',()=>{
 const points=[{id:'current',x:0,y:0},{id:'peer',x:270,y:0},{id:'other',x:0,y:76}];
 const side=connectionArrivalPoint(points,'current',1000);assert.equal(side.y,0);assert.ok(side.x+120<Math.min(...points.map(p=>p.x-120)));
 const above=connectionArrivalPoint(points,'current',366);assert.equal(above.x,0);assert.ok(above.y+32<Math.min(...points.map(p=>p.y-60)));
 assert.equal(connectionArrivalPoint(points,'current',500,100).y,0);
 assert.equal(connectionArrivalPoint(points,'missing',1000),undefined);
});

test('map movement follows spatial neighbors and stops at edges',()=>{
 const grid=[{id:'a',x:0,y:0},{id:'b',x:320,y:0},{id:'c',x:0,y:124},{id:'d',x:320,y:124}];
 assert.equal(connectionNeighbor(grid,'a','right'),'b');assert.equal(connectionNeighbor(grid,'a','down'),'c');
 assert.equal(connectionNeighbor(grid,'d','left'),'c');assert.equal(connectionNeighbor(grid,'d','up'),'b');
 assert.equal(connectionNeighbor(grid,'a','up'),undefined);assert.equal(connectionNeighbor(grid,'d','down'),undefined);
 assert.equal(connectionNeighbor([],'missing','left'),undefined);
});

test('horizontal boundaries continue to adjacent rows, including uneven rows',()=>{
 const grid=[{id:'a',x:0,y:0},{id:'b',x:320,y:0},{id:'c',x:0,y:124},{id:'d',x:320,y:124},{id:'e',x:640,y:124}];
 assert.equal(connectionNeighbor(grid,'b','right'),'c');assert.equal(connectionNeighbor(grid,'c','left'),'b');
 assert.equal(connectionNeighbor(grid,'a','left'),undefined);assert.equal(connectionNeighbor(grid,'e','right'),undefined);
 assert.equal(connectionNeighbor([...grid].reverse(),'b','right'),'c');
});

test('single-row movement bindings map down to left and up to right',()=>{
 const row=[{id:'a',x:0,y:0},{id:'b',x:270,y:0},{id:'c',x:540,y:0}];
 assert.equal(connectionNeighbor(row,'b','down',true),'a');assert.equal(connectionNeighbor(row,'b','up',true),'c');
 assert.equal(connectionNeighbor(row,'a','down',true),undefined);assert.equal(connectionNeighbor(row,'c','up',true),undefined);
 assert.equal(connectionNeighbor(row,'b','down'),undefined);assert.equal(connectionNeighbor(row,'b','up'),undefined);
 assert.equal(connectionNeighbor([row[0]],'a','up',true),undefined);
 const column=[{id:'a',x:0,y:0},{id:'b',x:0,y:76}];assert.equal(connectionNeighbor(column,'a','down',true),'b');
});

test('overview packs groups at full size whenever the viewport has room',()=>{
 for(const [count,width,height] of [[6,1028,680],[6,800,680],[4,350,540]]){
  const points=connectionGroupLayout(Array.from({length:count},(_,i)=>String(i)),width,height);
  assert.equal(points.length,count);assert.ok(Math.max(...points.map(p=>p.x))+GROUP_CARD.width+GROUP_CARD.padding*2<=width);
  assert.ok(Math.max(...points.map(p=>p.y))+GROUP_CARD.height+GROUP_CARD.padding*2<=height);
  assert.equal(new Set(points.map(p=>`${p.x},${p.y}`)).size,count);
 }
 const crowded=connectionGroupLayout(Array.from({length:60},(_,i)=>String(i)),1000,600);
 assert.ok(Math.max(...crowded.map(p=>p.y))+GROUP_CARD.height>600||Math.max(...crowded.map(p=>p.x))+GROUP_CARD.width>1000);
 assert.deepEqual(connectionGroupLayout([],1000,600),[]);
});
test('titles wrap at words and measured widths with explicit truncation',()=>{
 assert.deepEqual(connectionTitleLines('Quarterly planning meeting',18),['Quarterly planning','meeting']);
 assert.deepEqual(connectionTitleLines('A'.repeat(60),20),['A'.repeat(20),'A'.repeat(19)+'…']);
 const measured=connectionTitleLines('W'.repeat(60),40,text=>Array.from(text).length*14,180);
 assert.ok(measured.every(line=>Array.from(line).length*14<=180));assert.ok(measured[1].endsWith('…'));
 assert.ok(connectionTitleLines('😀'.repeat(50),20).every(line=>!line.includes('\ufffd')));
});

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
