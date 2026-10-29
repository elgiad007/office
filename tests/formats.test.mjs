import test from 'node:test';
import assert from 'node:assert/strict';
import {csvParse,csvWrite,cellValue,icsExport,markdown,vcardExport,vcardParse} from '../public/formats.js';

test('CSV round-trips multiline fields, quotes, Unicode and trailing blanks',()=>{
  const rows=[['name','notes',''],['Zoë','two\nlines, "quoted"',''],['','last','']];
  assert.deepEqual(csvParse(csvWrite(rows)),rows);
  assert.throws(()=>csvParse('"unfinished'),/Unclosed/);
});
test('formulas calculate references, precedence, ranges and dependencies',()=>{
  const cells={A1:'5',A2:'7',A3:'=SUM(A1:A2)',B1:'=A3*2+2^3',B2:'=-2^2',C1:'=AVERAGE(A1:A3)',C2:'=COUNT(A1:A4)'};
  assert.equal(cellValue(cells,'B1'),32);assert.equal(cellValue(cells,'B2'),-4);assert.equal(cellValue(cells,'C1'),8);assert.equal(cellValue(cells,'C2'),3);
});
test('formula engine rejects scripts, out-of-bounds references, cycles and invalid syntax',()=>{
  assert.equal(cellValue({A1:'=A2',A2:'=A1'},'A1'),'#CYCLE!');
  assert.equal(cellValue({A1:'=1/0'},'A1'),'#DIV/0!');
  for(const formula of ['=fetch("https://example.com")','=1;globalThis.x=1','=SUM(A1:)','=1 2','=Z101'])assert.match(String(cellValue({A1:formula},'A1')),/^#/);
});
test('shared formula dependencies do not expand exponentially',()=>{
 const cells={A1:'1',A2:'1'};for(let n=3;n<=50;n++)cells['A'+n]='=A'+(n-1)+'+A'+(n-2);
 assert.equal(cellValue(cells,'A50'),12586269025);
});
test('Markdown source cannot inject active HTML',()=>{
  const html=markdown('# Hello\n<script>alert(1)</script>\n[[page" onclick="alert(1)]]');
  assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&quot;'));assert.match(html,/<h1>Hello<\/h1>/);
});
test('calendar export escapes values and folds Unicode by UTF-8 bytes',()=>{
  const text=icsExport([{id:'1',title:'Meeting, '+ 'é'.repeat(100),body:'Line 1\nLine 2',meta:{start:'2026-10-29',end:'2026-10-30',location:'Room; 2'}}]);
  assert.match(text,/DTSTART;VALUE=DATE:20261029/);assert.match(text,/Meeting\\,/);assert.match(text,/Line 1\\nLine 2/);
  for(const line of text.split('\r\n'))assert.ok(new TextEncoder().encode(line).length<=75);
});
test('vCard export/import keeps basic contact content',()=>{
  const records=[{title:'Zoë, Smith',body:'First\nSecond',meta:{email:'z@example.com',phone:'+1 555',company:'One;Two'}}];
  const [parsed]=vcardParse(vcardExport(records));assert.equal(parsed.title,records[0].title);assert.deepEqual(parsed.meta,records[0].meta);assert.equal(parsed.body,records[0].body);
});
