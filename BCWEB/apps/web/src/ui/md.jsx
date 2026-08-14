import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import rehypeRaw from 'rehype-raw';
// NOT a static import. rehype-highlight drags in highlight.js and a grammar per language
// — 180kB raw, 55kB gzipped — and a static import put all of it in the ENTRY chunk, so
// every visitor downloaded a syntax highlighter to read pages that may contain no code.
// Splitting it into its own chunk was not enough on its own: the entry still imported it
// statically, so Vite emitted a <link modulepreload> and the browser fetched it anyway.
//
// Loaded on first markdown render instead. The document renders immediately WITHOUT
// highlighting and re-renders with it a moment later — code blocks are styled by CSS
// either way, so the change is colour appearing, not layout moving.
let _rehypeHighlight = null;
let _highlightPromise = null;
function useRehypeHighlight() {
  const [, force] = useState(0);
  useEffect(() => {
    if (_rehypeHighlight) return;
    _highlightPromise ??= import('rehype-highlight')
      .then((m) => { _rehypeHighlight = m.default; })
      .catch(() => { _rehypeHighlight = false; }); // offline / blocked: plain code, not a crash
    let alive = true;
    _highlightPromise.then(() => { if (alive) force((n) => n + 1); });
    return () => { alive = false; };
  }, []);
  return _rehypeHighlight || null;
}
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { visit } from 'unist-util-visit';
import { ProgressTracker } from '../hero/progress-tracker.jsx';
import { useI18n } from '../i18n.jsx';

// Sanitisation schema (CWE-79): author-written raw HTML in blog/doc bodies is stripped
// of anything executable (scripts, on* handlers, javascript: URLs) by extending the
// safe default schema to ALSO permit exactly what our doc-block system emits — no more.
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...new Set([...(defaultSchema.tagNames || []),
    'div', 'span', 'section', 'details', 'summary', 'nav', 'figure', 'figcaption',
    'video', 'audio', 'source', 'iframe', 'kbd', 'doc-icon', 'doc-kbd', 'doc-comment', 'doc-roadmap', 'doc-replay'])],
  attributes: {
    ...defaultSchema.attributes,
    // data-* here are hast (camelCased) property names — rehype-sanitize matches those,
    // so `data-comment` in the source must be allowed as `dataComment` (the DocComment
    // component reads both forms). Without this the whole <doc-comment> was stripped.
    '*': [...new Set([...((defaultSchema.attributes || {})['*'] || []), 'className', 'id', 'style', 'dataName', 'dataKeys', 'dataComment', 'dataLink', 'dataImg', 'dataVideo', 'dataSrc', 'dataJson', 'dataTitle'])],
    a: [...new Set([...(((defaultSchema.attributes || {}).a) || []), 'href', 'target', 'rel', 'download'])],
    img: [...new Set([...(((defaultSchema.attributes || {}).img) || []), 'src', 'alt', 'loading', 'className'])],
    video: ['src', 'controls', 'poster', 'className', 'style', 'loading'],
    audio: ['src', 'controls', 'className'],
    source: ['src', 'type'],
    iframe: ['src', 'allow', 'allowFullScreen', 'frameBorder', 'loading', 'className'],
    'doc-icon': ['className', 'dataName'],
    'doc-kbd': ['className', 'dataKeys'],
    'doc-comment': ['className', 'dataComment', 'dataLink', 'dataImg', 'dataVideo'],
    'doc-roadmap': ['className', 'dataSrc', 'dataJson', 'dataTitle', 'dataOrientation'],
    'doc-replay': ['className', 'dataSrc', 'dataTitle', 'dataAutoplay', 'dataLoop'],
  },
};

// After sanitising, drop any iframe whose src isn't YouTube — only embeds we vouch for
// (the docs guide) survive; an author can't smuggle an arbitrary/phishing frame.
function rehypeIframeAllowlist() {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'iframe' || !parent) return;
      const src = String(node.properties?.src || '');
      if (!/^https:\/\/(www\.)?youtube(-nocookie)?\.com\//i.test(src)) { parent.children.splice(index, 1); return index; }
    });
  };
}
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import {
  Info, Lightbulb, AlertTriangle, Flame, CheckCircle2, BookOpen, Star, Rocket, Zap, Heart,
  Shield, Lock, Key, Download, Upload, Settings, Terminal, Code2, Package, Globe, Server,
  Database, Cpu, Bell, Users, User, Folder, File, Link2, ExternalLink, Play, Puzzle,
  Palette, Wrench, GitBranch, Bug, Sparkles, Clock, Hash,
  FileArchive, FileText, FileImage, FileVideo, FileAudio, FileCode, FileDown,
  Pause, RotateCcw, Maximize2, PlayCircle,
} from 'lucide-react';

// Shared markdown renderer. On top of GFM (tables, task lists, strikethrough) and
// raw HTML, this adds a GitBook-style block system driven by remark-directive:
//   :::note / :::tip / :::warning / :::danger / :::info / :::success[Title]  → callouts
//   :::details[Summary] … :::                                                → collapsibles
//   :::card{title=… href=… image=… video=… color=… icon=…} … :::            → cards
//   :::cards … :::                                                            → card grid
//   :::steps → :::step[Title] … :::                                           → numbered steps
//   :::columns → :::column … :::                                              → responsive columns
//   :icon[name]   :kbd[Ctrl+S]                                                → inline icon / shortcut
//   ::toc                                                                     → auto table of contents
// plus per-heading anchors, and syntax-highlighted ``` code blocks.

const ICONS = {
  info: Info, lightbulb: Lightbulb, tip: Lightbulb, alert: AlertTriangle, warning: AlertTriangle,
  fire: Flame, danger: Flame, check: CheckCircle2, success: CheckCircle2, book: BookOpen, star: Star,
  rocket: Rocket, zap: Zap, heart: Heart, shield: Shield, lock: Lock, key: Key, download: Download,
  upload: Upload, settings: Settings, terminal: Terminal, code: Code2, package: Package, globe: Globe,
  server: Server, database: Database, cpu: Cpu, bell: Bell, users: Users, user: User, folder: Folder,
  file: File, link: Link2, external: ExternalLink, play: Play, plugin: Puzzle, palette: Palette,
  wrench: Wrench, git: GitBranch, bug: Bug, sparkles: Sparkles, clock: Clock, hash: Hash,
  'thumbs-up': ThumbsUp, 'thumbs-down': ThumbsDown,
  'file-archive': FileArchive, 'file-text': FileText, 'file-image': FileImage, 'file-video': FileVideo,
  'file-audio': FileAudio, 'file-code': FileCode, 'file-download': FileDown,
};

// Map a filename/URL to the most fitting lucide file icon (falls back to download).
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

const CALLOUTS = {
  note: 'info', info: 'info', hint: 'tip', tip: 'tip', success: 'success', check: 'success',
  warning: 'warning', caution: 'warning', important: 'warning', danger: 'danger', error: 'danger',
};
// Default lucide icon + fallback title per callout kind. Custom callouts
// (`:::callout{icon=… color=…}[Title]`) pick their own icon/colour.
const CALLOUT_ICON = { info: 'info', tip: 'tip', success: 'success', warning: 'warning', danger: 'danger', custom: 'info' };
const CALLOUT_LABEL = { info: 'Note', tip: 'Tip', success: 'Success', warning: 'Warning', danger: 'Danger', custom: 'Note' };
// Build an inline lucide-icon element node (rendered by the DocIcon component).
const iconNode = (nm) => ({ type: 'emphasis', data: { hName: 'doc-icon', hProperties: { className: ['doc-icon'], 'data-name': nm } }, children: [] });

// [NEW] [FIXED] … → coloured chips (EN + FR spellings) — kept for update-note parity.
const BADGES = {
  NEW: 'new', NOUVEAU: 'new', FIXED: 'fixed', 'FIXÉ': 'fixed', IMPROVED: 'improved', 'AMÉLIORÉ': 'improved',
  REFINE: 'refine', RAFFINEMENT: 'refine', VISUAL: 'visual', VISUEL: 'visual', MAJOR: 'major', MAJEUR: 'major',
};
const ALERTS = {
  NOTE: 'note', REMARQUE: 'note', TIP: 'tip', ASTUCE: 'tip', IMPORTANT: 'important',
  WARNING: 'warning', AVERTISSEMENT: 'warning', CAUTION: 'caution', ATTENTION: 'caution',
};
const ALERT_TITLE = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' };

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function nodeText(n) { if (!n) return ''; if (typeof n.value === 'string') return n.value; return (n.children || []).map(nodeText).join(''); }
function slugify(s) { return String(s).toLowerCase().trim().replace(/[^\wÀ-ɏ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section'; }

export function preprocessMd(md) {
  let s = md || '';
  // GitHub-style alerts: a run of blockquote lines whose first line is [!TYPE].
  s = s.replace(/(^|\n)((?:[ \t]*>[^\n]*(?:\n|$))+)/g, (block, lead, quote) => {
    const lines = quote.replace(/\n$/, '').split('\n').map((l) => l.replace(/^[ \t]*>[ \t]?/, ''));
    const m = lines[0].match(/^\[!(\w+)\]\s*$/i);
    if (!m) return block;
    const type = ALERTS[m[1].toUpperCase()] || 'note';
    const body = lines.slice(1).join('<br>');
    return `${lead}<div class="md-alert md-alert-${type}"><div class="md-alert-title">${ALERT_TITLE[type]}</div><div class="md-alert-body">${body}</div></div>\n`;
  });
  // Change badges. Skip fenced/inline code so `[NEW]` inside code stays literal.
  const parts = s.split(/(```[\s\S]*?```|`[^`]*`)/g);
  s = parts.map((part, i) => (i % 2 === 1 ? part : part.replace(/\[([A-ZÀ-Ÿ]+)\]/g, (mm, w) =>
    BADGES[w] ? `<span class="md-badge md-badge-${BADGES[w]}">${esc(w)}</span>` : mm))).join('');
  return s;
}

// remark transform: directives → styled hast elements, heading anchors, ::toc.
// Step markers. Four alphabets, because a procedure, a set of options and a list of phases
// are not the same shape and reusing "1." for all three is how a document stops being
// scannable. Anything past the alphabet falls back to the number rather than wrapping round
// to A again, which would silently duplicate a marker.
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];
function stepMarker(kind, n) {
  if (kind === 'a' || kind === 'alpha') return n <= 26 ? String.fromCharCode(64 + n) : String(n);
  if (kind === 'i' || kind === 'roman') return ROMAN[n - 1] || String(n);
  if (kind === 'dot' || kind === 'none' || kind === 'bullet') return '\u2022';
  return String(n);
}

function remarkDocBlocks() {
  return (tree) => {
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
        setEl('div', ['doc-steps', vertical ? 'doc-steps-v' : 'doc-steps-h']);
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
        setEl('div', ['doc-step', ...(done ? ['doc-step-done'] : [])]);
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
      } else if (name === 'roadmap' || name === 'progress') {
        // Progress / roadmap tracker. Two sources:
        //   remote → :::roadmap{src="https://site/progress.json" title="Roadmap"}
        //   static → :::roadmap{title="Roadmap"} with a ```json … ``` block inside
        // Both render the same customisable tracker (categories, %, meters, ETA).
        const code = (node.children || []).find((c) => c.type === 'code');
        const inlineJson = code ? String(code.value || '') : '';
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
        setEl('doc-replay', ['doc-replay'], {
          'data-src': attrs.src || attrs.href || '',
          'data-title': labelText || attrs.title || '',
          'data-autoplay': (attrs.autoplay === '' || attrs.autoplay === 'true' || attrs.autoplay === true) ? 'true' : '',
          'data-loop': (attrs.loop === '' || attrs.loop === 'true' || attrs.loop === true) ? 'true' : '',
        });
        node.children = [];
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
export const ICON_NAMES = Object.keys(ICONS);
// A brand icon (Simple Icons) is written `simple:<slug>` / `si:<slug>` and rendered
// from the Simple Icons CDN; everything else is a lucide icon from ICONS.
function simpleSlug(n) { const m = String(n || '').toLowerCase().match(/^(?:simple|si):(.+)$/); return m ? m[1].replace(/[^a-z0-9-]/g, '') : null; }

// Any lucide icon not in the curated ICONS map still renders — as a CSS-mask over
// the lucide-static CDN svg, so it inherits currentColor like a real component.
function lucideMask(name, size, className = '') {
  const url = `https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/${name}.svg`;
  return <span aria-hidden className={className} style={{ display: 'inline-block', width: size, height: size, backgroundColor: 'currentColor', WebkitMask: `url(${url}) center / contain no-repeat`, mask: `url(${url}) center / contain no-repeat`, verticalAlign: '-2px' }} />;
}
const isLucideName = (n) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(n);

// A project/showcase icon accepting EITHER an image URL (uploaded svg/png, or a
// logo) OR an icon name (lucide / `simple:brand`). Falls back to `fallback` when
// unset — one field, every source (used by the topbar pill + project header).
export function ShowcaseIcon({ icon, size = 16, className = '', rounded = 4, fallback = null }) {
  if (!icon) return fallback;
  if (/^(https?:|data:|\/)/i.test(icon)) {
    return <img src={icon} alt="" width={size} height={size} className={className} style={{ display: 'inline-block', objectFit: 'contain', borderRadius: rounded }} />;
  }
  return <IconGlyph name={icon} size={size} className={className} />;
}

// Our own project logos, usable anywhere IconGlyph is (topbar, blog, docs, faq) via
// the "app:<key>" name — e.g. app:bmm → /icons/bmm.png, app:bc → the BC logo.
const APP_ICONS = { bmm: '/icons/bmm.png', bsm: '/icons/bsm.png', bi: '/icons/bi.png', installer: '/icons/bi.png', bc: '/logo.png' };
export const APP_ICON_KEYS = Object.keys(APP_ICONS).filter((k) => k !== 'installer');

// Standalone icon glyph by name (used by the icon picker + reaction-style UIs).
export function IconGlyph({ name, size = 18, className = '' }) {
  const app = String(name || '').match(/^app:(.+)$/);
  if (app && APP_ICONS[app[1]]) return <img src={APP_ICONS[app[1]]} width={size + 2} height={size + 2} alt="" className={`rounded-[4px] object-contain ${className}`} style={{ display: 'inline-block' }} />;
  const slug = simpleSlug(name);
  if (slug) return <img src={`https://cdn.simpleicons.org/${slug}`} width={size} height={size} alt="" className={className} style={{ display: 'inline-block' }} />;
  const n = String(name || '').toLowerCase();
  const I = ICONS[n];
  if (I) return <I size={size} className={className} aria-hidden />;
  if (isLucideName(n)) return lucideMask(n, size, className);
  return <Hash size={size} className={className} aria-hidden />;
}

// Inline lucide icon by name (tolerant of hast property key casing).
function DocIcon({ node }) {
  const p = node?.properties || {};
  const name = String(p.dataName || p['data-name'] || p.name || '').toLowerCase();
  const slug = simpleSlug(name);
  if (slug) return <img src={`https://cdn.simpleicons.org/${slug}`} width={16} height={16} alt="" className="doc-icon-svg" style={{ display: 'inline-block', verticalAlign: '-2px' }} />;
  const Ico = ICONS[name];
  if (Ico) return <Ico className="doc-icon-svg" size={16} aria-hidden />;
  if (isLucideName(name)) return lucideMask(name, 16, 'doc-icon-svg');
  return <Hash className="doc-icon-svg" size={16} aria-hidden />;
}
// Keyboard shortcut: "Ctrl+Shift+S" → styled <kbd> keys.
function DocKbd({ node }) {
  const p = node?.properties || {};
  const keys = String(p.dataKeys || p['data-keys'] || '').split(/[+\s]+/).filter(Boolean);
  return <span className="doc-kbd">{keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</span>;
}
// Inline comment/annotation: dashed-underline text that reveals a card (text +
// optional image + link) on hover/focus. Authored via the selection toolbar.
function DocComment({ node, children }) {
  const p = node?.properties || {};
  const text = p.dataComment || p['data-comment'] || '';
  const link = p.dataLink || p['data-link'] || '';
  const img = p.dataImg || p['data-img'] || '';
  const video = p.dataVideo || p['data-video'] || '';
  const [open, setOpen] = useState(false);
  return (
    <span className="doc-comment" tabIndex={0}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen((v) => !v)}>
      {children}
      {open && (text || img || video || link) && (
        <span className="doc-comment-card" onClick={(e) => e.stopPropagation()}>
          {img && <img src={img} alt="" className="doc-comment-img" />}
          {video && <video src={video} controls className="doc-comment-img" />}
          {text && <span className="doc-comment-text">{text}</span>}
          {link && <a href={link} target="_blank" rel="noreferrer" className="doc-comment-link">{link.replace(/^https?:\/\//, '').slice(0, 40)}</a>}
        </span>
      )}
    </span>
  );
}

export function matchesLang(name, lang) {
  const n = (name || '').toLowerCase();
  const other = lang === 'fr' ? '_en' : '_fr';
  if (n.replace(/\.md$/, '').endsWith(other)) return false;
  return true;
}

// Roadmap / progress tracker embedded in blog & docs. Data comes from a remote
// `.json` (data-src, fetched client-side) or an inline JSON block (data-json) —
// both render the same customisable ProgressTracker used on the project pages.
function DocRoadmap({ node }) {
  const { lang } = useI18n();
  const p = node?.properties || {};
  const src = p.dataSrc || p['data-src'] || '';
  const rawJson = p.dataJson || p['data-json'] || '';
  const title = p.dataTitle || p['data-title'] || (lang === 'fr' ? 'Feuille de route' : 'Roadmap');
  const inline = useMemo(() => {
    if (!rawJson) return null;
    try { return { data: JSON.parse(rawJson) }; } catch { return { error: true }; }
  }, [rawJson]);
  const [remote, setRemote] = useState(null);
  const [fetchErr, setFetchErr] = useState(false);
  useEffect(() => {
    if (!src) return;
    let alive = true; setFetchErr(false);
    fetch(src).then((r) => { if (!r.ok) throw new Error('http'); return r.json(); })
      .then((j) => { if (alive) setRemote(j); })
      .catch(() => { if (alive) setFetchErr(true); });
    return () => { alive = false; };
  }, [src]);
  const data = remote ?? inline?.data ?? null;
  if (data) return <div className="doc-roadmap">{<ProgressTracker data={data} title={title} lang={lang} />}</div>;
  const msg = fetchErr ? (lang === 'fr' ? 'Impossible de charger la feuille de route.' : 'Could not load the roadmap.')
    : inline?.error ? (lang === 'fr' ? 'JSON de feuille de route invalide.' : 'Invalid roadmap JSON.')
    : src ? (lang === 'fr' ? 'Chargement…' : 'Loading…')
    : (lang === 'fr' ? 'Feuille de route vide — fournis un « src » ou un bloc JSON.' : 'Empty roadmap — provide a "src" or a JSON block.');
  return <div className="doc-roadmap doc-roadmap-empty text-sm text-[var(--faint)] rounded-xl border border-dashed border-[var(--line)] p-4">{msg}</div>;
}

// Inline BMM session replay (rrweb). Authors embed `:::replay{src="…/foo.bmmreplay"}`.
// The .bmmreplay is JSON `{ bmmReplay, app, durationMs, events:[…] }` (BMM's Session
// recorder export) OR a bare rrweb events array — DocReplay accepts both. rrweb + the
// (large) recording are lazy-loaded only when the user hits Play, so a page full of
// replays costs nothing until watched. Controls: play/pause, restart, seek, speed,
// fullscreen. Playback advances via requestAnimationFrame → a hidden/background tab
// throttles it (rrweb limitation, not a bug); it runs normally on a visible tab.
const fmtTime = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function DocReplay({ node }) {
  const { lang } = useI18n();
  const p = node?.properties || {};
  const src = p.dataSrc || p['data-src'] || '';
  const title = p.dataTitle || p['data-title'] || '';
  const autoplay = (p.dataAutoplay || p['data-autoplay']) === 'true';
  const loop = (p.dataLoop || p['data-loop']) === 'true';
  const wrap = useRef(null);
  const stage = useRef(null);
  const replayerRef = useRef(null);
  const rafRef = useRef(0);
  const [started, setStarted] = useState(autoplay);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [dur, setDur] = useState(0);
  const [cur, setCur] = useState(0);

  const tr = (fr, en) => (lang === 'fr' ? fr : en);

  // Build the Replayer once the user opts in (or autoplay). rrweb is code-split.
  useEffect(() => {
    if (!started || !src) return undefined;
    let cancelled = false, ro;
    setStatus('loading');
    (async () => {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error('fetch');
        const doc = await res.json();
        const events = Array.isArray(doc) ? doc : (doc.events || []);
        if (!Array.isArray(events) || events.length < 2) throw new Error('empty');
        const [{ Replayer }] = await Promise.all([import('rrweb'), import('rrweb/dist/style.css')]);
        if (cancelled || !stage.current) return;
        const meta = events.find((e) => e.type === 4)?.data || { width: 1480, height: 960 };
        // A Replay-Studio recording can carry a `regions` timeline (the moving capture
        // frame); when present we crop the viewport to the active region and follow it.
        const regs = (Array.isArray(doc.regions) ? doc.regions : []).filter((r) => r && r.rect && r.rect.w).sort((a, b) => a.t - b.t);
        const hasRegions = regs.length > 0;
        const rectAt = (t) => { let r = { x: 0, y: 0, w: meta.width, h: meta.height }; for (const k of regs) { if (k.t <= t) r = k.rect; else break; } return r; };
        const replayer = new Replayer(events, { root: stage.current, speed: 1, skipInactive: true, mouseTail: false, showWarning: false, showDebug: false, useVirtualDom: false });
        replayerRef.current = replayer;
        const total = replayer.getMetaData?.().totalTime || doc.durationMs || 0;
        setDur(total);
        const fit = (t) => {
          const w = wrap.current?.clientWidth || 760;
          const rect = hasRegions ? rectAt(t ?? (replayer.getCurrentTime?.() || 0)) : { x: 0, y: 0, w: meta.width, h: meta.height };
          const scale = Math.min(1, w / rect.w);
          const inner = stage.current?.querySelector('.replayer-wrapper');
          if (inner) { inner.style.transform = `translate(${-rect.x * scale}px,${-rect.y * scale}px) scale(${scale})`; inner.style.transformOrigin = 'top left'; if (hasRegions) inner.style.transition = 'transform .35s ease'; }
          if (stage.current) stage.current.style.height = `${rect.h * scale}px`;
        };
        fit();
        ro = new ResizeObserver(() => fit()); if (wrap.current) ro.observe(wrap.current);
        replayer.on('finish', () => {
          if (loop) { try { replayer.play(0); } catch { /* ignore */ } }
          else { setPlaying(false); cancelAnimationFrame(rafRef.current); }
        });
        // Poll current time for the seek bar, and follow the capture frame (re-fit only when
        // the active region changes so the CSS transition animates the move).
        let lastIdx = -2;
        const tick = () => {
          let t = 0; try { t = replayer.getCurrentTime?.() ?? 0; setCur(t); } catch { /* ignore */ }
          if (hasRegions) { let i = -1; for (let k = 0; k < regs.length; k++) { if (regs[k].t <= t) i = k; else break; } if (i !== lastIdx) { lastIdx = i; fit(t); } }
          rafRef.current = requestAnimationFrame(tick);
        };
        replayer.play(0); setPlaying(true); setStatus('ready'); rafRef.current = requestAnimationFrame(tick);
      } catch { if (!cancelled) setStatus('error'); }
    })();
    return () => { cancelled = true; cancelAnimationFrame(rafRef.current); try { ro?.disconnect(); } catch { /* ignore */ } try { replayerRef.current?.pause?.(); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, src]);

  const toggle = () => {
    const r = replayerRef.current; if (!r) return;
    if (playing) { r.pause(); setPlaying(false); cancelAnimationFrame(rafRef.current); }
    else { const at = cur >= dur - 50 ? 0 : cur; r.play(at); setPlaying(true); const tick = () => { try { setCur(r.getCurrentTime?.() ?? 0); } catch { /* ignore */ } rafRef.current = requestAnimationFrame(tick); }; rafRef.current = requestAnimationFrame(tick); }
  };
  const restart = () => { const r = replayerRef.current; if (!r) return; r.play(0); setPlaying(true); if (!rafRef.current) { const tick = () => { try { setCur(r.getCurrentTime?.() ?? 0); } catch { /* ignore */ } rafRef.current = requestAnimationFrame(tick); }; rafRef.current = requestAnimationFrame(tick); } };
  const seek = (e) => { const r = replayerRef.current; if (!r || !dur) return; const to = Number(e.target.value); setCur(to); if (playing) r.play(to); else r.pause(to); };
  const changeSpeed = () => { const next = speed === 1 ? 2 : speed === 2 ? 4 : 1; setSpeed(next); try { replayerRef.current?.setConfig?.({ speed: next }); } catch { /* ignore */ } };
  const fullscreen = () => { const el = wrap.current; if (!el) return; if (document.fullscreenElement) document.exitFullscreen?.(); else el.requestFullscreen?.(); };

  if (!src) return <div className="doc-replay doc-replay-empty text-sm text-[var(--faint)] rounded-xl border border-dashed border-[var(--line)] p-4">{tr('Replay vide — fournis un « src » vers un fichier .bmmreplay.', 'Empty replay — provide a "src" to a .bmmreplay file.')}</div>;

  return (
    <figure className="doc-replay not-prose my-4 rounded-2xl overflow-hidden border border-[var(--line)] bg-[var(--bg-solid)]" style={{ boxShadow: 'var(--shadow)' }}>
      {title && <figcaption className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b border-[var(--line)] bg-[var(--surface-2)]"><PlayCircle size={15} className="text-[var(--primary-2)]" /> {title}</figcaption>}
      <div ref={wrap} className="relative bg-black" style={{ minHeight: 200 }}>
        <div ref={stage} style={{ position: 'relative', width: '100%' }} />
        {!started && (
          <button type="button" onClick={() => setStarted(true)} className="absolute inset-0 grid place-items-center bg-black/50 hover:bg-black/40 transition group" aria-label={tr('Lire le replay', 'Play replay')}>
            <span className="flex flex-col items-center gap-2 text-white">
              <span className="w-16 h-16 rounded-full bg-[var(--primary)]/90 grid place-items-center group-hover:scale-105 transition-transform"><Play size={28} className="translate-x-0.5" fill="currentColor" /></span>
              <span className="text-xs opacity-90">{tr('Lire la session', 'Play session')}</span>
            </span>
          </button>
        )}
        {status === 'loading' && <div className="absolute inset-0 grid place-items-center text-sm text-white/80">{tr('Chargement du replay…', 'Loading replay…')}</div>}
        {status === 'error' && <div className="absolute inset-0 grid place-items-center text-sm text-error px-4 text-center">{tr('Impossible de charger ce replay.', 'Could not load this replay.')}</div>}
      </div>
      {status === 'ready' && (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-[var(--line)] bg-[var(--surface-2)]">
          <button type="button" onClick={toggle} className="shrink-0 text-[var(--text)] hover:text-[var(--primary-2)]" aria-label={playing ? tr('Pause', 'Pause') : tr('Lire', 'Play')}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
          <button type="button" onClick={restart} className="shrink-0 text-[var(--muted)] hover:text-[var(--text)]" aria-label={tr('Recommencer', 'Restart')}><RotateCcw size={15} /></button>
          <span className="text-[11px] tabular-nums text-[var(--faint)] shrink-0 w-9 text-right">{fmtTime(cur)}</span>
          <input type="range" min={0} max={dur || 0} value={Math.min(cur, dur || 0)} onChange={seek} className="flex-1 accent-[var(--primary)] h-1 cursor-pointer" aria-label={tr('Position', 'Seek')} />
          <span className="text-[11px] tabular-nums text-[var(--faint)] shrink-0 w-9">{fmtTime(dur)}</span>
          <button type="button" onClick={changeSpeed} className="shrink-0 text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)] w-7 text-center" aria-label={tr('Vitesse', 'Speed')}>{speed}×</button>
          <button type="button" onClick={fullscreen} className="shrink-0 text-[var(--muted)] hover:text-[var(--text)]" aria-label={tr('Plein écran', 'Fullscreen')}><Maximize2 size={15} /></button>
        </div>
      )}
    </figure>
  );
}

const COMPONENTS = { 'doc-icon': DocIcon, 'doc-kbd': DocKbd, 'doc-comment': DocComment, 'doc-roadmap': DocRoadmap, 'doc-replay': DocReplay };

// Internal link with a GitBook-style hover-preview card (title + category), shown
// only when the href is a known page in `pageMap`.
function MdLink({ pageMap, href, children, ...rest }) {
  const info = href && (pageMap[href] || pageMap[String(href).replace(/#.*$/, '')]);
  const [open, setOpen] = useState(false);
  if (!info) return <a href={href} {...rest}>{children}</a>;
  return (
    <span className="md-linkprev" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <a href={href} {...rest}>{children}</a>
      {open && (
        <span className="md-linkprev-card">
          {info.category && <span className="md-linkprev-cat">{info.category}</span>}
          <span className="md-linkprev-title">{info.title}</span>
          {info.desc && <span className="md-linkprev-desc">{info.desc}</span>}
        </span>
      )}
    </span>
  );
}

export default function Markdown({ children, className = '', pageMap }) {
  const [zoom, setZoom] = useState(null);
  const rehypeHighlight = useRehypeHighlight();
  // Click any non-card image to open it full-screen (lightbox).
  const components = {
    ...COMPONENTS,
    img: ({ node, ...props }) => {
      if (/doc-card-media|doc-comment-img/.test(props.className || '')) return <img loading="lazy" {...props} />;
      return <img loading="lazy" {...props} className={`${props.className || ''} md-zoomable`} onClick={(e) => { e.stopPropagation(); e.preventDefault(); setZoom(props.src); }} />;
    },
    ...(pageMap ? { a: ({ node, ...props }) => <MdLink pageMap={pageMap} {...props} /> } : {}),
  };
  return (
    <div className={`md-body ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkDirective, remarkDocBlocks]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA], rehypeIframeAllowlist,
          ...(rehypeHighlight ? [[rehypeHighlight, { detect: true, ignoreMissing: true }]] : [])]}
        components={components}
      >{preprocessMd(children || '')}</ReactMarkdown>
      {/* Portal to body so the fixed overlay escapes any modal's transform/stacking
          context (e.g. the Edit-history modal's anim-pop) and truly fills the viewport. */}
      {zoom && createPortal(<div className="md-lightbox" onClick={() => setZoom(null)}><img src={zoom} alt="" /></div>, document.body)}
    </div>
  );
}
