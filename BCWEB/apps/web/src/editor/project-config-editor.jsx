import { useState } from 'react';
import {
  ChevronDown, Plus, Trash2, GripVertical, Star, Link2, Download, Image as ImageIcon,
  Film, Play, ListTodo, ScrollText, Users, ShieldCheck, Upload, Eye, ExternalLink, Github, Network,
} from 'lucide-react';
import { Button, Input, Textarea, Field, Badge, Spinner } from '../ui/ui.jsx';
import { useToast } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import { api, uploadMedia } from '../lib/api.js';
import IconPicker from './icon-picker.jsx';
import { IconGlyph } from '../ui/md.jsx';
import { ProgressTracker } from '../pages/project.jsx';
import StackMap from '../ui/stack-map.jsx';
import { stackSwitchOn, STACK_KINDS } from '../lib/stack-layout.js';

// ── Visual project-config editor ──────────────────────────────────────────────
// A form-based editor for a project / showcase page's config, so admins don't have
// to hand-edit raw JSON. Edits the SAME config object the JSON editor does (both
// modes stay in sync via the shared parent state), section by section, with live
// visual previews (the progress tracker renders exactly like the public page).

const STATUS_OPTS = [['planned', 'Planned'], ['progress', 'In progress'], ['done', 'Done']];
// Derived from the renderer's own kind list, so a kind added there cannot go missing here.
const KIND_LABEL = { edge: 'Edge', app: 'App', worker: 'Worker', data: 'Data', external: 'External (someone else runs it)' };
const STACK_KIND_OPTS = STACK_KINDS.map((k) => [k, KIND_LABEL[k] || k]);

// A collapsible titled section.
function Section({ icon: Icon, title, desc, children, defaultOpen = false, badge }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-[var(--line)] overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-[var(--surface-2)] transition text-left">
        <Icon size={16} className="text-[var(--primary-2)] shrink-0" />
        <span className="font-medium text-sm flex-1">{title}</span>
        {badge != null && <Badge tone="primary">{badge}</Badge>}
        <ChevronDown size={16} className={`text-[var(--faint)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 py-3 border-t border-[var(--line)] space-y-3">{desc && <p className="text-xs text-[var(--faint)] -mt-0.5">{desc}</p>}{children}</div>}
    </div>
  );
}

// A URL field with an Upload button (image / video / rrweb json) + optional preview.
function MediaField({ label, hint, value, onChange, accept, preview }) {
  const toast = useToast(); const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const pick = () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept;
    i.onchange = async () => {
      const f = i.files?.[0]; if (!f) return;
      setBusy(true);
      try { onChange(await uploadMedia(f)); toast.success(t('pce.uploaded', 'Uploaded.')); }
      catch (x) { toast.error(x.status === 413 ? t('pce.toolarge', 'File too large.') : x.status === 415 ? t('pce.unsupported', 'Unsupported file type.') : t('be.uploadfail', 'Upload failed.')); }
      finally { setBusy(false); }
    };
    i.click();
  };
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <Input className="flex-1" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="https://… or upload →" />
        <Button type="button" size="sm" disabled={busy} onClick={pick}>{busy ? <Spinner /> : <><Upload size={13} /> Upload</>}</Button>
        {value && <Button type="button" size="sm" variant="ghost" onClick={() => onChange('')}>Clear</Button>}
      </div>
      {value && preview === 'image' && <img src={value} alt="" className="mt-2 max-h-32 rounded-lg border border-[var(--line)]" />}
      {value && preview === 'video' && <video src={value} controls className="mt-2 max-h-40 rounded-lg border border-[var(--line)]" />}
    </Field>
  );
}

// Compact URL + Upload input (no label/preview) for inline use in list rows.
function MediaFieldInline({ value, onChange, placeholder, accept }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const pick = () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept;
    i.onchange = async () => { const f = i.files?.[0]; if (!f) return; setBusy(true);
      try { onChange(await uploadMedia(f)); } catch (x) { toast.error(x.status === 413 ? 'Too large.' : x.status === 415 ? 'Unsupported type.' : 'Upload failed.'); } finally { setBusy(false); } };
    i.click();
  };
  return (
    <div className="flex items-center gap-1.5">
      <Input className="flex-1 min-w-0" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <Button type="button" size="sm" disabled={busy} onClick={pick} className="shrink-0">{busy ? <Spinner /> : <Upload size={13} />}</Button>
    </div>
  );
}

// One editable row in a repeatable list, with drag-to-reorder + delete.
function Repeatable({ items, onChange, render, add, addLabel, empty }) {
  const [dragIdx, setDragIdx] = useState(null);
  const move = (from, to) => { const a = [...items]; const [x] = a.splice(from, 1); a.splice(to, 0, x); onChange(a); };
  return (
    <div className="space-y-2">
      {items.length === 0 && <div className="text-xs text-[var(--faint)] py-1">{empty}</div>}
      {items.map((it, i) => (
        <div key={i} draggable onDragStart={() => setDragIdx(i)} onDragOver={(e) => e.preventDefault()}
          onDrop={() => { if (dragIdx != null && dragIdx !== i) move(dragIdx, i); setDragIdx(null); }}
          className={`flex items-start gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2 ${dragIdx === i ? 'opacity-50' : ''}`}>
          <span className="cursor-grab text-[var(--faint)] mt-1.5 shrink-0" title="Drag to reorder"><GripVertical size={14} /></span>
          <div className="flex-1 min-w-0">{render(it, (patch) => onChange(items.map((x, j) => j === i ? { ...x, ...patch } : x)))}</div>
          <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-[var(--faint)] hover:text-error mt-1.5 shrink-0"><Trash2 size={14} /></button>
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...items, add()])}><Plus size={13} /> {addLabel}</Button>
    </div>
  );
}

// Small icon-picker button (chosen glyph + name).
function IconBtn({ value, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--text)] shrink-0">
        {value ? <IconGlyph name={value} size={15} /> : <ShieldCheck size={15} />}<span>{value || 'icon'}</span>
      </button>
      {open && <IconPicker title="Pick an icon" onPick={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}

const LINK_FIELDS = [['github', 'GitHub'], ['source', 'Source'], ['discord', 'Discord'], ['kofi', 'Ko-fi'], ['website', 'Website']];

// Files worth reading out of a picked folder. The SAME list the server applies to a GitHub
// tree — kept here as well so a folder never leaves the machine whole: the browser filters
// first and posts a handful of small text files, not the repo.
const DETECT_NAMES = new Set(['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml',
  'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'requirements.txt']);
const DETECT_SKIP = /(^|\/)(node_modules|vendor|\.git|dist|build|target|\.venv)(\/|$)/;

/**
 * Read a repository and propose a diagram.
 *
 * What comes back is a DRAFT, and it says so: it is published on a public page as a statement
 * about somebody's infrastructure, so it lists the files each component came from and asks
 * before overwriting work already done by hand.
 */
function StackDetect({ onDraft, hasExisting }) {
  const toast = useToast(); const { t } = useI18n();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);

  const run = async (payload, what) => {
    setBusy(true); setDraft(null);
    try {
      const r = await api.post('/admin/projects/stack/detect', payload);
      if (!r.nodes?.length) {
        toast.error(t('pce.st.none', 'Nothing recognisable in {what} — no compose file and no package manifest.').replace('{what}', what));
        return;
      }
      setDraft(r);
    } catch (x) {
      toast.error(x.data?.error === 'not_a_github_repo' ? t('pce.st.notrepo', 'That is not a GitHub repository URL.')
        : x.data?.error === 'github_unreachable' ? t('pce.st.unreachable', 'Could not read that repository — check it is public and the address is right.')
          : x.data?.error === 'bad_zip' ? t('pce.st.badzip', 'That file is not a readable zip.')
            : t('pce.st.failed', 'Could not read that.'));
    } finally { setBusy(false); }
  };

  const pickFolder = () => {
    const i = document.createElement('input');
    i.type = 'file'; i.webkitdirectory = true; i.multiple = true;
    i.onchange = async () => {
      const all = [...(i.files || [])];
      const wanted = all.filter((f) => {
        const rel = f.webkitRelativePath || f.name;
        // Drop the folder's own name so paths match what the server sees for a repo.
        const path = rel.split('/').slice(1).join('/') || rel;
        return DETECT_NAMES.has(path.split('/').pop()) && !DETECT_SKIP.test(path) && path.split('/').length <= 4;
      });
      if (!wanted.length) return toast.error(t('pce.st.nofiles', 'No compose file or package manifest in that folder.'));
      const files = {};
      for (const f of wanted.slice(0, 40)) {
        const path = (f.webkitRelativePath || f.name).split('/').slice(1).join('/');
        files[path] = (await f.text()).slice(0, 200_000);
      }
      run({ files }, t('pce.st.thatfolder', 'that folder'));
    };
    i.click();
  };

  const pickZip = () => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = '.zip,application/zip';
    i.onchange = async () => {
      const f = i.files?.[0]; if (!f) return;
      if (f.size > 9 * 1024 * 1024) return toast.error(t('pce.st.zipbig', 'That zip is over 9 MB. Pick the folder instead — only the manifests are read.'));
      const buf = await f.arrayBuffer();
      let bin = ''; const bytes = new Uint8Array(buf);
      for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
      run({ zipBase64: btoa(bin) }, f.name);
    };
    i.click();
  };

  const apply = () => {
    if (hasExisting && !window.confirm(t('pce.st.replace', 'Replace the components below with what was found?'))) return;
    onDraft(draft);
    setDraft(null);
    toast.success(t('pce.st.applied', 'Added — edit anything that is not right before saving.'));
  };

  return (
    <div className="rounded-xl border border-[var(--line)] p-3 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">Build it from a repository</div>
      <p className="text-[11px] text-[var(--faint)]">
        Reads compose files and package manifests and proposes the components. It only ever reports
        what a file actually said — nothing is invented — and you edit the result before saving.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="flex-1 min-w-[200px]" value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/repo" />
        <Button type="button" size="sm" disabled={busy || !url.trim()} onClick={() => run({ url: url.trim() }, url.trim())}>
          {busy ? <Spinner /> : <><Github size={13} /> Read it</>}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={pickFolder}>Pick a folder</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={pickZip}>…or a zip</Button>
      </div>

      {draft && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 space-y-2">
          <div className="text-sm">
            <b>{draft.nodes.length}</b> component(s), <b>{draft.edges.length}</b> connection(s)
            <span className="text-[var(--faint)]"> · {draft.filesRead} file(s) read</span>
          </div>
          <ul className="text-[12px] space-y-0.5">
            {draft.nodes.map((n) => (
              <li key={n.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{n.label}</span>
                <span className="text-[var(--faint)]">{n.kind}</span>
                {n.tech && <span className="text-[var(--muted)]">{n.tech}</span>}
              </li>
            ))}
          </ul>
          {/* Where each claim came from. Without it this is a machine asserting things about
              somebody's servers with nothing to check it against. */}
          <div className="text-[11px] text-[var(--faint)]">Read from: {draft.evidence.join(', ')}</div>
          {(draft.notes || []).map((n, i) => <div key={i} className="text-[11px] text-[var(--warning)]">{n}</div>)}
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="primary" onClick={apply}>Use these</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>Discard</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProjectConfigEditor({ value, onChange, slug, isShowcase }) {
  const toast = useToast(); const { t } = useI18n();
  const c = value || {};
  const set = (patch) => onChange({ ...c, ...patch });
  const setIn = (key, patch) => onChange({ ...c, [key]: { ...(c[key] || {}), ...patch } });

  // Progress: remote source vs inline data. Mode is EXPLICIT state — not derived
  // from the (possibly empty-string) config value, which made "Remote URL" appear
  // to do nothing (an empty progressSource is falsy, so the derived mode snapped
  // straight back to 'none' and the URL input never showed).
  const [progMode, setProgMode] = useState(c.progressData ? 'inline' : (c.progressSource != null ? 'remote' : 'none'));
  const prog = c.progressData || { code: 0, art: 0, lastUpdate: '', categories: [] };
  const setProg = (patch) => set({ progressData: { ...prog, ...patch } });
  const testRemote = async () => {
    try { const r = await api.get(`/${isShowcase ? 'showcase' : 'projects'}/${slug}/progress`); const n = (r.progress?.categories || []).reduce((a, cc) => a + (cc.items?.length || 0), 0); toast.success(t('pce.fetched', 'Fetched progress.json ({n} items).').replace('{n}', n)); }
    catch (x) { toast.error(x.data?.detail || x.data?.error || t('pce.fetchfail', 'Fetch failed.')); }
  };

  const links = c.links || {};
  const downloads = Array.isArray(c.downloads) ? c.downloads : [];
  // Legal has TWO shapes: fixed projects (bmm/bsm/…) store an OBJECT
  // { license, licenseUrl, tos, privacy, readme } while showcase pages store an
  // ARRAY of cards. Render the matching editor (an array iff it really is one).
  const legalIsArray = Array.isArray(c.legal);
  const legalArr = legalIsArray ? c.legal : [];
  const legalObj = (!legalIsArray && c.legal && typeof c.legal === 'object') ? c.legal : {};
  const setLegalObj = (patch) => set({ legal: { ...legalObj, ...patch } });
  // "How it runs". Connections are normalised to objects on READ, because the renderer accepts
  // both `['db','api']` and `{from,to,label}` but Repeatable patches by merging — merging a
  // `{from}` into an array item would produce an array wearing extra properties, which is
  // neither shape and draws nothing. Reading them as objects means an older config is converted
  // the first time it is edited, visibly, rather than half-written.
  const stack = c.stack || {};
  const stackNodes = Array.isArray(stack.nodes) ? stack.nodes : [];
  const stackEdges = (Array.isArray(stack.edges) ? stack.edges : []).map((e) =>
    (Array.isArray(e) ? { from: e[0], to: e[1], label: e[2] || '' } : (e || {})));
  const stackOn = stackSwitchOn(stack, isShowcase ? (c.tabs || {}) : null);

  const rn = c.releaseNotes || {};
  const ov = c.overview || {};
  const community = c.community || {};
  const contributors = Array.isArray(community.contributors) ? community.contributors : [];
  const messages = Array.isArray(community.messages) ? community.messages : [];
  // Custom links: prefer the new array; fall back to migrating the legacy single
  // customLabel/customUrl pair so existing configs keep their link.
  const customLinks = Array.isArray(links.custom)
    ? links.custom
    : (links.customUrl ? [{ icon: 'link', label: links.customLabel || 'Link', url: links.customUrl }] : []);

  return (
    <div className="space-y-3">
      {/* Basics */}
      <Section icon={Eye} title="Basics" defaultOpen>
        <Field label="Tagline"><Input value={c.tagline || ''} onChange={(e) => set({ tagline: e.target.value })} placeholder="One-line description shown under the title" /></Field>
        <Field label="Version (optional)"><Input value={c.version || ''} onChange={(e) => set({ version: e.target.value })} placeholder="1.4.0" /></Field>
      </Section>

      {/* Links */}
      <Section icon={Link2} title="Links" badge={Object.values(links).filter(Boolean).length || null}>
        <div className="grid sm:grid-cols-2 gap-3">
          {LINK_FIELDS.map(([k, label]) => (
            <Field key={k} label={label}><Input value={links[k] || ''} onChange={(e) => setIn('links', { [k]: e.target.value })} placeholder="https://…" /></Field>
          ))}
        </div>
        {/* Custom links — as many as you want, each its own button with a chosen
            icon (lucide / simple:brand) + label. (The old single customLabel/
            customUrl pair is auto-migrated into this list on first edit.) */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">Custom links</div>
          <Repeatable items={customLinks} onChange={(v) => setIn('links', { custom: v, customLabel: undefined, customUrl: undefined })} addLabel="Add link" empty="No custom links yet."
            add={() => ({ icon: 'link', label: 'Docs', url: '' })}
            render={(it, patch) => (
              <div className="flex items-center gap-2">
                <IconBtn value={it.icon} onChange={(v) => patch({ icon: v })} />
                <Input className="!w-32" value={it.label || ''} onChange={(e) => patch({ label: e.target.value })} placeholder="Label" />
                <Input className="flex-1" value={it.url || ''} onChange={(e) => patch({ url: e.target.value })} placeholder="https://…" />
              </div>
            )} />
        </div>
      </Section>

      {/* Downloads */}
      <Section icon={Download} title="Downloads" badge={downloads.length || null}>
        <Repeatable items={downloads} onChange={(v) => set({ downloads: v })} addLabel="Add download" empty="No download buttons yet."
          add={() => ({ label: 'Download', url: '', primary: downloads.length === 0 })}
          render={(it, patch) => (
            <div className="grid grid-cols-[auto_1fr_1.6fr_auto] gap-2 items-center">
              <IconBtn value={it.icon} onChange={(v) => patch({ icon: v })} />
              <Input value={it.label || ''} onChange={(e) => patch({ label: e.target.value })} placeholder="Label" />
              <Input value={it.url || ''} onChange={(e) => patch({ url: e.target.value })} placeholder="https://…" />
              <button type="button" onClick={() => patch({ primary: !it.primary })} title="Primary button"
                className={`px-2 py-1.5 rounded-lg border text-xs flex items-center gap-1 ${it.primary ? 'border-[var(--primary)] text-[var(--primary)]' : 'border-[var(--line)] text-[var(--faint)]'}`}>
                <Star size={12} className={it.primary ? 'fill-[var(--primary)]' : ''} /> Primary
              </button>
            </div>
          )} />
      </Section>

      {/* Overview media */}
      <Section icon={ImageIcon} title="Overview media" desc="Shown at the top of the Overview tab. Use one — a video/replay wins over a still image.">
        <MediaField label="Cover image" value={ov.image} onChange={(v) => setIn('overview', { image: v })} accept="image/*" preview="image" />
        <MediaField label="Video (mp4/webm)" value={ov.video} onChange={(v) => setIn('overview', { video: v })} accept="video/mp4,video/webm" preview="video" />
        <MediaField label="rrweb replay JSON" hint="Upload an rrweb recording (.json) or paste its URL — plays as a live in-app preview." value={ov.replayUrl} onChange={(v) => setIn('overview', { replayUrl: v })} accept="application/json,.json" />
        <MediaField label="rrweb page URL (alternative)" value={ov.rrwebUrl} onChange={(v) => setIn('overview', { rrwebUrl: v })} accept="application/json,.json" />
      </Section>

      {/* Progress tracker */}
      <Section icon={ListTodo} title="Progress tracker" desc="Show a live roadmap on the Overview tab.">
        <div className="inline-flex rounded-xl border border-[var(--line)] p-0.5 text-sm">
          {[['none', 'Off'], ['remote', 'Remote URL'], ['inline', 'Build here']].map(([m, label]) => (
            <button key={m} type="button"
              onClick={() => {
                setProgMode(m);
                if (m === 'none') set({ progressSource: undefined, progressData: undefined });
                else if (m === 'remote') set({ progressData: undefined, progressSource: c.progressSource || '' });
                else set({ progressSource: undefined, progressData: c.progressData || prog });
              }}
              className={`px-3 py-1.5 rounded-lg ${progMode === m ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'}`}>{label}</button>
          ))}
        </div>

        {progMode === 'remote' && (
          <div className="space-y-1.5">
            <div className="flex items-end gap-2">
              <div className="flex-1"><Field label="progress.json URL" hint="A raw URL — auto-refreshed and cached for 5 min. Save first, then Test."><Input value={c.progressSource || ''} onChange={(e) => set({ progressSource: e.target.value })} placeholder="https://raw.githubusercontent.com/…/progress.json" /></Field></div>
              <Button type="button" size="sm" onClick={testRemote}><Play size={13} /> Test saved</Button>
            </div>
          </div>
        )}

        {progMode === 'inline' && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Code %"><Input type="number" min={0} max={100} value={prog.code ?? 0} onChange={(e) => setProg({ code: Number(e.target.value) })} /></Field>
              <Field label="Art / visual %"><Input type="number" min={0} max={100} value={prog.art ?? 0} onChange={(e) => setProg({ art: Number(e.target.value) })} /></Field>
              <Field label="Last update"><Input value={prog.lastUpdate || ''} onChange={(e) => setProg({ lastUpdate: e.target.value })} placeholder="Jul 2026" /></Field>
            </div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">Categories</div>
            <Repeatable items={prog.categories || []} onChange={(v) => setProg({ categories: v })} addLabel="Add category" empty="No categories yet."
              add={() => ({ name: 'New category', items: [] })}
              render={(cat, patch) => (
                <div className="space-y-2">
                  <Input value={cat.name || ''} onChange={(e) => patch({ name: e.target.value })} placeholder="Category name" className="font-medium" />
                  <Repeatable items={cat.items || []} onChange={(v) => patch({ items: v })} addLabel="Add item" empty="No items."
                    add={() => ({ label: 'New item', status: 'planned', percent: 0 })}
                    render={(it, ipatch) => (
                      <div className="grid grid-cols-[1fr_120px_84px] gap-2 items-center">
                        <Input value={it.label || ''} onChange={(e) => ipatch({ label: e.target.value })} placeholder="Item label" />
                        <select value={it.status || 'planned'} onChange={(e) => ipatch({ status: e.target.value })} className="input !py-1.5 !text-sm">
                          {STATUS_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <Input type="number" min={0} max={100} value={it.percent ?? 0} onChange={(e) => ipatch({ percent: Number(e.target.value) })} placeholder="%" className="!py-1.5" />
                      </div>
                    )} />
                </div>
              )} />

            {/* Live preview — renders exactly like the public Overview tab. */}
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2 flex items-center gap-1.5"><Eye size={12} /> Live preview</div>
              <ProgressTracker data={prog} title="Progress" lang="en" />
            </div>
          </div>
        )}
      </Section>

      {/* How it runs */}
      <Section icon={Network} title="How it runs" desc="A diagram of the pieces this project is made of, shown on its own tab. It is a description you write — never the live infrastructure, which is admin-only for a reason." badge={stackNodes.length || null}>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={stackOn} onChange={(e) => {
            // On a showcase page the sub-tab checkboxes are the established switch, and this
            // one has to be the SAME switch — two places to turn one tab on is how a setting
            // stops being believed. Built-in projects have no such block, so the flag rides
            // on the stack itself. `stackTabEnabled` is what both pages actually read.
            if (isShowcase) set({ tabs: { ...(c.tabs || {}), stack: e.target.checked } });
            else setIn('stack', { enabled: e.target.checked });
          }} />
          Show the “How it runs” tab
        </label>
        {stackOn && !stackNodes.length && (
          <p className="text-xs text-[var(--warning)]">Add at least one component below — the tab stays hidden while there is nothing to draw.</p>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Tab title" hint="Defaults to “How it runs”."><Input value={stack.title || ''} onChange={(e) => setIn('stack', { title: e.target.value })} placeholder="How it runs" /></Field>
          <Field label="Intro line (optional)"><Input value={stack.note || ''} onChange={(e) => setIn('stack', { note: e.target.value })} placeholder="A short sentence above the diagram" /></Field>
        </div>

        <StackDetect
          onDraft={(d) => setIn('stack', { nodes: d.nodes, edges: d.edges })}
          hasExisting={stackNodes.length > 0}
        />

        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">Components</div>
        <Repeatable items={stackNodes} onChange={(v) => setIn('stack', { nodes: v })} addLabel="Add component" empty="No components yet."
          add={() => ({ id: `n${stackNodes.length + 1}`, label: 'New component', kind: 'app' })}
          render={(n, patch) => (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_120px] gap-2">
                <Input value={n.label || ''} onChange={(e) => patch({ label: e.target.value })} placeholder="Name (e.g. API)" className="font-medium" />
                <select value={n.kind || 'app'} onChange={(e) => patch({ kind: e.target.value })} className="input !py-1.5 !text-sm">
                  {STACK_KIND_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-[110px_1fr_100px] gap-2">
                <Input value={n.id || ''} onChange={(e) => patch({ id: e.target.value })} placeholder="id" className="!py-1.5 !text-xs font-mono" />
                <Input value={n.tech || ''} onChange={(e) => patch({ tech: e.target.value })} placeholder="Built with (Fastify, Postgres…)" className="!py-1.5 !text-sm" />
                <Input value={n.version || ''} onChange={(e) => patch({ version: e.target.value })} placeholder="version" className="!py-1.5 !text-sm" />
              </div>
              <Textarea rows={2} value={n.note || ''} onChange={(e) => patch({ note: e.target.value })} placeholder="What this piece does, in a sentence or two." className="!text-sm" />
              <Input value={n.docs || ''} onChange={(e) => patch({ docs: e.target.value })} placeholder="Documentation URL (optional)" className="!py-1.5 !text-sm" />
            </div>
          )} />

        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">Connections</div>
        <p className="text-[11px] text-[var(--faint)] -mt-1.5">“A needs B” — B is drawn to the left of A. A connection naming a component that no longer exists is ignored rather than drawn.</p>
        <Repeatable items={stackEdges} onChange={(v) => setIn('stack', { edges: v })} addLabel="Add connection" empty="No connections yet."
          add={() => ({ from: stackNodes[0]?.id || '', to: stackNodes[1]?.id || '', label: '' })}
          render={(e, patch) => (
            <div className="grid grid-cols-[1fr_1fr_110px] gap-2 items-center">
              <select value={e.to || ''} onChange={(ev) => patch({ to: ev.target.value })} className="input !py-1.5 !text-sm">
                <option value="">this one…</option>
                {stackNodes.map((n) => <option key={n.id} value={n.id}>{n.label || n.id}</option>)}
              </select>
              <select value={e.from || ''} onChange={(ev) => patch({ from: ev.target.value })} className="input !py-1.5 !text-sm">
                <option value="">…needs</option>
                {stackNodes.map((n) => <option key={n.id} value={n.id}>{n.label || n.id}</option>)}
              </select>
              <Input value={e.label || ''} onChange={(ev) => patch({ label: ev.target.value })} placeholder="SQL, HTTP…" className="!py-1.5 !text-sm" />
            </div>
          )} />

        {/* Live preview — the same component the public tab renders. */}
        {stackNodes.length > 0 && (
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2 flex items-center gap-1.5"><Eye size={12} /> Live preview</div>
            <StackMap stack={stack} />
          </div>
        )}
      </Section>

      {/* Release notes */}
      <Section icon={ScrollText} title="Release notes (GitHub)" desc="Pulls .md files from a GitHub repo path — shown on the Release Notes tab.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Owner"><Input value={rn.owner || ''} onChange={(e) => setIn('releaseNotes', { owner: e.target.value })} placeholder="org-or-user" /></Field>
          <Field label="Repo"><Input value={rn.repo || ''} onChange={(e) => setIn('releaseNotes', { repo: e.target.value })} placeholder="my-repo" /></Field>
          <Field label="Branch"><Input value={rn.branch || ''} onChange={(e) => setIn('releaseNotes', { branch: e.target.value })} placeholder="main" /></Field>
          <Field label="Path (folder of .md)"><Input value={rn.path || ''} onChange={(e) => setIn('releaseNotes', { path: e.target.value })} placeholder="changelogs" /></Field>
        </div>
        {isShowcase && <p className="text-[11px] text-[var(--faint)]"><Github size={11} className="inline" /> Remember to enable the "Release notes" sub-tab in the project settings for this to show.</p>}
      </Section>

      {/* Community */}
      <Section icon={Users} title="Community" badge={(contributors.length + messages.length) || null}>
        <Field label="Community link (Discord/forum)"><Input value={community.url || ''} onChange={(e) => setIn('community', { url: e.target.value })} placeholder="https://discord.gg/…" /></Field>

        {/* Contributors — build them right here (no external JSON needed). A URL
            still works as an alternative for teams that host their own list. */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">Contributors</div>
          <Repeatable items={contributors} onChange={(v) => setIn('community', { contributors: v })} addLabel="Add contributor" empty="No contributors yet — add them below, or use a JSON URL."
            add={() => ({ name: 'Name', role: '', category: 'contributors', pfp: '', description: '', links: {} })}
            render={(it, patch) => (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {it.pfp ? <img src={it.pfp} alt="" className="w-8 h-8 rounded-full object-cover border border-[var(--line)] shrink-0" /> : <span className="w-8 h-8 rounded-full bg-[var(--surface-2)] grid place-items-center text-xs shrink-0">{(it.name || '?')[0]}</span>}
                  <Input value={it.name || ''} onChange={(e) => patch({ name: e.target.value })} placeholder="Name" />
                  <Input value={it.role || ''} onChange={(e) => patch({ role: e.target.value })} placeholder="Role" className="!w-32" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input value={it.category || ''} onChange={(e) => patch({ category: e.target.value })} placeholder="Category (e.g. team, contributors)" />
                  <MediaFieldInline value={it.pfp} onChange={(v) => patch({ pfp: v })} placeholder="Avatar URL / upload" accept="image/*" />
                </div>
                <Textarea rows={2} value={it.description || ''} onChange={(e) => patch({ description: e.target.value })} placeholder="Short bio (optional)" />
                <div className="grid grid-cols-2 gap-2">
                  <Input value={it.links?.github || ''} onChange={(e) => patch({ links: { ...it.links, github: e.target.value } })} placeholder="GitHub URL" />
                  <Input value={it.links?.website || ''} onChange={(e) => patch({ links: { ...it.links, website: e.target.value } })} placeholder="Website URL" />
                </div>
              </div>
            )} />
        </div>

        {/* Community messages / ticker */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">Messages (ticker)</div>
          <Repeatable items={messages} onChange={(v) => setIn('community', { messages: v })} addLabel="Add message" empty="No messages."
            add={() => ({ from: '', text: '' })}
            render={(it, patch) => (
              <div className="grid grid-cols-[130px_1fr] gap-2">
                <Input value={it.from || ''} onChange={(e) => patch({ from: e.target.value })} placeholder="From" />
                <Input value={it.text || ''} onChange={(e) => patch({ text: e.target.value })} placeholder="Message" />
              </div>
            )} />
        </div>

        <details>
          <summary className="text-xs text-[var(--muted)] cursor-pointer">Advanced: load contributors from a JSON URL instead</summary>
          <div className="mt-2"><Field label="Contributors JSON URL" hint="Overrides the inline list above when set."><Input value={community.contributorsUrl || ''} onChange={(e) => setIn('community', { contributorsUrl: e.target.value })} placeholder="https://raw.githubusercontent.com/…/contributors.json" /></Field></div>
        </details>
      </Section>

      {/* Legal — object shape (fixed projects) vs card array (showcase) */}
      <Section icon={ShieldCheck} title="Legal" badge={legalIsArray ? (legalArr.length || null) : (Object.values(legalObj).filter(Boolean).length || null)}>
        {legalIsArray ? (
          <Repeatable items={legalArr} onChange={(v) => set({ legal: v })} addLabel="Add legal card" empty="No legal cards yet."
            add={() => ({ icon: 'shield', title: 'License', text: '', url: '' })}
            render={(it, patch) => (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <IconBtn value={it.icon} onChange={(v) => patch({ icon: v })} />
                  <Input value={it.title || ''} onChange={(e) => patch({ title: e.target.value })} placeholder="Title" />
                </div>
                <Textarea rows={2} value={it.text || ''} onChange={(e) => patch({ text: e.target.value })} placeholder="Short description (optional)" />
                <Input value={it.url || ''} onChange={(e) => patch({ url: e.target.value })} placeholder="Link URL (optional)" />
              </div>
            )} />
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-[1fr_1.4fr] gap-3">
              <Field label="License name"><Input value={legalObj.license || ''} onChange={(e) => setLegalObj({ license: e.target.value })} placeholder="MIT" /></Field>
              <Field label="License URL"><Input value={legalObj.licenseUrl || ''} onChange={(e) => setLegalObj({ licenseUrl: e.target.value })} placeholder="https://…/LICENSE" /></Field>
            </div>
            <Field label="Terms of Use URL"><Input value={legalObj.tos || ''} onChange={(e) => setLegalObj({ tos: e.target.value })} placeholder="https://…/terms" /></Field>
            <Field label="Privacy Policy URL"><Input value={legalObj.privacy || ''} onChange={(e) => setLegalObj({ privacy: e.target.value })} placeholder="https://…/privacy" /></Field>
            <Field label="README URL"><Input value={legalObj.readme || ''} onChange={(e) => setLegalObj({ readme: e.target.value })} placeholder="https://…/README.md" /></Field>
            <button type="button" onClick={() => set({ legal: [] })} className="text-[11px] text-[var(--faint)] hover:text-[var(--text)] underline">Switch to card-style legal (advanced)</button>
          </div>
        )}
      </Section>

      {/* Blog limits — showcase ("Other Projects") pages only. Caps how much this page's
          own blog can hold; enforced when a new article is created (blog.mjs). 0 = off. */}
      {isShowcase && (
        <Section icon={ScrollText} title="Blog limits" desc="Cap this page's own blog. New articles are refused once a limit is reached. Leave 0 for no limit.">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Max articles" hint="Maximum number of blog posts on this page.">
              <Input type="number" min={0} value={c.blogMaxPosts ?? ''} onChange={(e) => set({ blogMaxPosts: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} placeholder="0 = unlimited" />
            </Field>
            <Field label="Max total size (KB)" hint="Combined size of every article body (EN + FR).">
              <Input type="number" min={0} value={c.blogMaxKB ?? ''} onChange={(e) => set({ blogMaxKB: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} placeholder="0 = unlimited" />
            </Field>
          </div>
        </Section>
      )}
    </div>
  );
}
