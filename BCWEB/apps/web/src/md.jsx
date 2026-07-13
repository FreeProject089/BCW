import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { visit } from 'unist-util-visit';
import { ProgressTracker } from './progress-tracker.jsx';
import { useI18n } from './i18n.jsx';

// Sanitisation schema (CWE-79): author-written raw HTML in blog/doc bodies is stripped
// of anything executable (scripts, on* handlers, javascript: URLs) by extending the
// safe default schema to ALSO permit exactly what our doc-block system emits — no more.
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...new Set([...(defaultSchema.tagNames || []),
    'div', 'span', 'section', 'details', 'summary', 'nav', 'figure', 'figcaption',
    'video', 'audio', 'source', 'iframe', 'kbd', 'doc-icon', 'doc-kbd', 'doc-comment', 'doc-roadmap'])],
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
    'doc-roadmap': ['className', 'dataSrc', 'dataJson', 'dataTitle'],
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
        setEl('doc-roadmap', ['doc-roadmap'], {
          'data-src': attrs.src || attrs.href || '',
          'data-json': inlineJson,
          'data-title': labelText || attrs.title || '',
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

// Standalone icon glyph by name (used by the icon picker + reaction-style UIs).
export function IconGlyph({ name, size = 18, className = '' }) {
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

const COMPONENTS = { 'doc-icon': DocIcon, 'doc-kbd': DocKbd, 'doc-comment': DocComment, 'doc-roadmap': DocRoadmap };

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
        rehypePlugins={[rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA], rehypeIframeAllowlist, [rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={components}
      >{preprocessMd(children || '')}</ReactMarkdown>
      {/* Portal to body so the fixed overlay escapes any modal's transform/stacking
          context (e.g. the Edit-history modal's anim-pop) and truly fills the viewport. */}
      {zoom && createPortal(<div className="md-lightbox" onClick={() => setZoom(null)}><img src={zoom} alt="" /></div>, document.body)}
    </div>
  );
}
