import { useState } from 'react';
import {
  ChevronDown, Plus, Trash2, GripVertical, Star, Link2, Download, Image as ImageIcon,
  Film, Play, ListTodo, ScrollText, Users, ShieldCheck, Upload, Eye, ExternalLink, Github,
} from 'lucide-react';
import { Button, Input, Textarea, Field, Badge, Spinner } from './ui.jsx';
import { useToast } from './ui.jsx';
import { api, uploadMedia } from './api.js';
import IconPicker from './icon-picker.jsx';
import { IconGlyph } from './md.jsx';
import { ProgressTracker } from './project.jsx';

// ── Visual project-config editor ──────────────────────────────────────────────
// A form-based editor for a project / showcase page's config, so admins don't have
// to hand-edit raw JSON. Edits the SAME config object the JSON editor does (both
// modes stay in sync via the shared parent state), section by section, with live
// visual previews (the progress tracker renders exactly like the public page).

const STATUS_OPTS = [['planned', 'Planned'], ['progress', 'In progress'], ['done', 'Done']];

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
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const pick = () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept;
    i.onchange = async () => {
      const f = i.files?.[0]; if (!f) return;
      setBusy(true);
      try { onChange(await uploadMedia(f)); toast.success('Uploaded.'); }
      catch (x) { toast.error(x.status === 413 ? 'File too large.' : x.status === 415 ? 'Unsupported file type.' : 'Upload failed.'); }
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
          <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-[var(--faint)] hover:text-red-400 mt-1.5 shrink-0"><Trash2 size={14} /></button>
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

export default function ProjectConfigEditor({ value, onChange, slug, isShowcase }) {
  const toast = useToast();
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
    try { const r = await api.get(`/${isShowcase ? 'showcase' : 'projects'}/${slug}/progress`); const n = (r.progress?.categories || []).reduce((a, cc) => a + (cc.items?.length || 0), 0); toast.success(`Fetched progress.json (${n} items).`); }
    catch (x) { toast.error(x.data?.detail || x.data?.error || 'Fetch failed.'); }
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
    </div>
  );
}
