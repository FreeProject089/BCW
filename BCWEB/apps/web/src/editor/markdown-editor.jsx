// The rich Markdown editor — the one the blog, the docs, the FAQ and the admin guide use.
//
// It lived inside pages/blog.jsx, which made it the blog's editor by accident of location:
// /dev/editor could not have it without importing the whole blog page, and a lazy chunk that
// imports an eager page drags that page along with it (the entry-chunk hoist this repo has
// already been bitten by once). So it is its own module, and every host gets the same editor
// — the mode tabs, the block menu, the selection toolbar, the table builder, the icon, badge
// and keyboard pickers, the .bmd import/export, and the live editable preview.
//
// Nothing in here was blog-specific: the extraction moved two components and changed no
// behaviour. BadgePicker comes with it because MarkdownEditor is its only caller.
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ImagePlus, Youtube, Link2, Video, Bold, Heading, List, Eye, X, Tag as TagIcon, HelpCircle,
  Sparkles, Blocks as BlocksIcon, LayoutGrid, ChevronDown, ListOrdered, Milestone, Columns2,
  Code2, Keyboard, Smile, ListTree, FileDown, AlignCenter, MessageSquare, Table, Quote, Minus,
  AlignLeft, AlignRight, PlayCircle, Upload, Download, Lock, Unlock, Link,
} from 'lucide-react';
import { uploadBlogImage, uploadReplay } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useToast, useDialog, Badge, Button, ColorInput } from '../ui/ui.jsx';
import Markdown from '../ui/md.jsx';
import BmdEditor, { BmdBlockCanvas, BmdLivePreview, SNIPPET_GROUPS, localizeSnippetGroups } from '@bettercommunity/bmd-editor';
import { parseBmdFile, serializeBmdFile } from '@bettercommunity/bmd/editor-blocks';
import TableBuilder from './table-builder.jsx';
import IconPicker from './icon-picker.jsx';
import SelectionToolbar from './selection-toolbar.jsx';
import KbdPicker from './kbd-picker.jsx';


const BADGE_PRESETS = [
  ['New', '#16a34a'], ['Beta', '#2563eb'], ['Updated', '#7c3aed'], ['Fixed', '#0891b2'],
  ['Important', '#d97706'], ['Deprecated', '#dc2626'], ['WIP', '#db2777'], ['Pro', '#ea580c'],
];
const CLASSIC_BADGES = ['NEW', 'FIXED', 'IMPROVED', 'REFINE', 'VISUAL', 'MAJOR'];
const CLASSIC_CLASS = { NEW: 'new', FIXED: 'fixed', IMPROVED: 'improved', REFINE: 'refine', VISUAL: 'visual', MAJOR: 'major' };
const chipStyle = (c) => ({ color: c, background: `color-mix(in srgb, ${c} 15%, transparent)`, borderColor: `color-mix(in srgb, ${c} 42%, transparent)` });
const SAVED_BADGES_KEY = 'bcw-custom-badges';
const readSavedBadges = () => { try { return JSON.parse(localStorage.getItem(SAVED_BADGES_KEY) || '[]'); } catch { return []; } };

/* Badge picker: classic [NEW]-style chips, coloured presets, your saved customs, and
   a colour-picker builder (customs persist in localStorage). Mobile-friendly modal. */
function BadgePicker({ onPick, onPickRaw, onClose }) {
  const { t } = useI18n();
  const [label, setLabel] = useState('Custom');
  const [color, setColor] = useState('#7c3aed');
  const [saved, setSaved] = useState(readSavedBadges);
  const persist = (next) => { setSaved(next); try { localStorage.setItem(SAVED_BADGES_KEY, JSON.stringify(next)); } catch {} };
  const add = (save) => {
    if (!label.trim()) return;
    if (save && !saved.some((s) => s[0] === label.trim())) persist([[label.trim(), color], ...saved].slice(0, 20));
    onPick(label.trim(), color); onClose();
  };
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4" style={{ background: 'rgba(4,5,8,0.55)', backdropFilter: 'blur(3px)' }} onMouseDown={onClose}>
      <div className="card modal-card w-full max-w-md p-0 overflow-hidden anim-pop max-h-[80vh] flex flex-col" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line)] shrink-0"><span className="font-semibold">{t('be.badge.title', 'Insert a badge')}</span><button onClick={onClose} className="text-[var(--faint)] hover:text-[var(--text)]"><X size={16} /></button></div>
        <div className="p-3 overflow-auto">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mb-2">Classic</div>
          <div className="flex flex-wrap gap-2">
            {CLASSIC_BADGES.map((b) => (
              <button key={b} type="button" onClick={() => { onPickRaw?.(`[${b}] `); onClose(); }} className="!p-0 bg-transparent border-0 cursor-pointer">
                <span className={`md-badge md-badge-${CLASSIC_CLASS[b]} !me-0`}>{b}</span>
              </button>
            ))}
          </div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mt-4 mb-2">Presets</div>
          <div className="flex flex-wrap gap-2">
            {BADGE_PRESETS.map(([l, c]) => (
              <button key={l} type="button" onClick={() => { onPick(l, c); onClose(); }}
                className="text-xs font-bold px-2.5 py-1 rounded-full border" style={chipStyle(c)}>{l}</button>
            ))}
          </div>
          {saved.length > 0 && <>
            <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mt-4 mb-2">{t('blg.mybadges', "My badges")}</div>
            <div className="flex flex-wrap gap-2">
              {saved.map(([l, c]) => (
                <span key={l} className="inline-flex items-center gap-1 text-xs font-bold ps-2.5 pe-1 py-1 rounded-full border" style={chipStyle(c)}>
                  <button type="button" onClick={() => { onPick(l, c); onClose(); }} className="bg-transparent border-0 cursor-pointer font-bold" style={{ color: 'inherit' }}>{l}</button>
                  <button type="button" title={t('blg.remove', "Remove")} onClick={() => persist(saved.filter((s) => s[0] !== l))} className="opacity-60 hover:opacity-100"><X size={11} /></button>
                </span>
              ))}
            </div>
          </>}
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mt-4 mb-2">Custom</div>
          <div className="flex items-center gap-2 flex-wrap">
            <ColorInput value={color} onChange={setColor} className="shrink-0" />
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('blg.ph.label', "Label")} className="input !py-1.5 !text-sm flex-1 min-w-[100px]" onKeyDown={(e) => e.key === 'Enter' && add(true)} />
            <span className="text-xs font-bold px-2.5 py-1 rounded-full border" style={chipStyle(color)}>{label || 'Label'}</span>
          </div>
          <div className="flex gap-2 mt-2">
            <Button size="sm" variant="primary" onClick={() => add(true)}>{t('blg.addsave', "Add & save")}</Button>
            <Button size="sm" variant="ghost" onClick={() => add(false)}>{t('blg.addonce', "Add once")}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Reusable rich Markdown editor (toolbar + preview). `full` adds media/badges. ── */
export function MarkdownEditor({ value, onChange, placeholder, minHeight = 220, full = false }) {
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n();
  const ref = useRef(null); const [preview, setPreview] = useState(false);
  // The preview used to be read-only: to fix a word you could SEE was wrong you switched to
  // the source, hunted for the line among the fences, changed it and switched back to check.
  // Unlocked, the rendered page is the editing surface. Locked by default, because a preview
  // is also the thing you show somebody.
  const [pvUnlocked, setPvUnlocked] = useState(false);
  // 'rich' is the editor package (block menu, live preview side by side or as tabs on a phone,
  // link check, outline, export); 'write' the bare textarea with this toolbar; 'visual' the
  // drag-and-drop composer. A document field opens in rich; a short one stays bare.
  const [mode, setMode] = useState(full ? 'rich' : 'write'); // 'rich' | 'write' | 'visual'
  const { lang: uiLang } = useI18n();
  const insert = (text) => {
    const ta = ref.current; const v = value || ''; const at = ta ? ta.selectionStart : v.length;
    const next = v.slice(0, at) + text + v.slice(at); onChange(next);
    setTimeout(() => { if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = at + text.length; } }, 0);
  };
  const pickImage = (cb) => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = async () => { const file = i.files?.[0]; if (!file) return; try { toast.info(t('be.uploading', 'Uploading…')); cb(await uploadBlogImage(file)); } catch { toast.error(t('be.uploadfail', 'Upload failed.')); } }; i.click(); };
  const ytEmbed = async () => { const url = await dialog.prompt({ title: 'YouTube', label: 'Video URL or ID', placeholder: 'https://youtu.be/…' }); if (!url) return; const m = url.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/) || [null, url.trim()]; insert(`\n<div class="yt-embed"><iframe src="https://www.youtube-nocookie.com/embed/${m[1]}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>\n`); };
  const linkEmbed = async () => { const url = await dialog.prompt({ title: 'Link', label: 'URL', placeholder: 'https://…' }); if (!url) return; const txt = await dialog.prompt({ title: 'Link', label: 'Text', defaultValue: url }); insert(`[${txt || url}](${url})`); };
  const videoEmbed = async () => { const url = await dialog.prompt({ title: 'Video', label: 'Video file URL (mp4/webm)', placeholder: 'https://…' }); if (!url) return; insert(`\n<video controls src="${url}" style="width:100%;border-radius:12px"></video>\n`); };
  const tool = (Icon, fn, title) => <button type="button" title={title} onClick={fn} className="btn btn-sm"><Icon size={14} /></button>;
  // .bmd in / out. Import replaces the body with the file's (its front matter is metadata about
  // the FILE, not about this post, so it is read and dropped rather than written into the
  // document); export wraps the current text with the format version.
  const importBmd = () => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = '.bmd,.md,text/markdown,text/plain';
    i.onchange = async () => {
      const f = i.files?.[0]; if (!f) return;
      try { onChange(parseBmdFile(await f.text()).body); toast.success(t('bmdf.imported', 'Loaded {n}.').replace('{n}', f.name)); }
      catch { toast.error(t('bmdf.badfile', 'That file could not be read.')); }
    };
    i.click();
  };
  const exportBmd = () => {
    const blob = new Blob([serializeBmdFile({ meta: { bmd: '1' }, body: value || '' })], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'document.bmd';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  // The site's icon picker, handed to the block canvas as a promise. The package takes a
  // `pickIcon(current) -> Promise<string|null>` rather than importing a picker: it stays
  // dependency-free, and the site keeps ONE picker instead of growing a second one that knows
  // a different set of icons. null = cancelled; '' is a real answer (clear the icon).
  const iconResolve = useRef(null);
  const [canvasIcon, setCanvasIcon] = useState(false);
  const pickIconForCanvas = () => new Promise((resolve) => { iconResolve.current = resolve; setCanvasIcon(true); });
  const closeCanvasIcon = (name) => { setCanvasIcon(false); iconResolve.current?.(name); iconResolve.current = null; };

  const [tableBuilder, setTableBuilder] = useState(false);
  const [blocksOpen, setBlocksOpen] = useState(false);
  const blocksBtnRef = useRef(null); const [blocksPos, setBlocksPos] = useState({ top: 0, left: 0 });
  // Open the Blocks menu as a FIXED overlay anchored under the button — the editor wrapper
  // is overflow-hidden (for its rounded corners), which was clipping an absolute dropdown.
  const openBlocks = () => {
    if (blocksOpen) { setBlocksOpen(false); return; }
    const r = blocksBtnRef.current?.getBoundingClientRect();
    if (r) {
      // It was always placed BELOW the button. In a long editor the toolbar sits low on the
      // screen, so the menu opened past the bottom of the viewport — present, focusable,
      // and invisible. Flip above when there is not enough room below, and clamp the height
      // to whatever side it lands on so it scrolls instead of running off.
      const MENU = 288; // max-h-72
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const flip = below < 200 && above > below;
      setBlocksPos({
        top: flip ? Math.max(8, r.top - Math.min(MENU, above) - 4) : r.bottom + 4,
        left: Math.max(8, Math.min(r.left, window.innerWidth - 224)),
        maxH: Math.max(160, Math.min(MENU, flip ? above : below)),
      });
    }
    setBlocksOpen(true);
  };
  const [iconPick, setIconPick] = useState(false);
  const [badgePick, setBadgePick] = useState(false);
  const [kbdPick, setKbdPick] = useState(false);
  // What THIS site can do that the editor package cannot know about: upload an image or a
  // replay to our storage, and the three pickers. They join the package's own block menu, so
  // there is one Insert menu with everything in it rather than a package menu next to a
  // host menu. `onPick` receives the package's `insert`, which lands text at the caret.
  const hostGroups = [
    { id: 'site', icon: 'upload', label: t('be.grp.site', 'This site'), items: [
      { id: 'upload-image', icon: 'image', label: t('be.upimg', 'Upload an image'), onPick: ({ insert: ins }) => pickImage((u) => ins(`:img[${'${sel|Image}'}]{src=${u} width=640 align=center}`)) },
      { id: 'upload-replay', icon: 'play', label: t('be.replay.upload', 'Session replay (upload .bmmreplay)'), onPick: ({ insert: ins }) => {
        const i = document.createElement('input'); i.type = 'file'; i.accept = '.bmmreplay,application/json';
        i.onchange = async () => {
          const f = i.files?.[0]; if (!f) return;
          try {
            toast.info(t('be.uploading', 'Uploading…'));
            const url = await uploadReplay(f);
            const title = await dialog.prompt({ title: t('be.replay.title', 'Replay caption'), label: t('be.replay.titlelabel', 'Optional caption shown above the player'), placeholder: t('be.replay.titleph', 'e.g. Installing a plugin') });
            ins(`:::replay${title ? `[${title}]` : ''}{src="${url}"}\n:::`);
          } catch (x) { toast.error(x?.status === 413 ? t('be.replay.toolarge', 'Replay too large (max 40 MB).') : t('be.uploadfail', 'Upload failed.')); }
        };
        i.click();
      } },
      { id: 'yt-prompt', icon: 'video', label: 'YouTube', onPick: async ({ insert: ins }) => { const url = await dialog.prompt({ title: 'YouTube', label: 'Video URL or ID', placeholder: 'https://youtu.be/…' }); if (!url) return; const m = url.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/) || [null, url.trim()]; ins(`::youtube{id=${m[1]}}`); } },
      { id: 'pick-icon', icon: 'smile', label: t('be.pickicon', 'Icon (picker)'), onPick: ({ insert: ins }) => { insRef.current = ins; setIconPick(true); } },
      { id: 'pick-badge', icon: 'tag', label: t('be.pickbadge', 'Badge (picker)'), onPick: ({ insert: ins }) => { insRef.current = ins; setBadgePick(true); } },
      { id: 'pick-kbd', icon: 'keyboard', label: t('be.pickkbd', 'Shortcut (picker)'), onPick: ({ insert: ins }) => { insRef.current = ins; setKbdPick(true); } },
    ] },
  ];
  // The picker modals close the menu first, so the `insert` they need is remembered here.
  const insRef = useRef(null);
  const insAny = (text) => { if (insRef.current) { insRef.current(text); insRef.current = null; } else insert(text); };
  // B.MD block snippets (remark-directive). `insertBlock` closes the menu.
  const BLOCKS = [
    { icon: TagIcon, label: 'Callout', snip: '\n:::tip[Good to know]\nSomething worth highlighting.\n:::\n' },
    { icon: Sparkles, label: 'Custom callout', snip: '\n:::callout[Custom]{icon=rocket color="#7c3aed"}\nYour own icon and colour.\n:::\n' },
    { icon: ChevronDown, label: 'Collapsible', snip: '\n:::details[Click to expand]\nHidden content, supports **markdown**.\n:::\n' },
    { icon: LayoutGrid, label: 'Cards', snip: '\n::::cards\n:::card{title="First" icon=rocket}\nCard description.\n:::\n:::card{title="Link card" href="https://example.com" icon=link}\nGoes somewhere.\n:::\n::::\n' },
    { icon: ImagePlus, label: 'Image card', snip: '\n:::card{title="With image" image="https://picsum.photos/400/200"}\nCaption or description.\n:::\n' },
    { icon: Columns2, label: 'Columns', snip: '\n::::columns\n:::column\nLeft column.\n:::\n:::column\nRight column.\n:::\n::::\n' },
    { icon: FileDown, label: 'File download', snip: '\n:::file[example.zip]{href="https://example.com/file.zip" size="10 KB"}\n:::\n' },
    // A table is the one block whose SHAPE you know before you write it, and a fixed 2×2 meant
    // adding the third column by hand — in the header, in the separator and in every row, which
    // is exactly the edit that turns a table into a paragraph full of pipes.
    { icon: Table, label: t('be.b.table', 'Table…'), onPick: () => { setBlocksOpen(false); setTableBuilder(true); } },
    { icon: ImagePlus, label: 'Image', snip: '\n![alt text](https://picsum.photos/600/300)\n' },
    { icon: Video, label: 'Video (mp4/webm)', snip: '\n<video src="https://example.com/clip.mp4" controls></video>\n' },
    { icon: Youtube, label: 'YouTube embed', snip: '\n<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>\n' },
    { icon: PlayCircle, label: t('be.replay.upload', 'Session replay (upload .bmmreplay)'), onPick: () => {
      setBlocksOpen(false);
      const i = document.createElement('input'); i.type = 'file'; i.accept = '.bmmreplay,application/json';
      i.onchange = async () => {
        const f = i.files?.[0]; if (!f) return;
        try {
          toast.info(t('be.uploading', 'Uploading…'));
          const url = await uploadReplay(f);
          const title = await dialog.prompt({ title: t('be.replay.title', 'Replay caption'), label: t('be.replay.titlelabel', 'Optional caption shown above the player'), placeholder: t('be.replay.titleph', 'e.g. Installing a plugin') });
          insertBlock(`\n:::replay{src="${url}"${title ? ` title="${title}"` : ''}}\n:::\n`);
        } catch (x) { toast.error(x?.status === 413 ? t('be.replay.toolarge', 'Replay too large (max 40 MB).') : t('be.uploadfail', 'Upload failed.')); }
      };
      i.click();
    } },
    { icon: PlayCircle, label: t('be.replay.url', 'Session replay (from URL)'), snip: '\n:::replay{src="https://example.com/session.bmmreplay" title="What happens here"}\n:::\n' },
    // Four colons on the outside, three inside: remark-directive matches by colon count, so
    // a `:::` inside a `:::` closes the parent. Anybody inserting this snippet gets the
    // nesting right without having to know that.
    { icon: ListOrdered, label: 'Steps', snip: '\n::::steps[How it works]{type=1}\n:::step[First]\nWhat to do. Supports **markdown**, callouts, code — anything.\n:::\n:::step[Second]\nAnd so on.\n:::\n::::\n' },
    { icon: ListOrdered, label: 'Steps (lettered)', snip: '\n::::steps[Options]{type=a color="#7c3aed"}\n:::step[Option A]\nOne way.\n:::\n:::step[Option B]\nAnother.\n:::\n::::\n' },
    { icon: Milestone, label: 'Roadmap', snip: '\n:::roadmap[Roadmap]{orientation=vertical}\n```json\n{"categories":[{"name":"v1.0","items":[{"label":"Core","status":"done"},{"label":"Docs","status":"progress","percent":40},{"label":"Polish","status":"planned"}]}]}\n```\n:::\n' },
    { icon: Quote, label: 'Quote', snip: '\n> A blockquote, supports **markdown**.\n' },
    { icon: Minus, label: 'Divider', snip: '\n---\n' },
    { icon: AlignCenter, label: 'Align (center)', snip: '\n:::center\nCentered content, text or an ![image](url).\n:::\n' },
    { icon: AlignLeft, label: 'Align (left)', snip: '\n:::left\nLeft-aligned content.\n:::\n' },
    { icon: AlignRight, label: 'Align (right)', snip: '\n:::right\nRight-aligned content.\n:::\n' },
    { icon: MessageSquare, label: 'Annotation (hover note)', snip: '<doc-comment data-comment="Your note here">annotated text</doc-comment>' },
    { icon: Code2, label: 'Code block', snip: '\n```js\nconsole.log("hello");\n```\n' },
    { icon: Keyboard, label: 'Shortcut', onPick: () => { setBlocksOpen(false); setKbdPick(true); } },
    { icon: TagIcon, label: 'Tags / badge', onPick: () => { setBlocksOpen(false); setBadgePick(true); } },
    { icon: Smile, label: 'Icon', onPick: () => { setBlocksOpen(false); setIconPick(true); } },
    { icon: ListTree, label: 'Table of contents', snip: '\n::toc[On this page]\n' },
  ];
  // Insert a block snippet as its OWN block: remark-directive only parses `:::name…`
  // when it's separated from surrounding text by BLANK lines. Inserting a snippet at a
  // mid-paragraph cursor with just single newlines left the directive glued to the text,
  // so it rendered as raw `:::tip[…]` in the content. Force a blank line before/after.
  const insertBlock = (snip) => {
    const ta = ref.current; const v = value || ''; const at = ta ? ta.selectionStart : v.length;
    const before = v.slice(0, at); const after = v.slice(at);
    const core = snip.replace(/^\n+/, '').replace(/\n+$/, '');
    const pre = !before || /\n[ \t]*\n$/.test(before) ? '' : (before.endsWith('\n') ? '\n' : '\n\n');
    const post = !after || /^\n[ \t]*\n/.test(after) ? '' : (after.startsWith('\n') ? '\n' : '\n\n');
    const chunk = pre + core + post;
    const next = before + chunk + after; onChange(next);
    setBlocksOpen(false);
    setTimeout(() => { if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = before.length + chunk.length; } }, 0);
  };
  if (!full) {
    return (
      <>
        <BmdEditor compact value={value || ''} onChange={onChange} lang={uiLang === 'fr' ? 'fr' : 'en'} height={Math.max(minHeight, 96)} placeholder={placeholder} extraGroups={hostGroups} exportTitle="document" />
        {iconPick && <IconPicker onPick={(n) => insAny(` :icon[${n}] `)} onClose={() => setIconPick(false)} />}
      {/* Same picker, different destination: this one answers the block canvas's promise. */}
      {canvasIcon && <IconPicker onPick={(n) => closeCanvasIcon(n)} onClose={() => closeCanvasIcon(null)} />}
        {badgePick && <BadgePicker onPick={(label, color) => insAny(` :badge[${label}]${color ? `{color="${color}"}` : ''} `)} onPickRaw={(txt) => insAny(txt)} onClose={() => setBadgePick(false)} />}
        {kbdPick && <KbdPicker onPick={(combo) => insAny(` :kbd[${combo}] `)} onClose={() => setKbdPick(false)} />}
      </>
    );
  }
  return (
    <div className="rounded-xl border border-[var(--line)] overflow-hidden bg-[var(--surface-2)]">
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-[var(--line)]">
        {full && (
          <div className="inline-flex rounded-lg border border-[var(--line)] p-0.5 me-1">
            {[['rich', t('be.mode.rich', 'Editor')], ['write', 'Markdown'], ['visual', t('be.mode.visual', 'Visual')]].map(([m, label]) => (
              <button key={m} type="button" onClick={() => { setMode(m); setPreview(false); }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium ${mode === m ? 'bg-[var(--surface)] text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{label}</button>
            ))}
          </div>
        )}
        {mode === 'write' && <>
          {tool(Bold, () => insert('**bold**'), 'Bold')}{tool(Heading, () => insert('\n## Heading\n'), 'Heading')}{tool(List, () => insert('\n- item\n'), 'List')}{tool(Link2, linkEmbed, 'Link')}
          {full && <>
            <span className="w-px h-5 bg-[var(--line)] mx-1 self-center" />
            {tool(ImagePlus, () => pickImage((u) => insert(`\n![image](${u})\n`)), 'Image')}{tool(Youtube, ytEmbed, 'YouTube')}{tool(Video, videoEmbed, 'Video')}
            <span className="w-px h-5 bg-[var(--line)] mx-1 self-center" />
            <button type="button" onClick={() => setBadgePick(true)} className="btn btn-sm" title={t('blg.insbadge', "Insert a badge (classic, preset or custom)")}><TagIcon size={14} /> Badges</button>
            <div className="relative">
              <button ref={blocksBtnRef} type="button" onClick={openBlocks} className="btn btn-sm" title={t('blg.insblock', "Insert a content block (callout, tabs, cards\u2026)")}><BlocksIcon size={14} /> Blocks <ChevronDown size={12} /></button>
              {/* Portalled to <body>, and that is the whole fix.
                  `position: fixed` does NOT resolve against the viewport when an ancestor
                  carries a transform — and `.modal-card` has `.anim-pop`, whose
                  `animation-fill-mode: both` leaves `transform: scale(1)` applied forever
                  after the animation ends. So the modal became the containing block: the
                  viewport coordinates computed above landed inside it, and its
                  `overflow-hidden` (there for the rounded corners) clipped what was left —
                  which is why the menu was invisible at normal size and merely misplaced
                  once a smaller window moved the modal under the coordinates.
                  ActionBar's overflow menu portals for the same reason; this now matches. */}
              {tableBuilder && <TableBuilder open onClose={() => setTableBuilder(false)} onInsert={(md) => insertBlock(md)} />}
              {blocksOpen && createPortal(<>
                <div className="fixed inset-0 z-[60]" onClick={() => setBlocksOpen(false)} />
                <div className="fixed z-[61] w-52 rounded-xl border border-[var(--line-strong)] shadow-xl py-1 overflow-auto" style={{ background: 'var(--bg-solid)', top: blocksPos.top, left: blocksPos.left, maxHeight: blocksPos.maxH || 288 }}>
                  {BLOCKS.map((bl) => <button key={bl.label} type="button" onClick={() => bl.onPick ? bl.onPick() : insertBlock(bl.snip)} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-start hover:bg-[var(--surface-2)]"><bl.icon size={14} className="text-[var(--muted)]" /> {bl.label}</button>)}
                </div>
              </>, document.body)}
            </div>
          </>}
        </>}
        {/* In EVERY mode, not just the source one. The editable preview is the point of the
            padlock beside it, and hiding its entrance in `rich` — the mode a blog or docs
            editor opens in — put it out of reach of almost everyone. The render branch below
            already handled `preview` in any mode; only this button was gated. */}
        <button type="button" onClick={() => setPreview((v) => !v)} className={`btn btn-sm${mode !== 'rich' ? ' ms-auto' : ''}`}><Eye size={14} /> {preview ? t('lp.back', 'Edit') : t('bmdc.preview', 'Preview')}</button>
        {preview && <button type="button" onClick={() => setPvUnlocked((v) => !v)} className={`btn btn-sm${pvUnlocked ? ' is-on' : ''}`}
          title={pvUnlocked ? t('lp.locked.h', 'Lock the preview, show it as a reader sees it') : t('lp.unlock.h', 'Edit directly on the rendered page')}>
          {pvUnlocked ? <Unlock size={14} /> : <Lock size={14} />} <span className="hidden sm:inline">{pvUnlocked ? t('lp.editing', 'Editing') : t('lp.locked', 'Locked')}</span>
        </button>}
        {/* .bmd — B.MD's own file: the document plus a `---` front matter carrying its format
            version. Round-trips through parseBmdFile / serializeBmdFile in the package, so a
            document written here opens in the BMM app and in the docs the same way. */}
        {full && <>
          <button type="button" onClick={importBmd} className={`btn btn-sm${mode === 'rich' ? ' ms-auto' : ''}`} title={t('bmdf.import.h', 'Open a .bmd file into this editor')}><Upload size={14} /> <span className="hidden sm:inline">.bmd</span></button>
          <button type="button" onClick={exportBmd} className="btn btn-sm" title={t('bmdf.export.h', 'Save this document as a .bmd file')}><Download size={14} /></button>
        </>}
        {full && <a href="/blog/markdown-guide" target="_blank" rel="noreferrer" className="btn btn-sm" title={t('blg.mdguide', "Markdown guide")}><HelpCircle size={14} /> <span className="hidden sm:inline">Guide</span></a>}
      </div>
      {mode === 'rich' && !preview
        // The floating select-to-format toolbar belongs in EVERY text mode, not just the
        // raw one. `rich` is what a blog or docs editor opens in, so selecting a word
        // and reaching for bold found nothing at all — the feature existed in the mode
        // almost nobody switches to. Passing our ref down is all it needs.
        ? <><BmdEditor value={value || ''} onChange={onChange} lang={uiLang === 'fr' ? 'fr' : 'en'} height={Math.max(minHeight, 260)} className="!border-0 !rounded-none" exportTitle="document" extraGroups={hostGroups} textareaRef={ref} />
          <SelectionToolbar key={mode} taRef={ref} value={value || ''} onChange={onChange} /></>
        : preview
        ? <div className="p-4 max-h-[52vh] overflow-auto">
            <BmdLivePreview value={value || ''} onChange={onChange} renderer={Markdown} lang={uiLang === 'fr' ? 'fr' : 'en'}
              unlocked={pvUnlocked} onUnlockedChange={setPvUnlocked}
              snippetGroups={localizeSnippetGroups(SNIPPET_GROUPS, uiLang)}
              labels={{ edit: t('lp.edit', 'Edit this block'), done: t('common.done', 'Done'), insert: t('lp.insert', 'Insert here'),
                remove: t('lp.remove', 'Remove this block'), empty: t('lp.empty', 'Nothing yet. Unlock to write something.'),
                search: t('bmdc.search', 'Search blocks…'), noMatch: t('bmdc.nomatch', 'No block matches that. Clear the search to see them all.') }} />
          </div>
        : mode === 'visual'
          ? <div className="max-h-[52vh] overflow-auto p-2"><BmdBlockCanvas value={value || ''} onChange={onChange}
              snippetGroups={localizeSnippetGroups(SNIPPET_GROUPS, uiLang)} renderer={Markdown} lang={uiLang === 'fr' ? 'fr' : 'en'}
              pickIcon={pickIconForCanvas}
              labels={{
                insert: t('bmdc.insert', 'Insert a block'), search: t('bmdc.search', 'Search blocks…'),
                noMatch: t('bmdc.nomatch', 'No block matches that. Clear the search to see them all.'), count: t('bmdc.count', '{n} block(s)'),
                preview: t('bmdc.preview', 'Preview'), drag: t('bmdc.drag', 'Drag to reorder'),
                up: t('bmdc.up', 'Move up'), down: t('bmdc.down', 'Move down'), del: t('common.delete', 'Delete'),
                title: t('bmdc.title', 'Title'), icon: t('bmdc.icon', 'Icon'), noIcon: t('bmdc.noicon', 'Pick an icon'),
                empty: t('bmdc.empty', 'Empty document, insert a block above.'),
                style: t('bmdc.style', 'Style'), styleA: t('bmdc.styleA', 'Style A'), styleB: t('bmdc.styleB', 'Style B'),
                space: t('bmdc.space', 'Space below'), spaceAuto: t('bmdc.spaceAuto', 'Space: auto'),
                space_none: t('bmdc.space.none', 'None'), space_xs: t('bmdc.space.xs', 'Tiny'), space_sm: t('bmdc.space.sm', 'Small'),
                space_md: t('bmdc.space.md', 'Medium'), space_lg: t('bmdc.space.lg', 'Large'), space_xl: t('bmdc.space.xl', 'Huge'),
              }} /></div>
          : <><textarea ref={ref} className="w-full bg-transparent border-0 outline-none resize-none p-4 text-sm leading-relaxed text-[var(--text)]" style={{ minHeight }} value={value || ''} spellCheck={false} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
            <SelectionToolbar key={mode} taRef={ref} value={value || ''} onChange={onChange} /></>}
      {iconPick && <IconPicker onPick={(n) => insAny(` :icon[${n}] `)} onClose={() => setIconPick(false)} />}
      {badgePick && <BadgePicker onPick={(label, color) => insAny(` :badge[${label}]${color ? `{color="${color}"}` : ''} `)} onPickRaw={(txt) => insAny(txt)} onClose={() => setBadgePick(false)} />}
      {kbdPick && <KbdPicker onPick={(combo) => insAny(` :kbd[${combo}] `)} onClose={() => setKbdPick(false)} />}
    </div>
  );
}
