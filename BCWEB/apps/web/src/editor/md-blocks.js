// Markdown ↔ blocks: the two functions the visual editor is made of.
//
// Plain JS in their own file, because they are the pair that can LOSE somebody's work.
// `parse` reads a document into blocks and `serialize` writes them back, so anything the
// first does not understand has to survive the second — a fact no amount of reading proves
// and a round-trip test settles in a line.
//
// They were inside the component, where nothing could import them and nothing did test them.

let _uid = 0;
export const uid = () => `b${Date.now().toString(36)}${_uid++}`;


export const CALLOUT_KINDS = ['note', 'tip', 'success', 'warning', 'danger', 'callout'];

export function blank(type) {
  switch (type) {
    case 'heading': return { id: uid(), type, level: 2, text: 'Heading' };
    case 'callout': return { id: uid(), type, kind: 'tip', icon: '', color: '', title: 'Good to know', text: 'Something worth highlighting.' };
    case 'card': return { id: uid(), type, title: 'Card', icon: '', href: '', image: '', text: 'Card description.' };
    case 'image': return { id: uid(), type, url: '', alt: '' };
    case 'code': return { id: uid(), type, lang: 'js', code: 'console.log("hello");' };
    case 'quote': return { id: uid(), type, text: 'Quote' };
    case 'collapsible': return { id: uid(), type, summary: 'Click to expand', text: 'Hidden content.' };
    case 'table': return { id: uid(), type, rows: [['Column 1', 'Column 2'], ['', '']] };
    case 'tags': return { id: uid(), type, tags: [{ text: 'New', color: '#16a34a' }, { text: 'Beta', color: '#2563eb' }] };
    case 'file': return { id: uid(), type, name: 'example.zip', href: '', size: '' };
    case 'steps': return { id: uid(), type, title: 'How it works', marker: '1', color: '', orientation: 'vertical', steps: [{ title: 'First', text: 'What to do.' }, { title: 'Second', text: 'And then this.' }] };
    case 'roadmap': return { id: uid(), type, title: 'Roadmap', orientation: 'vertical', json: '{\n  "categories": [\n    { "name": "v1.0", "items": [\n      { "label": "Core", "status": "done" },\n      { "label": "Docs", "status": "progress", "percent": 40 }\n    ] }\n  ]\n}' };
    case 'columns': return { id: uid(), type, left: 'Left column.', right: 'Right column.' };
    case 'align': return { id: uid(), type, align: 'center', text: 'Centered content.' };
    case 'tabs': return { id: uid(), type, tabs: [{ title: 'Windows', text: 'Run `install.exe`.' }, { title: 'Linux', text: 'Run `./install.sh`.' }] };
    case 'cards': return { id: uid(), type, cols: '', cards: [
      { title: 'First', icon: 'book', href: '', image: '', color: '', text: 'What it does.' },
      { title: 'Second', icon: 'rocket', href: '', image: '', color: '', text: 'What it does.' },
    ] };
    case 'buttons': return { id: uid(), type, items: [
      { label: 'Watch', brand: 'youtube', color: '', size: 'md', href: 'https://youtube.com', outline: false },
      { label: 'Read the guide', brand: '', color: '', size: 'md', href: '/docs', outline: false },
    ] };
    case 'math': return { id: uid(), type, tex: 'E = mc^2' };
    case 'replay': return { id: uid(), type, src: '', title: '', autoplay: false, loop: false };
    case 'divider': return { id: uid(), type };
    default: return { id: uid(), type: 'text', text: '' };
  }
}

// ── markdown → blocks (line-based, best-effort) ───────────────────────────────
export function parse(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  const flushText = (buf) => { const t = buf.join('\n').trim(); if (t) blocks.push({ id: uid(), type: 'text', text: t }); };
  let textBuf = [];
  while (i < lines.length) {
    const line = lines[i];
    // fenced code
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flushText(textBuf); textBuf = [];
      const code = []; i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
      i++; blocks.push({ id: uid(), type: 'code', lang: fence[1] || '', code: code.join('\n') });
      continue;
    }
    // container directive (callout / card / details) — capture to its closing fence.
    // Canonical order is `:::name[label]{attrs}`.
    const dir = line.match(/^(:{3,})([\w-]+)(\[[^\]]*\])?(\{[^}]*\})?\s*$/);
    if (dir) {
      const colons = dir[1]; const name = dir[2].toLowerCase();
      const label = dir[3] ? dir[3].slice(1, -1) : ''; const attrs = parseAttrs(dir[4]);
      const inner = []; i++;
      const close = new RegExp(`^:{${colons.length},}\\s*$`);
      let depth = 1;
      while (i < lines.length) {
        if (new RegExp(`^:{3,}[\\w-]`).test(lines[i])) depth++;
        else if (close.test(lines[i]) || /^:{3,}\s*$/.test(lines[i])) { depth--; if (depth === 0) { i++; break; } }
        inner.push(lines[i]); i++;
      }
      const innerText = inner.join('\n').trim();
      flushText(textBuf); textBuf = [];
      if (name === 'card' || name === 'ref') {
        blocks.push({ id: uid(), type: 'card', title: label || attrs.title || '', icon: attrs.icon || '', href: attrs.href || attrs.link || '', image: attrs.image || '', color: attrs.color || '', text: innerText });
      } else if (name === 'details' || name === 'collapse') {
        blocks.push({ id: uid(), type: 'collapsible', summary: label || attrs.title || 'Details', text: innerText });
      } else if (name === 'file') {
        blocks.push({ id: uid(), type: 'file', name: label || attrs.name || 'file', href: attrs.href || attrs.url || '', size: attrs.size || '' });
      } else if (name === 'steps') {
        // The inner `:::step[Title]` children, back into the rows the editor edits.
        blocks.push({
          id: uid(), type: 'steps', title: label || attrs.title || '',
          // serialize() writes the marker as `type=`; '1' is the default and is omitted.
          marker: attrs.type || '1',
          color: attrs.color || '',
          orientation: attrs.orientation === 'horizontal' ? 'horizontal' : 'vertical',
          steps: parseChildren(innerText, 'step').map((c) => ({
            title: c.label, text: c.body,
            icon: c.attrs?.icon || '', color: c.attrs?.color || '', status: c.attrs?.status || '',
          })),
        });
      } else if (name === 'roadmap') {
        // The body is a ```json fence. Unwrap it: the editor edits the JSON itself, and
        // handing it back the fence made the fence part of the value — which is how a
        // second save produced a fence inside a fence.
        const fence = innerText.match(/^```[\w]*\n([\s\S]*?)\n?```$/);
        blocks.push({
          id: uid(), type: 'roadmap', title: label || attrs.title || '',
          orientation: attrs.orientation === 'horizontal' ? 'horizontal' : 'vertical',
          json: (fence ? fence[1] : innerText).trim() || '{}',
        });
      } else if (name === 'tabs') {
        blocks.push({
          id: uid(), type: 'tabs',
          tabs: parseChildren(innerText, 'tab').map((c) => ({ title: c.attrs?.title || c.label || '', text: c.body })),
        });
      } else if (name === 'cards') {
        blocks.push({
          id: uid(), type: 'cards', cols: attrs.cols || '',
          cards: parseChildren(innerText, 'card').map((c) => ({
            title: c.attrs?.title || c.label || '', icon: c.attrs?.icon || '', href: c.attrs?.href || '',
            image: c.attrs?.image || '', color: c.attrs?.color || '', text: c.body,
          })),
        });
      } else if (name === 'replay' || name === 'bmmreplay') {
        blocks.push({
          id: uid(), type: 'replay', src: attrs.src || attrs.href || '', title: label || attrs.title || '',
          autoplay: attrs.autoplay !== undefined, loop: attrs.loop !== undefined,
        });
      } else if (name === 'columns') {
        const cols = parseChildren(innerText, 'column');
        blocks.push({ id: uid(), type: 'columns', left: cols[0]?.body || '', right: cols[1]?.body || '' });
      } else if (name === 'center' || name === 'left' || name === 'right') {
        // alignment wrapper — apply to the inner block(s)
        const inner = parse(innerText); inner.forEach((bl) => { bl.align = name; blocks.push(bl); });
      } else if (CALLOUT_KINDS.includes(name) || name === 'callout' || ['info', 'hint', 'caution', 'important', 'error', 'check'].includes(name)) {
        blocks.push({ id: uid(), type: 'callout', kind: name, icon: attrs.icon || '', color: attrs.color || '', title: label || attrs.title || '', text: innerText });
      } else {
        // A container this editor has no block for — `:::tabs`, `:::replay`, `:::cards`, and
        // whatever the renderer learns next.
        //
        // It keeps the WHOLE thing, fences included. It used to keep `innerText` only, which
        // silently deleted the wrapper: a document with tabs in it came back with two orphan
        // `:::tab` blocks after one visit to Visual mode and with nothing but the tab bodies
        // after two. A `:::replay` was erased outright on the first save — the block has no
        // body, so "keep the inside" kept an empty string.
        //
        // Nobody edited anything. They toggled a tab, looked at it, and saved.
        //
        // A text block is emitted verbatim, so the directive round-trips exactly and the
        // renderer still draws it. Which also means this branch is the right home for
        // anything new: unknown here is preserved, not dropped.
        blocks.push({ id: uid(), type: 'text', text: [line, ...inner, colons].join('\n') });
      }
      continue;
    }
    // GFM table: a `| … |` row followed by a `|---|---|` separator.
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flushText(textBuf); textBuf = [];
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/\\\|/g, '|'));
      const rows = [cells(line)]; i += 2; // skip header + separator
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      blocks.push({ id: uid(), type: 'table', rows });
      continue;
    }
    const h = line.match(/^(#{2,3})\s+(.*)$/);
    if (h) { flushText(textBuf); textBuf = []; blocks.push({ id: uid(), type: 'heading', level: h[1].length, text: h[2].trim() }); i++; continue; }
    if (/^(---|\*\*\*|___)\s*$/.test(line)) { flushText(textBuf); textBuf = []; blocks.push({ id: uid(), type: 'divider' }); i++; continue; }
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (img) { flushText(textBuf); textBuf = []; blocks.push({ id: uid(), type: 'image', alt: img[1], url: img[2] }); i++; continue; }
    // A line made only of :badge[...] chips → a Tags block.
    if (line.trim() && /^(?::badge\[[^\]]*\](?:\{[^}]*\})?\s*)+$/.test(line.trim())) {
      flushText(textBuf); textBuf = [];
      const tags = []; const re = /:badge\[([^\]]*)\](?:\{([^}]*)\})?/g; let mm;
      while ((mm = re.exec(line))) tags.push({ text: mm[1], color: parseAttrs(mm[2] ? `{${mm[2]}}` : '').color || '' });
      blocks.push({ id: uid(), type: 'tags', tags }); i++; continue;
    }
    if (/^>\s?/.test(line)) {
      flushText(textBuf); textBuf = [];
      const quote = []; while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i++; }
      blocks.push({ id: uid(), type: 'quote', text: quote.join('\n').trim() }); continue;
    }
    if (line.trim() === '') { flushText(textBuf); textBuf = []; i++; continue; }
    textBuf.push(line); i++;
  }
  flushText(textBuf);
  return blocks.length ? blocks : [{ id: uid(), type: 'text', text: '' }];
}

/** The `:::name[label] … :::` children directly inside a container's body.
 *
 *  Kept separate from parse() because these are not blocks in their own right — a
 *  `:::step` outside a `:::steps` means nothing, and the editor never offers one. It
 *  counts colons the same way parse() does, so a child that itself contains a nested
 *  directive does not end its parent early.
 */
function parseChildren(inner, wanted) {
  const lines = String(inner || '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^(:{3,})([\w-]+)(\[[^\]]*\])?(\{[^}]*\})?\s*$/);
    if (!m || m[2].toLowerCase() !== wanted) { i++; continue; }
    const colons = m[1].length;
    const label = m[3] ? m[3].slice(1, -1) : '';
    // The child's own attributes. A `:::tab` carries its title there rather than in a label,
    // and a `:::step` can carry an icon, a colour and a status — all of which the renderer
    // reads and all of which were dropped here, so a tab came back named nothing.
    const attrs = parseAttrs(m[4]);
    const body = []; i++;
    let depth = 1;
    while (i < lines.length) {
      if (/^:{3,}[\w-]/.test(lines[i])) depth++;
      else if (new RegExp(`^:{${colons},}\\s*$`).test(lines[i]) || /^:{3,}\s*$/.test(lines[i])) {
        depth--; if (depth === 0) { i++; break; }
      }
      body.push(lines[i]); i++;
    }
    out.push({ label, attrs, body: body.join('\n').trim() });
  }
  return out;
}

function parseAttrs(s) {
  const out = {};
  if (!s) return out;
  const body = s.slice(1, -1);
  const re = /([\w-]+)=("[^"]*"|'[^']*'|[^\s]+)/g; let m;
  while ((m = re.exec(body))) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  return out;
}

// ── blocks → markdown ─────────────────────────────────────────────────────────
export function serialize(blocks) {
  return blocks.map((b) => {
    const md = blockMd(b);
    return (b.align === 'center' || b.align === 'left' || b.align === 'right') ? `:::${b.align}\n${md}\n:::` : md;
  }).join('\n\n');
}
export function blockMd(b) {
    switch (b.type) {
      case 'heading': return `${'#'.repeat(b.level || 2)} ${b.text || ''}`;
      case 'callout': {
        const a = [];
        if (b.icon) a.push(`icon=${b.icon}`);
        if (b.color) a.push(`color="${b.color}"`);
        const attr = a.length ? `{${a.join(' ')}}` : '';
        const label = b.title ? `[${b.title}]` : '';
        return `:::${b.kind || 'tip'}${label}${attr}\n${b.text || ''}\n:::`;
      }
      case 'card': {
        const a = [];
        if (b.title) a.push(`title="${b.title}"`);
        if (b.icon) a.push(`icon=${b.icon}`);
        if (b.href) a.push(`href="${b.href}"`);
        if (b.image) a.push(`image="${b.image}"`);
        if (b.color) a.push(`color="${b.color}"`);
        return `:::card${a.length ? `{${a.join(' ')}}` : ''}\n${b.text || ''}\n:::`;
      }
      case 'image': return `![${b.alt || ''}](${b.url || ''})`;
      case 'code': return `\`\`\`${b.lang || ''}\n${b.code || ''}\n\`\`\``;
      case 'quote': return (b.text || '').split('\n').map((l) => `> ${l}`).join('\n');
      case 'collapsible': return `:::details[${b.summary || 'Details'}]\n${b.text || ''}\n:::`;
      case 'steps': {
        // Four colons outside, three inside — remark-directive matches by colon count, so a
        // `:::` within a `:::` closes the parent. Writing it correctly here is what stops the
        // visual editor producing markdown its own preview cannot render.
        const a = [];
        if (b.marker && b.marker !== '1') a.push(`type=${b.marker}`);
        if (b.color) a.push(`color="${b.color}"`);
        if (b.orientation === 'horizontal') a.push('orientation=horizontal');
        // Per step, not just per list: the renderer reads `icon`, `color` and `status` on a
        // single `:::step`, and a procedure where one step is the destructive one wants to say
        // so on that step.
        const inner = (b.steps || []).map((st) => {
          const sa = [];
          if (st.icon) sa.push(`icon=${st.icon}`);
          if (st.color) sa.push(`color="${st.color}"`);
          if (st.status) sa.push(`status=${st.status}`);
          return `:::step[${st.title || ''}]${sa.length ? `{${sa.join(' ')}}` : ''}\n${st.text || ''}\n:::`;
        }).join('\n');
        return `::::steps${b.title ? `[${b.title}]` : ''}${a.length ? `{${a.join(' ')}}` : ''}\n${inner}\n::::`;
      }
      case 'roadmap': {
        const a = b.orientation === 'horizontal' ? '{orientation=horizontal}' : '';
        return `:::roadmap${b.title ? `[${b.title}]` : ''}${a}\n\`\`\`json\n${b.json || '{}'}\n\`\`\`\n:::`;
      }
      case 'columns': return `::::columns\n:::column\n${b.left || ''}\n:::\n:::column\n${b.right || ''}\n:::\n::::`;
      case 'align': return `:::${b.align || 'center'}\n${b.text || ''}\n:::`;
      case 'file': {
        const a = [];
        if (b.href) a.push(`href="${b.href}"`);
        if (b.size) a.push(`size="${b.size}"`);
        return `:::file[${b.name || 'file'}]${a.length ? `{${a.join(' ')}}` : ''}\n:::`;
      }
      case 'table': {
        const rows = (b.rows && b.rows.length ? b.rows : [['', '']]).map((r) => r.map((c) => String(c || '').replace(/\|/g, '\\|')));
        const cols = Math.max(1, ...rows.map((r) => r.length));
        const pad = (r) => { const c = [...r]; while (c.length < cols) c.push(''); return c; };
        const head = pad(rows[0]);
        const sep = new Array(cols).fill('---');
        const bodyRows = rows.slice(1).map(pad);
        return [head, sep, ...bodyRows].map((r) => `| ${r.join(' | ')} |`).join('\n');
      }
      case 'tags': return (b.tags && b.tags.length ? b.tags : [{ text: 'Tag', color: '' }])
        .map((tg) => `:badge[${(tg.text || 'Tag').replace(/[[\]]/g, '')}]${tg.color ? `{color="${tg.color}"}` : ''}`).join(' ');
      case 'tabs': {
        // Four colons outside, three inside — same rule as steps and columns: remark-directive
        // matches by colon count, so a `:::` inside a `:::` closes the parent.
        const inner = (b.tabs || []).map((tb) => `:::tab{title="${String(tb.title || '').replace(/"/g, '')}"}\n${tb.text || ''}\n:::`).join('\n');
        return `::::tabs\n${inner}\n::::`;
      }
      case 'cards': {
        const inner = (b.cards || []).map((cd) => {
          const a = [];
          if (cd.title) a.push(`title="${String(cd.title).replace(/"/g, '')}"`);
          if (cd.icon) a.push(`icon=${cd.icon}`);
          if (cd.href) a.push(`href="${cd.href}"`);
          if (cd.image) a.push(`image="${cd.image}"`);
          if (cd.color) a.push(`color="${cd.color}"`);
          return `:::card${a.length ? `{${a.join(' ')}}` : ''}\n${cd.text || ''}\n:::`;
        }).join('\n');
        return `::::cards\n${inner}\n::::`;
      }
      case 'buttons': return (b.items || []).map((it) => {
        const a = [];
        if (it.brand) a.push(`brand=${it.brand}`);
        else if (it.color) a.push(`color=${it.color}`);
        if (it.size && it.size !== 'md') a.push(`size=${it.size}`);
        if (it.outline) a.push('outline');
        if (it.href) a.push(`href=${it.href}`);
        return `:button[${String(it.label || 'Button').replace(/[[\]]/g, '')}]${a.length ? `{${a.join(' ')}}` : ''}`;
      }).join(' ');
      case 'math': return `$$${b.tex || ''}$$`;
      case 'replay': {
        const a = [];
        if (b.src) a.push(`src="${b.src}"`);
        if (b.title) a.push(`title="${String(b.title).replace(/"/g, '')}"`);
        if (b.autoplay) a.push('autoplay');
        if (b.loop) a.push('loop');
        return `:::replay${a.length ? `{${a.join(' ')}}` : ''}\n:::`;
      }
      case 'divider': return '---';
      default: return b.text || '';
    }
}
