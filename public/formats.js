export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function csvParse(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"' && !cell) quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (quoted) throw Error('Unclosed CSV quote.');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
export function csvWrite(rows) { return rows.map(row => row.map(v => '"' + String(v ?? '').replaceAll('"','""') + '"').join(',')).join('\r\n'); }
export function colName(index) { let s = ''; for (index++; index > 0; index = Math.floor((index - 1) / 26)) s = String.fromCharCode(65 + (index - 1) % 26) + s; return s; }
export function cellPosition(ref) {
  const m = /^([A-Z]+)([1-9]\d*)$/.exec(ref); if (!m) throw Error('#REF!');
  let col = 0; for (const c of m[1]) col = col * 26 + c.charCodeAt(0) - 64;
  if (col > 26 || Number(m[2]) > 100) throw Error('#REF!'); return [Number(m[2]) - 1, col - 1];
}
export function cellValue(cells, ref, visiting = new Set(), context = {values:new Map(), count:0}) {
  try {
    if (++context.count > 10000 || visiting.size > 128) throw Error('#LIMIT!');
    if (context.values.has(ref)) return context.values.get(ref);
    cellPosition(ref); const raw = String(cells[ref] ?? '');
    if (!raw.startsWith('=')) return raw === '' ? '' : Number.isFinite(Number(raw)) ? Number(raw) : raw;
    if (visiting.has(ref)) throw Error('#CYCLE!');
    const next = new Set(visiting).add(ref); let source = raw.slice(1).toUpperCase(), pos = 0, tokens = [];
    while (pos < source.length) {
      if (/\s/.test(source[pos])) { pos++; continue; }
      const m = /^(\d+(?:\.\d*)?|\.\d+|[A-Z]+[1-9]\d*|[A-Z]+|[+\-*/^(),:])/.exec(source.slice(pos));
      if (!m) throw Error('#FORMULA!'); tokens.push(m[1]); pos += m[1].length;
      if (tokens.length > 500) throw Error('#LIMIT!');
    }
    let i = 0;
    const number = v => { if (typeof v === 'string' && v.startsWith('#')) throw Error(v); if (v === '') return 0; if (!Number.isFinite(Number(v))) throw Error('#VALUE!'); return Number(v); };
    const read = address => number(cellValue(cells, address, next, context));
    const expression = (min = 0) => {
      let token = tokens[i++], left;
      if (token === '+' || token === '-') left = (token === '-' ? -1 : 1) * expression(3);
      else if (token === '(') { left = expression(); if (tokens[i++] !== ')') throw Error('#FORMULA!'); }
      else if (/^(\d|\.)/.test(token ?? '')) left = Number(token);
      else if (/^[A-Z]+[1-9]\d*$/.test(token ?? '')) left = read(token);
      else if (['SUM','AVERAGE','MIN','MAX','COUNT'].includes(token)) {
        if (tokens[i++] !== '(') throw Error('#FORMULA!'); const args = [];
        if (tokens[i] !== ')') do {
          if (/^[A-Z]+[1-9]\d*$/.test(tokens[i] ?? '') && tokens[i + 1] === ':') {
            const [r1,c1] = cellPosition(tokens[i]); const [r2,c2] = cellPosition(tokens[i + 2]); i += 3;
            for (let r = Math.min(r1,r2); r <= Math.max(r1,r2); r++) for (let c = Math.min(c1,c2); c <= Math.max(c1,c2); c++) {
              const value = cellValue(cells, colName(c) + (r + 1), next, context);
              if (typeof value === 'string' && value.startsWith('#')) throw Error(value);
              if (value !== '' && Number.isFinite(Number(value))) args.push(Number(value));
            }
          } else args.push(expression());
          if (tokens[i] !== ',') break; i++;
        } while (true);
        if (tokens[i++] !== ')') throw Error('#FORMULA!');
        left = token === 'SUM' ? args.reduce((a,b) => a+b,0) : token === 'COUNT' ? args.length : !args.length ? 0 : token === 'AVERAGE' ? args.reduce((a,b) => a+b,0)/args.length : token === 'MIN' ? Math.min(...args) : Math.max(...args);
      } else throw Error('#FORMULA!');
      while (i < tokens.length) {
        const op = tokens[i], precedence = ({'+':1,'-':1,'*':2,'/':2,'^':4})[op];
        if (precedence === undefined || precedence < min) break; i++;
        const right = expression(precedence + (op === '^' ? 0 : 1));
        if (op === '/' && right === 0) throw Error('#DIV/0!');
        left = op === '+' ? left+right : op === '-' ? left-right : op === '*' ? left*right : op === '/' ? left/right : left**right;
      }
      return left;
    };
    const result = expression(); if (i !== tokens.length || !Number.isFinite(result)) throw Error('#FORMULA!'); context.values.set(ref,result); return result;
  } catch (e) { return e.message.startsWith('#') ? e.message : '#FORMULA!'; }
}
export function markdown(text) {
  let code = false;
  return text.split('\n').map(line => {
    if (line.startsWith('```')) { code = !code; return code ? '<pre><code>' : '</code></pre>'; }
    if (code) return escapeHtml(line) + '\n';
    let safe = escapeHtml(line).replace(/\[\[([^\]]+)\]\]/g, (_,name) => `<button class="wiki-link" data-wiki="${name}">${name}</button>`)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/gi, '<a href="$2" rel="noreferrer noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>');
    const heading = /^(#{1,6})\s+(.*)$/.exec(safe);
    if (heading) return `<h${heading[1].length}>${heading[2]}</h${heading[1].length}>`;
    if (/^[-*] /.test(safe)) return `<p class="bullet">• ${safe.slice(2)}</p>`;
    if (safe.startsWith('&gt; ')) return `<blockquote>${safe.slice(5)}</blockquote>`;
    return safe ? `<p>${safe}</p>` : '<br>';
  }).join('') + (code ? '</code></pre>' : '');
}
export function safeDocument(html) {
  const parsed = new DOMParser().parseFromString(html, 'text/html'); const output = document.createElement('div');
  const allowed = new Set(['P','DIV','BR','STRONG','B','EM','I','U','H1','H2','H3','H4','UL','OL','LI','BLOCKQUOTE','PRE','CODE','TABLE','THEAD','TBODY','TR','TH','TD','HR','A']);
  function copy(node, parent) {
    if (node.nodeType === Node.TEXT_NODE) { parent.append(document.createTextNode(node.textContent)); return; }
    if (node.nodeType !== Node.ELEMENT_NODE || ['SCRIPT','STYLE','IFRAME','OBJECT','SVG','MATH','TEMPLATE'].includes(node.tagName)) return;
    if (node.tagName === 'IMG') {
      const src=node.getAttribute('src')||'', alt=node.getAttribute('alt')||'';
      if (/^data:image\/(png|jpeg|gif|webp);base64,[a-zA-Z0-9+/=\r\n]+$/.test(src) && src.length<=1400000) { const image=document.createElement('img'); image.src=src; image.alt=alt; parent.append(image); }
      else parent.append(document.createTextNode(alt || '[External or unsupported image omitted]'));
      return;
    }
    const target = allowed.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : parent;
    if (node.tagName === 'A') { const href = node.getAttribute('href') || ''; if (/^(https?:|mailto:)/i.test(href)) { target.setAttribute('href', href); target.setAttribute('rel','noreferrer noopener'); } }
    for (const child of node.childNodes) copy(child, target);
    if (target !== parent) parent.append(target);
  }
  for (const node of parsed.body.childNodes) copy(node, output); return output.innerHTML;
}
export function icsExport(records) {
  const esc = v => String(v ?? '').replaceAll('\\','\\\\').replaceAll('\n','\\n').replaceAll(',','\\,').replaceAll(';','\\;').replaceAll('\r','');
  const date = v => /^\d{4}-\d{2}-\d{2}$/.test(v) ? ';VALUE=DATE:' + v.replaceAll('-','') : ':' + new Date(v).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Portable Office//EN'];
  for (const r of records) {
    lines.push('BEGIN:VEVENT','UID:' + esc(r.meta.uid || r.id + '@portable-office'),'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''),'SUMMARY:' + esc(r.title));
    if (r.meta.start) lines.push('DTSTART' + date(r.meta.start));
    if (r.meta.end) lines.push('DTEND' + date(r.meta.end));
    if (r.meta.recurrence) lines.push('RRULE:' + String(r.meta.recurrence).replace(/[\r\n]/g,''));
    lines.push('DESCRIPTION:' + esc(r.body),'LOCATION:' + esc(r.meta.location),'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  // RFC 5545 folding counts UTF-8 bytes, not UTF-16 code units.
  return lines.map(line => { let out = '', count = 0; for (const c of line) { const bytes = new TextEncoder().encode(c).length; if (count + bytes > 73) { out += '\r\n '; count = 1; } out += c; count += bytes; } return out; }).join('\r\n') + '\r\n';
}
export function vcardExport(records) {
  const esc = s => String(s ?? '').replaceAll('\\','\\\\').replaceAll('\n','\\n').replaceAll(';','\\;').replaceAll(',','\\,').replaceAll('\r','');
  return records.map(r => ['BEGIN:VCARD','VERSION:3.0','FN:' + esc(r.title),'EMAIL:' + esc(r.meta.email),'TEL:' + esc(r.meta.phone),'ORG:' + esc(r.meta.company),'NOTE:' + esc(r.body),'END:VCARD'].join('\r\n')).join('\r\n');
}
export function vcardParse(text) {
  return text.replace(/\r?\n[ \t]/g,'').split(/BEGIN:VCARD/i).slice(1).map(block => {
    const r = {kind:'contacts',title:'',body:'',meta:{}};
    for (const line of block.split(/\r?\n/)) { const p = line.indexOf(':'); if (p < 0) continue; const key = line.slice(0,p).split(';')[0].toUpperCase(), value = line.slice(p+1).replace(/\\n/gi,'\n').replace(/\\([,;\\])/g,'$1');
      if (key === 'FN') r.title = value; if (key === 'NOTE') r.body = value; if (key === 'EMAIL') r.meta.email = value; if (key === 'TEL') r.meta.phone = value; if (key === 'ORG') r.meta.company = value;
    }
    if (!r.title) throw Error('Every contact needs an FN field.'); return r;
  });
}
