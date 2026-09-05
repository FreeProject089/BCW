// B.MD's parser: markdown-with-directives in, an mdast tree the renderer can draw out.
//
// No React here, and that is the point of the seam — this half is testable with a string in
// and a tree out, and the blocks half never has to know how a directive was written.
import { visit } from 'unist-util-visit';
import { safeUrl } from './url.js';
/* kit:emoji:start */
import { replaceEmoji } from './emoji.js';
/* kit:emoji:end */

const FILE_ICON = {
  zip: 'file-archive', rar: 'file-archive', '7z': 'file-archive', tar: 'file-archive', gz: 'file-archive', bmp: 'file-archive', bmmplug: 'file-archive', bmmtheme: 'file-archive', bmp2: 'file-archive',
  png: 'file-image', jpg: 'file-image', jpeg: 'file-image', gif: 'file-image', webp: 'file-image', svg: 'file-image',
  mp4: 'file-video', webm: 'file-video', mov: 'file-video', mkv: 'file-video',
  mp3: 'file-audio', wav: 'file-audio', ogg: 'file-audio', flac: 'file-audio',
  pdf: 'file-text', txt: 'file-text', md: 'file-text', doc: 'file-text', docx: 'file-text',
  js: 'file-code', ts: 'file-code', json: 'file-code', html: 'file-code', css: 'file-code', py: 'file-code', rs: 'file-code', sh: 'file-code',
};
function fileIcon(nameOrUrl) {
  const ext = String(nameOrUrl || '').split(/[?#]/)[0].split('.').pop().toLowerCase();
  return FILE_ICON[ext] || 'file-download';
}

// A button's brand: its colour and its icon, together.
//
// `:button[Watch]{brand=youtube href=…}` rather than a colour and an icon named separately,
// because those two are one decision — a YouTube-red button with a Discord glyph on it is a
// mistake nobody makes on purpose, and asking for both invites it. A `color` still overrides,
// for the button that is not any of these.
//
// The hexes are each service's own published brand colour, so a button reads as the thing it
// leads to at a glance rather than as a link that happens to be coloured.
const BUTTON_BRANDS = {
  youtube: { color: '#ff0033', icon: 'youtube' },
  discord: { color: '#5865f2', icon: 'discord' },
  kofi: { color: '#ff5e5b', icon: 'kofi' },
  github: { color: '#24292f', icon: 'github' },
  twitch: { color: '#9146ff', icon: 'twitch' },
  x: { color: '#000000', icon: 'x' },
  reddit: { color: '#ff4500', icon: 'reddit' },
  telegram: { color: '#26a5e4', icon: 'telegram' },
  // Patreon and Steam are deliberately absent: there is no local mark for either and neither
  // is a lucide name, so they would have drawn a coloured button with a hole where the logo
  // goes. `:button[Support]{color=#f96854 href=…}` still gets the colour without the lie.
};
const BUTTON_SIZES = new Set(['sm', 'md', 'lg']);

const CALLOUTS = {
  note: 'info', info: 'info', hint: 'tip', tip: 'tip', success: 'success', check: 'success',
  warning: 'warning', caution: 'warning', important: 'warning', danger: 'danger', error: 'danger',
};
// Default lucide icon + fallback title per callout kind. Custom callouts
// (`:::callout[Title]{icon=… color=…}`) pick their own icon/colour. The label comes FIRST:
// remark-directive reads `[label]` only immediately after the name, so `{attrs}[Label]` is
// not a directive at all — the whole line renders as literal text.
const CALLOUT_ICON = { info: 'info', tip: 'tip', success: 'success', warning: 'warning', danger: 'danger', custom: 'info' };
const CALLOUT_LABEL = { info: 'Note', tip: 'Tip', success: 'Success', warning: 'Warning', danger: 'Danger', custom: 'Note' };
// Build an inline lucide-icon element node (rendered by the DocIcon component).
// A one-line child element (a title, a label, a value) — the shape every block's header is.
const textEl = (tag, className, text, props = {}) => ({ type: 'paragraph', data: { hName: tag, hProperties: { className: [className], ...props } }, children: [{ type: 'text', value: String(text ?? '') }] });
const EVENT_STATE = { done: 'done', past: 'done', shipped: 'done', now: 'now', current: 'now', active: 'now', next: 'next', planned: 'next', future: 'next', soon: 'next' };
const iconNode = (nm) => ({ type: 'emphasis', data: { hName: 'doc-icon', hProperties: { className: ['doc-icon'], 'data-name': nm } }, children: [] });

function nodeText(n) { if (!n) return ''; if (typeof n.value === 'string') return n.value; return (n.children || []).map(nodeText).join(''); }

/** A heading's id — what the `::toc` links and every `#anchor` are built from. */
export function slugify(s) { return String(s).toLowerCase().trim().replace(/[^\wÀ-ɏ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section'; }

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];
function stepMarker(kind, n) {
  if (kind === 'a' || kind === 'alpha') return n <= 26 ? String.fromCharCode(64 + n) : String(n);
  if (kind === 'i' || kind === 'roman') return ROMAN[n - 1] || String(n);
  if (kind === 'dot' || kind === 'none' || kind === 'bullet') return '\u2022';
  return String(n);
}

// `:::stage` children → the tracker's own `{ categories: [{ name, items }] }` shape.
//
// A stage's state applies to every item under it. Per-item states are deliberately NOT
// invented here: a bullet list is the thing authors already know how to write, and a
// micro-syntax hidden inside list text would be one more rule nobody can see. An author who
// needs per-item percentages still has the JSON block, which is why that path stays.
/* kit:injected:start */
const STAGE_STATE = { done: 'done', complete: 'done', shipped: 'done', progress: 'progress',
  'in-progress': 'progress', doing: 'progress', active: 'progress', planned: 'planned', todo: 'planned', next: 'planned' };
function stagesToJson(node) {
  const stages = (node.children || []).filter((c) => c.type === 'containerDirective'
    && (c.name === 'stage' || c.name === 'phase'));
  if (!stages.length) return '';
  const categories = stages.map((st) => {
    const a = st.attributes || {};
    const status = STAGE_STATE[String(a.state || a.status || '').toLowerCase()] || 'planned';
    // The stage's own [Label], read before the visitor reaches it and strips the node.
    const label = (st.children || []).find((c) => c.data && c.data.directiveLabel);
    // Every list item under the stage, at any depth — a nested list is still a list of work.
    const items = [];
    visit(st, 'listItem', (li) => {
      const text = nodeText(li).trim();
      if (text) items.push({ label: text, status, percent: status === 'done' ? 100 : (parseInt(a.percent, 10) || 0), ...(a.eta ? { eta: String(a.eta) } : {}) });
    });
    return { name: label ? nodeText(label) : (a.title || ''), items };
  }).filter((c) => c.items.length);
  return categories.length ? JSON.stringify({ categories }) : '';
}
/* kit:injected:end */

export function remarkDocBlocks() {
  return (tree) => {
    // Pass 0 — `:rocket:` becomes 🚀.
    //
    // On the mdast TEXT nodes, not on the source string. A string-level replacement would
    // reach inside fenced code blocks, and a document explaining shortcodes is exactly the
    // document that has `:rocket:` inside a code fence. `code` and `inlineCode` are their own
    // node types holding their content in `.value`, so visiting `text` cannot touch them.
    //
    // Before the directive pass reads anything, and after remark-directive has already
    // parsed the real directives out into nodes of their own — so there is no syntax left in
    // a text node for this to damage.
/* kit:emoji:start */
    visit(tree, 'text', (node) => { node.value = replaceEmoji(node.value); });
/* kit:emoji:end */
    const headings = [];
    // Pass 1 — headings get slug ids (for anchors + toc).
    visit(tree, 'heading', (node) => {
      const text = nodeText(node); const id = slugify(text);
      node.data = node.data || {}; node.data.hProperties = { ...(node.data.hProperties || {}), id };
      if (node.depth >= 2 && node.depth <= 3) headings.push({ depth: node.depth, text, id });
    });
    // Pass 2 — directives.
    visit(tree, (node) => {
      if (node.type !== 'containerDirective' && node.type !== 'leafDirective' && node.type !== 'textDirective') return;
      const name = (node.name || '').toLowerCase();
      const attrs = node.attributes || {};
      const data = node.data || (node.data = {});
      const setEl = (tag, className, props = {}) => { data.hName = tag; data.hProperties = { className, ...props }; };
      // label = the [Bracketed] part of the directive
      const labelIdx = (node.children || []).findIndex((c) => c.data && c.data.directiveLabel);
      const labelNode = labelIdx >= 0 ? node.children[labelIdx] : null;
      const labelText = labelNode ? nodeText(labelNode) : '';
      if (labelNode) node.children.splice(labelIdx, 1);

      if (CALLOUTS[name] || name === 'callout' || name === 'custom') {
        const kind = CALLOUTS[name] || 'custom';
        const iconName = (attrs.icon || CALLOUT_ICON[kind] || 'info').toLowerCase();
        const props = {};
        if (attrs.color) props.style = `--c:${attrs.color}`; // custom colour (any kind)
        setEl('div', ['doc-callout', `doc-callout-${kind}`], props);
        node.children.unshift({ type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-callout-title'] } },
          children: [iconNode(iconName), { type: 'text', value: ' ' + (labelText || attrs.title || CALLOUT_LABEL[kind] || 'Note') }] });
      } else if (name === 'details' || name === 'collapse') {
        setEl('details', ['doc-details']);
        node.children.unshift({ type: 'paragraph', data: { hName: 'summary', hProperties: { className: ['doc-details-summary'] } },
          children: [{ type: 'text', value: labelText || attrs.title || 'Details' }] });
      } else if (name === 'cards') {
        setEl('div', ['doc-cards']);
      } else if (name === 'card' || name === 'ref') {
        const href = attrs.href || attrs.link;
        const props = {};
        if (href) { props.href = href; if (/^https?:\/\//.test(href)) { props.target = '_blank'; props.rel = 'noreferrer'; } }
        if (attrs.color) props.style = `--card-accent:${attrs.color}`;
        setEl(href ? 'a' : 'div', ['doc-card'], props);
        const media = [];
        if (attrs.image) media.push({ type: 'paragraph', data: { hName: 'img', hProperties: { src: attrs.image, alt: attrs.title || '', className: ['doc-card-media'] } }, children: [] });
        else if (attrs.video) media.push({ type: 'paragraph', data: { hName: 'video', hProperties: { src: attrs.video, controls: true, className: ['doc-card-media'] } }, children: [] });
        else if (attrs.color) media.push({ type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-card-media', 'doc-card-swatch'], style: `background:${attrs.color}` } }, children: [] });
        const head = [];
        const title = labelText || attrs.title;
        if (title) head.push({ type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-card-title'] } },
          children: [...(attrs.icon ? [iconNode(String(attrs.icon).toLowerCase())] : []), { type: 'text', value: title }] });
        node.children = [...media, { type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-card-body'] } }, children: [...head, ...node.children] }];
      } else if (name === 'steps') {
        // A numbered sequence. `type` picks the marker alphabet — 1/2/3, A/B/C, i/ii/iii or
        // a plain dot — and `start` offsets it, so a procedure split across two blocks can
        // carry on counting instead of restarting at one.
        //
        // Numbering is done HERE rather than in CSS counters: the same tree is rendered to
        // e-mail HTML, where counters do not exist, and one source of numbers means the web
        // and the e-mail can never disagree about which step is which.
        const kind = String(attrs.type || attrs.marker || '1').toLowerCase();
        const start = Math.max(1, parseInt(attrs.start, 10) || 1);
        const vertical = String(attrs.orientation || attrs.dir || 'vertical') !== 'horizontal';
        // One colour drives the marker and the rail, so they cannot drift apart. Set on the
        // block for all of it, or on a single step to pick that one out.
        const stepProps = attrs.color ? { style: `--step:${attrs.color}` } : {};
        setEl('div', ['doc-steps', vertical ? 'doc-steps-v' : 'doc-steps-h'], stepProps);
        if (labelText || attrs.title) {
          node.children.unshift({ type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-steps-title'] } },
            children: [{ type: 'text', value: labelText || attrs.title }] });
        }
        // Stamp each child step with its marker. Only direct `step` children are counted, so
        // a stray paragraph between two steps does not consume a number.
        let n = start;
        for (const child of node.children) {
          if (child.type === 'containerDirective' && (child.name === 'step' || child.name === 'stage')) {
            child.data = child.data || {};
            child.data.stepMarker = stepMarker(kind, n);
            n += 1;
          }
        }
      } else if (name === 'step' || name === 'stage') {
        // A step outside a `steps` block still renders — it just numbers itself, because
        // half a component is worse than a plain paragraph.
        const marker = node.data?.stepMarker || attrs.marker || '•';
        const done = attrs.done === 'true' || attrs.status === 'done';
        setEl('div', ['doc-step', ...(done ? ['doc-step-done'] : [])], attrs.color ? { style: `--step:${attrs.color}` } : {});
        const head = [{ type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-step-marker'], 'aria-hidden': 'true' } },
          children: [{ type: 'text', value: String(marker) }] }];
        const title = labelText || attrs.title;
        const body = [
          ...(title ? [{ type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-step-title'] } },
            children: [...(attrs.icon ? [iconNode(String(attrs.icon).toLowerCase())] : []), { type: 'text', value: title }] }] : []),
          // The step's own children are untouched, which is the whole point: anything the
          // parser understands elsewhere works inside a step, including another directive.
          ...node.children,
        ];
        node.children = [...head, { type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-step-body'] } }, children: body }];
      } else if (name === 'tabs') {
        // `:::tabs` wrapping `:::tab{title="…"}` blocks.
        //
        // The one shape this vocabulary could not express. People wrote the same content three
        // times — Windows, macOS, Linux — stacked down the page, because three headings were
        // the only way to say "pick the one that is yours".
        //
        // A plain element with the panels inside it: no state in the markdown, and the panel
        // that is open lives in one small component below. Content is whatever markdown the
        // block holds, so a tab can carry a code block, an image or a callout like any other.
        setEl('doc-tabs', ['doc-tabs']);
      } else if (name === 'tab') {
        setEl('div', ['doc-tab'], { 'data-title': String(attrs.title || attrs.name || labelText || '').trim() });
      } else if (name === 'schedule' || name === 'hours') {
        // Opening hours, a stream week, a support rota — a set of rows that repeat, stated in
        // ONE timezone.
        //
        // The rows are NOT converted, and that is the correct answer rather than a missing
        // feature. “Monday 09:00 Europe/Paris” is 09:00 in Paris every week of the year; what
        // moves across a DST boundary is how far that is from the reader. Converting each row
        // would produce a number that is right today and wrong in March, with nothing on the
        // page admitting it. So the zone is named and the difference is stated for NOW, said
        // out loud as being for now.
        //
        // `<doc-schedule>` rather than a div: the offset has to be computed in the reader's
        // browser, and a component below owns that.
        setEl('doc-schedule', ['doc-schedule'], {
          'data-tz': String(attrs.tz || attrs.timezone || '').trim(),
          'data-title': String(labelText || attrs.title || '').trim(),
        });
      } else if (name === 'columns' || name === 'row') {
        setEl('div', ['doc-columns']);
      } else if (name === 'column' || name === 'col') {
        setEl('div', ['doc-column']);
      } else if (name === 'center' || name === 'left' || name === 'right') {
        setEl('div', ['doc-align', `doc-align-${name}`]);
      } else if (name === 'file') {
        const href = attrs.href || attrs.url || '#';
        const fname = labelText || attrs.name || attrs.title || 'file';
        setEl('div', ['doc-file']);
        node.children = [
          iconNode(attrs.icon ? String(attrs.icon).toLowerCase() : fileIcon(fname !== 'file' ? fname : href)),
          { type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-file-info'] } }, children: [
            { type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-file-name'] } }, children: [{ type: 'text', value: fname }] },
            ...(attrs.size ? [{ type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-file-size'] } }, children: [{ type: 'text', value: attrs.size }] }] : []),
          ] },
          { type: 'paragraph', data: { hName: 'a', hProperties: { href, download: true, className: ['doc-file-btn'] } }, children: [{ type: 'text', value: 'Download' }] },
          { type: 'paragraph', data: { hName: 'a', hProperties: { href, target: '_blank', rel: 'noreferrer', className: ['doc-file-btn', 'doc-file-btn-ghost'] } }, children: [{ type: 'text', value: 'Open' }] },
        ];
      } else if (name === 'button' || name === 'btn') {
        // One shape, three sizes, any colour — and optionally a logo.
        //
        //   :button[Watch the video]{brand=youtube href=https://…}
        //   :button[Buy]{color=#0a7 size=lg href=/hosting}
        //
        // A button with nowhere to go is a shape that looks pressable and is not, so an
        // absent href makes it a plain span rather than a dead link.
        const brand = BUTTON_BRANDS[String(attrs.brand || '').toLowerCase()];
        const color = attrs.color || brand?.color || '';
        const size = BUTTON_SIZES.has(String(attrs.size)) ? attrs.size : 'md';
        const href = attrs.href || attrs.url || '';
        const cls = ['doc-btn', `doc-btn-${size}`];
        if (attrs.outline != null) cls.push('doc-btn-outline');
        const props = {};
        if (color) props.style = `--btn:${color}`;
        if (href) {
          Object.assign(props, { href });
          // External links open away and carry the usual protection; an in-site path stays
          // in the tab, which is what a link to /hosting is for.
          if (/^https?:\/\//i.test(href)) Object.assign(props, { target: '_blank', rel: 'noreferrer' });
        }
        setEl(href ? 'a' : 'span', cls, props);
        const icon = attrs.icon || brand?.icon;
        if (icon) node.children = [iconNode(String(icon).toLowerCase()), ...node.children];
      } else if (name === 'link') {
        // A link that is a colour rather than the link colour: `:link[read this]{color=#0a7
        // href=/docs/x}`. The href rules are the button's, because they are the same rules.
        const href = attrs.href || attrs.url || '';
        const props = {};
        if (attrs.color) props.style = `--lnk:${attrs.color}`;
        if (href) {
          Object.assign(props, { href });
          if (/^https?:\/\//i.test(href)) Object.assign(props, { target: '_blank', rel: 'noreferrer' });
        }
        setEl(href ? 'a' : 'span', ['doc-link-c'], props);
      } else if (name === 'time' || name === 'at') {
        // A single INSTANT, converted exactly.
        //
        //   :time[2026-09-01T20:00]{tz=Europe/Paris}
        //
        // Exact because the date settles which side of a daylight-saving change it falls on
        // — which is the whole reason a weekly `:::schedule` row is NOT converted.
        // `nodeText(node)`, NOT `labelText`. `directiveLabel` is set by remark-directive only
        // on the `[label]` of a LEAF or CONTAINER directive; in `:time[…]` — a TEXT directive
        // — the brackets ARE the children and nothing is marked as a label. Reading labelText
        // gave an empty string, and the line below then wiped the children that held the
        // answer: an empty <doc-time>, which the component renders as null. The directive
        // produced NOTHING — no error, no fallback, a sentence with a gap in it.
        //
        // `:icon` and `:kbd` two branches below have always read it this way.
        setEl('doc-time', ['doc-time'], {
          'data-at': String(nodeText(node) || attrs.at || '').trim(),
          'data-tz': String(attrs.tz || attrs.timezone || '').trim(),
          'data-format': String(attrs.format || '').trim(),
        });
        node.children = [];
      } else if (name === 'badge' || name === 'tag') {
        // Inline coloured chip/tag: `:badge[Label]{color=#hex}`.
        const props = {};
        if (attrs.color) props.style = `--badge:${attrs.color}`;
        setEl('span', ['doc-badge'], props); // children (the label) are kept
      } else if (name === 'icon') {
        setEl('doc-icon', ['doc-icon'], { 'data-name': (nodeText(node) || attrs.name || '').trim() });
        node.children = [];
      } else if (name === 'kbd') {
        setEl('doc-kbd', ['doc-kbd'], { 'data-keys': (nodeText(node) || '').trim() });
        node.children = [];
/* kit:injected:start */
      } else if (name === 'roadmap' || name === 'progress') {
        // Progress / roadmap tracker. Two sources:
        //   remote → :::roadmap{src="https://site/progress.json" title="Roadmap"}
        //   static → :::roadmap{title="Roadmap"} with a ```json … ``` block inside
        // Both render the same customisable tracker (categories, %, meters, ETA).
        const code = (node.children || []).find((c) => c.type === 'code');
        // Third source, and the one an author reaches for first: `:::stage` children.
        //   :::roadmap[Where we are]
        //   :::stage[Shipped]{state=done}
        //   - Grid questions
        //   :::
        //
        // Before this, those children were dropped on the floor by the `children = []` below
        // and the block rendered "Empty roadmap — provide a src or a JSON block" while the
        // stages sat right there in the source. Writing a roadmap should not require hand-
        // authoring the tracker's JSON.
        const inlineJson = code ? String(code.value || '') : stagesToJson(node);
        // `orientation=horizontal` lays the phases along a track instead of down a column.
        // An option on the block that exists rather than a second roadmap directive: two
        // roadmaps would be two things to keep in step, and the data is identical.
        setEl('doc-roadmap', ['doc-roadmap'], {
          'data-src': attrs.src || attrs.href || '',
          'data-json': inlineJson,
          'data-title': labelText || attrs.title || '',
          'data-orientation': String(attrs.orientation || attrs.dir || 'vertical') === 'horizontal' ? 'horizontal' : 'vertical',
        });
        node.children = [];
      } else if (name === 'replay' || name === 'bmmreplay') {
        // Inline BMM session replay (rrweb). `src` points at a .bmmreplay JSON file
        //   :::replay{src="/api/assets/demo.bmmreplay" title="Installing a plugin"}
        //   :::replay{src="…" autoplay loop}
        // Rendered by DocReplay with play/pause/seek/speed/fullscreen controls.
        // `labelText` OR the node's text: the container form `:::replay[Title]` marks a
        // label, the inline form `:replay[Title]` does not — the brackets are simply its
        // children. Reading only the first silently dropped the title in the second, and
        // the player then showed its default as though none had been given.
        setEl('doc-replay', ['doc-replay'], {
          'data-src': attrs.src || attrs.href || '',
          'data-title': labelText || nodeText(node) || attrs.title || '',
          'data-autoplay': (attrs.autoplay === '' || attrs.autoplay === 'true' || attrs.autoplay === true) ? 'true' : '',
          'data-loop': (attrs.loop === '' || attrs.loop === 'true' || attrs.loop === true) ? 'true' : '',
        });
        node.children = [];
/* kit:injected:end */
      } else if (name === 'timeline') {
        // A vertical timeline: `:::event` children on a rail, each with a date, a state and
        // a body. What a changelog page, a roadmap in prose or a "how we got here" section
        // wanted and wrote as a bulleted list with dates in bold.
        setEl('div', ['doc-timeline']);
        if (labelText || attrs.title) node.children.unshift(textEl('div', 'doc-timeline-title', labelText || attrs.title));
      } else if (name === 'event' || name === 'moment') {
        //   :::event[Title]{date="2026-09-01" state=done|now|next icon=rocket color=#0a7}
        const state = EVENT_STATE[String(attrs.state || attrs.status || '').toLowerCase()] || 'next';
        setEl('div', ['doc-event', `doc-event-${state}`], attrs.color ? { style: `--ev:${attrs.color}` } : {});
        const title = labelText || attrs.title || '';
        const meta = [];
        if (attrs.date) meta.push(textEl('div', 'doc-event-date', attrs.date));
        if (title) meta.push({ type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-event-title'] } },
          children: [...(attrs.icon ? [iconNode(String(attrs.icon).toLowerCase())] : []), { type: 'text', value: title }] });
        node.children = [
          { type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-event-marker'], 'aria-hidden': 'true' } }, children: [] },
          { type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-event-body'] } }, children: [...meta, ...node.children] },
        ];
      } else if (name === 'compare') {
        // Two sides, labelled: `:::compare{before="v1" after="v2"}` holding `:::before` and
        // `:::after`. The labels can also sit on the sides themselves as [Bracket] titles.
        setEl('div', ['doc-compare']);
        for (const child of node.children) {
          if (child.type === 'containerDirective' && (child.name === 'before' || child.name === 'after') && attrs[child.name]) {
            child.data = child.data || {}; child.data.compareLabel = attrs[child.name];
          }
        }
      } else if (name === 'before' || name === 'after') {
        setEl('div', ['doc-compare-side', `doc-compare-${name}`]);
        node.children.unshift(textEl('div', 'doc-compare-label', labelText || attrs.title || node.data?.compareLabel || (name === 'before' ? 'Before' : 'After')));
      } else if (name === 'stats') {
        setEl('div', ['doc-stats']);
      } else if (name === 'stat' || name === 'kpi') {
        // A number with its label: `:::stat[Downloads]{value="12 400" delta="+8%" icon=download}`.
        // The delta's sign picks the colour; the body, if any, is the small print under it.
        setEl('div', ['doc-stat'], attrs.color ? { style: `--stat:${attrs.color}` } : {});
        const label = labelText || attrs.label || '';
        const value = String(attrs.value ?? '');
        const delta = String(attrs.delta ?? attrs.trend ?? '');
        const dir = delta.startsWith('-') ? 'down' : delta.startsWith('+') ? 'up' : 'flat';
        node.children = [
          ...(attrs.icon ? [{ type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-stat-icon'] } }, children: [iconNode(String(attrs.icon).toLowerCase())] }] : []),
          textEl('div', 'doc-stat-value', value),
          ...(label ? [textEl('div', 'doc-stat-label', label)] : []),
          ...(delta ? [{ type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-stat-delta', `doc-stat-${dir}`] } }, children: [{ type: 'text', value: delta }] }] : []),
          ...(node.children.length ? [{ type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-stat-note'] } }, children: node.children }] : []),
        ];
      } else if (name === 'quote' || name === 'testimonial') {
        // A pull quote with somebody's name under it:
        //   :::quote[Ada Lovelace]{role="Analyst" avatar=/a.png href=https://…}
        setEl('blockquote', ['doc-quote'], attrs.color ? { style: `--q:${attrs.color}` } : {});
        const who = labelText || attrs.author || attrs.by || '';
        const href = attrs.href || attrs.url || '';
        const foot = [];
        if (attrs.avatar) foot.push({ type: 'paragraph', data: { hName: 'img', hProperties: { src: attrs.avatar, alt: '', className: ['doc-quote-avatar'], loading: 'lazy' } }, children: [] });
        if (who || attrs.role) {
          const authorProps = href ? { href, ...(/^https?:\/\//i.test(href) ? { target: '_blank', rel: 'noreferrer' } : {}) } : {};
          foot.push({ type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-quote-who'] } }, children: [
            ...(who ? [textEl(href ? 'a' : 'span', 'doc-quote-author', who, authorProps)] : []),
            ...(attrs.role ? [textEl('span', 'doc-quote-role', attrs.role)] : []),
          ] });
        }
        node.children = [
          { type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-quote-body'] } }, children: node.children },
          ...(foot.length ? [{ type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-quote-foot'] } }, children: foot }] : []),
        ];
      } else if (name === 'hero') {
        // A banner: big title, a line under it, an optional cover, the body (buttons, text).
        //   :::hero[Better Mods Manager]{subtitle="One library, every game" image=/hero.png color=#0a7 align=center}
        const align = ['left', 'center', 'right'].includes(String(attrs.align)) ? attrs.align : 'left';
        setEl('div', ['doc-hero', `doc-hero-${align}`, ...(attrs.image ? ['doc-hero-has-image'] : [])], attrs.color ? { style: `--hero:${attrs.color}` } : {});
        const title = labelText || attrs.title || '';
        node.children = [
          ...(attrs.image ? [{ type: 'paragraph', data: { hName: 'img', hProperties: { src: attrs.image, alt: title, className: ['doc-hero-media'], loading: 'lazy' } }, children: [] }] : []),
          { type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-hero-body'] } }, children: [
            ...(title ? [{ type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-hero-title'] } }, children: [...(attrs.icon ? [iconNode(String(attrs.icon).toLowerCase())] : []), { type: 'text', value: title }] }] : []),
            ...(attrs.subtitle ? [textEl('div', 'doc-hero-sub', attrs.subtitle)] : []),
            ...node.children,
          ] },
        ];
      } else if (name === 'changelog') {
        setEl('div', ['doc-changelog']);
        if (labelText || attrs.title) node.children.unshift(textEl('div', 'doc-changelog-title', labelText || attrs.title));
      } else if (name === 'version' || name === 'release') {
        // One entry of a changelog: `:::version[1.4.0]{date="2026-09-01" label=latest}` — the
        // body is ordinary markdown, and the [NEW] / [FIXED] chips already work inside it.
        setEl('div', ['doc-version', ...(attrs.label ? [`doc-version-${String(attrs.label).toLowerCase().replace(/[^a-z0-9-]/g, '')}`] : [])]);
        const v = labelText || attrs.title || attrs.v || '';
        node.children = [
          { type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-version-head'] } }, children: [
            ...(v ? [textEl('span', 'doc-version-tag', v)] : []),
            ...(attrs.date ? [textEl('span', 'doc-version-date', attrs.date)] : []),
            ...(attrs.label ? [textEl('span', 'doc-badge', attrs.label)] : []),
          ] },
          { type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-version-body'] } }, children: node.children },
        ];
      } else if (name === 'spoiler') {
        // Hidden until clicked — a puzzle's answer, a plot point. A <details>, so it works
        // without a script and the reader's choice is theirs.
        setEl('details', ['doc-spoiler']);
        node.children.unshift(textEl('summary', 'doc-spoiler-summary', labelText || attrs.title || 'Spoiler — click to reveal'));
      } else if (name === 'faq') {
        setEl('div', ['doc-faq']);
        if (labelText || attrs.title) node.children.unshift(textEl('div', 'doc-faq-title', labelText || attrs.title));
      } else if (name === 'q' || name === 'question') {
        // A question that opens on its answer. `{open}` starts it open.
        setEl('details', ['doc-faq-item'], attrs.open != null ? { open: true } : {});
        node.children.unshift(textEl('summary', 'doc-faq-q', labelText || attrs.title || 'Question'));
      } else if (name === 'checklist') {
        // A GFM task list with a header that counts: "3 / 7" and a bar. The ticks come from
        // the list items themselves (`- [x]`), so there is nothing to keep in step.
        let done = 0, total = 0;
        visit(node, 'listItem', (li) => { if (typeof li.checked === 'boolean') { total++; if (li.checked) done++; } });
        const pct = total ? Math.round((done * 100) / total) : 0;
        setEl('div', ['doc-checklist', ...(total && done === total ? ['doc-checklist-done'] : [])], attrs.color ? { style: `--check:${attrs.color}` } : {});
        node.children.unshift({ type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-checklist-head'] } }, children: [
          textEl('div', 'doc-checklist-title', labelText || attrs.title || 'Checklist'),
          textEl('div', 'doc-checklist-count', `${done} / ${total}`),
          { type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-checklist-bar'] } }, children: [
            { type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-checklist-fill'], style: `width:${pct}%` } }, children: [] },
          ] },
        ] });
      } else if (name === 'grid') {
        // A fixed-column grid, for when `:::columns` (equal, auto) is not the shape wanted:
        //   :::grid{cols=3 gap=lg} … any blocks … :::
        const cols = Math.min(6, Math.max(1, parseInt(attrs.cols || attrs.columns, 10) || 3));
        setEl('div', ['doc-grid', ...(attrs.gap ? [`doc-grid-gap-${String(attrs.gap).replace(/[^a-z]/g, '')}`] : [])], { style: `--cols:${cols}` });
      } else if (name === 'meter') {
        // Inline progress: `:meter[60]{label=Done color=#0a7 max=100}` → a small bar + "60 %".
        const raw = nodeText(node) || attrs.value || '0';
        const max = Math.max(1, Number(attrs.max) || 100);
        const val = Math.max(0, Math.min(max, Number(String(raw).replace(/[^0-9.]/g, '')) || 0));
        const pct = Math.round((val * 100) / max);
        setEl('span', ['doc-meter'], { ...(attrs.color ? { style: `--meter:${attrs.color}` } : {}), title: `${attrs.label ? `${attrs.label}: ` : ''}${pct}%` });
        node.children = [
          { type: 'paragraph', data: { hName: 'span', hProperties: { className: ['doc-meter-track'] } }, children: [
            { type: 'paragraph', data: { hName: 'span', hProperties: { className: ['doc-meter-fill'], style: `width:${pct}%` } }, children: [] },
          ] },
          textEl('span', 'doc-meter-text', `${attrs.label ? `${attrs.label} ` : ''}${pct}%`),
        ];
      } else if (name === 'toc') {
        data.hName = 'nav'; data.hProperties = { className: ['doc-toc'] };
        node.children = [{ type: 'paragraph', data: { hName: 'div', hProperties: { className: ['doc-toc-title'] } }, children: [{ type: 'text', value: labelText || 'On this page' }] },
          { type: 'list', ordered: false, data: { hName: 'ul' }, children: headings.map((h) => ({
            type: 'listItem', data: { hName: 'li', hProperties: { className: [`doc-toc-l${h.depth}`] } },
            children: [{ type: 'paragraph', data: { hName: 'a', hProperties: { href: `#${h.id}` } }, children: [{ type: 'text', value: h.text }] }] })) }];
      }
    });
    // Pass 3 — safety net: drop orphan directive-fence lines that remark-directive left
    // behind as raw text (e.g. a block inserted mid-paragraph with no blank line around
    // it, or a mis-nested block), so raw `:::tip[…]` / `:::` colons never show up.
    // 3–4 colons only (container fences `:::`/`::::`), so a 2-colon CSS pseudo-element
    // like `::before` written in prose is never mistaken for a leaked directive.
    const FENCE_LINE = /(^|\n)[ \t]*:{3,4}(?:[a-zA-Z][\w-]*(?:\[[^\]\n]*\])?(?:\{[^}\n]*\})?)?[ \t]*(?=\n|$)/g;
    visit(tree, 'paragraph', (node, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      if (/^:{3,4}(?:[a-zA-Z][\w-]*(?:\[[^\]]*\])?(?:\{[^}]*\})?)?$/.test(nodeText(node).trim())) { parent.children.splice(index, 1); return index; }
    });
    visit(tree, 'text', (node) => {
      node.value = node.value.replace(FENCE_LINE, '$1');
    });
  };
}

// Names of every icon usable in `:icon[…]`, callouts and cards — powers the picker.
