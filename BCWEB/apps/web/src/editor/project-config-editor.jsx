import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { studioPath, handoffKey } from '../lib/studio-page.js';
import {
  ChevronDown, Plus, Trash2, GripVertical, Star, Link2, Download, Image as ImageIcon,
  Film, Play, ListTodo, ScrollText, Users, ShieldCheck, Upload, Eye, ExternalLink, Github, Network, Boxes, Copy, CalendarDays, Sparkles, LayoutTemplate,
} from 'lucide-react';
import { Button, Input, Textarea, Field, Badge, Spinner, Select, Modal } from '../ui/ui.jsx';
import { useToast } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../pages/auth.jsx';
import { api, uploadMedia } from '../lib/api.js';
import CanvasStudio from './canvas-studio.jsx';
import { MarkdownEditor } from './markdown-editor.jsx';
import { CANVAS_PRESETS, presetBlocks } from '../lib/canvas.js';
import IconPicker from './icon-picker.jsx';
import { IconGlyph } from '../ui/md.jsx';
import RrwebPreview from '../hero/RrwebPreview.jsx';
import { GitCommitHorizontal as GitLogIcon, Trash2 as RemoveIcon, FileUp } from 'lucide-react';
import { ProgressTracker } from '../pages/project.jsx';
import StackMap from '../ui/stack-map.jsx';
import { stackSwitchOn, STACK_KINDS } from '../lib/stack-layout.js';
import { DEFAULT_DEV_CARDS } from '../pages/dev.jsx';

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
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-[var(--surface-2)] transition text-start">
        <Icon size={16} className="text-[var(--accent-ink)] shrink-0" />
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
      {/* Replay (rrweb / BMM) — plays the real recording right in the editor, so a broken or
          wrong file is caught here instead of on the live page. Same player the Overview uses. */}
      {value && preview === 'replay' && (
        <div className="mt-2 rounded-lg border border-[var(--line)] overflow-hidden bg-[var(--surface-2)]">
          <RrwebPreview url={value} />
        </div>
      )}
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
  const { t } = useI18n();
  const [dragIdx, setDragIdx] = useState(null);
  const move = (from, to) => { const a = [...items]; const [x] = a.splice(from, 1); a.splice(to, 0, x); onChange(a); };
  return (
    <div className="space-y-2">
      {items.length === 0 && <div className="text-xs text-[var(--faint)] py-1">{empty}</div>}
      {items.map((it, i) => (
        <div key={i} draggable onDragStart={() => setDragIdx(i)} onDragOver={(e) => e.preventDefault()}
          onDrop={() => { if (dragIdx != null && dragIdx !== i) move(dragIdx, i); setDragIdx(null); }}
          className={`flex items-start gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2 ${dragIdx === i ? 'opacity-50' : ''}`}>
          <span className="cursor-grab text-[var(--faint)] mt-1.5 shrink-0" title={t('pce.drag', "Drag to reorder")}><GripVertical size={14} /></span>
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
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--text)] shrink-0">
        {value ? <IconGlyph name={value} size={15} /> : <ShieldCheck size={15} />}<span>{value || 'icon'}</span>
      </button>
      {open && <IconPicker title={t('pce.pickicon', "Pick an icon")} onPick={onChange} onClose={() => setOpen(false)} />}
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
/**
 * Keep this project's code graph current.
 *
 * The repository address and, for a showcase project, its webhook secret. For an official one
 * the secret may come from the server environment instead — which one is actually IN FORCE is
 * shown, because a page that hides that leaves somebody rotating a secret that nothing reads.
 *
 * The secret is never read back. A field that returns it is a field that leaks it to anybody who
 * can open this page.
 */
function CodeGraphSettings({ projectKey }) {
  const { t } = useI18n(); const toast = useToast();
  const [state, setState] = useState(null);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let on = true;
    api.get(`/admin/projects/${projectKey}/code-graph`)
      .then((r) => { if (on) { setState(r); setUrl(r.url || ''); } })
      .catch(() => {});
    return () => { on = false; };
  }, [projectKey]);

  const save = async () => {
    setBusy(true);
    try {
      // `secret` is sent only when something was typed. Sending an empty string means CLEAR,
      // and clearing it every time the address is edited would silently unhook the webhook.
      await api.put(`/admin/projects/${projectKey}/code-graph`, { url, ...(secret ? { secret } : {}) });
      setSecret('');
      const r = await api.get(`/admin/projects/${projectKey}/code-graph`);
      setState(r);
      toast.success(t('cg.saved', 'Saved.'));
    } catch { toast.error(t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };

  const refresh = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/admin/projects/${projectKey}/code-graph/refresh`, { url });
      toast.success(t('cg.read', 'Read {n} file(s).').replace('{n}', r.stats?.drawn ?? 0));
      setState(await api.get(`/admin/projects/${projectKey}/code-graph`));
    } catch (x) {
      toast.error(x?.data?.error === 'incomplete_fetch'
        ? t('cg.partial', 'Only part of the repository could be read, so nothing was stored.')
        : x?.data?.error === 'not_a_github_repo' ? t('cg.notrepo', 'That is not a GitHub repository URL.')
          : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  const copy = () => { navigator.clipboard?.writeText(state?.deliverTo || ''); toast.success(t('cg.copied', 'Address copied.')); };

  return (
    <Section icon={Network} title={t('pce.codegraph', "Code graph")} desc="Read the repository so the architecture view stays current. A GitHub webhook rebuilds it on every push; the button below does the same by hand.">
      <Field label={t('pce.repo', "Repository")}>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo" />
      </Field>

      <Field label={t('pce.whsecret', "Webhook secret")} hint={
        state?.secretFrom === 'env'
          ? 'Currently coming from the server environment (GITHUB_WEBHOOK_SECRET). Type one here to override it for this project only.'
          : state?.secretFrom === 'page'
            ? 'Set on this page. Leave blank to keep it; clear it by saving a single space.'
            : 'Required, a webhook with no secret is refused. Paste the same value into GitHub.'
      }>
        <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)}
          placeholder={state?.hasSecret ? '••••••••  (unchanged)' : 'a long random string'} />
      </Field>

      {/* The address to paste into GitHub, built for them — guessing the shape of it is the
          usual reason a webhook never fires. */}
      {state?.deliverTo && (
        <Field label={t('pce.sendto', "Send it to")} hint="GitHub → Settings → Webhooks → Add webhook. Content type: application/json. Event: push.">
          <div className="flex items-center gap-2">
            <Input readOnly value={state.deliverTo} className="flex-1 font-mono !text-[12px]" />
            <Button type="button" size="sm" onClick={copy}><Copy size={13} /> Copy</Button>
          </div>
        </Field>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : 'Save'}</Button>
        <Button type="button" size="sm" disabled={busy || !url.trim()} onClick={refresh}>{busy ? <Spinner /> : 'Read it now'}</Button>
      </div>

      {state?.snapshot ? (
        <div className="text-[11px] text-[var(--faint)]">
          Last read {new Date(state.snapshot.generatedAt).toLocaleString()} —{' '}
          {state.snapshot.stats?.drawn} file(s), {state.snapshot.stats?.edges} import(s),{' '}
          {state.snapshot.endpointStats?.links} call/route link(s).
        </div>
      ) : (
        <div className="text-[11px] text-[var(--faint)]">{t('pce.neverread', "Never read yet.")}</div>
      )}
    </Section>
  );
}

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
        toast.error(t('pce.st.none', 'Nothing recognisable in {what}, no compose file and no package manifest.').replace('{what}', what));
        return;
      }
      setDraft(r);
    } catch (x) {
      // Every branch says what to change. The catch-all used to swallow three different
      // situations — a rejected URL shape, a rate-limited GitHub, a half-read repository —
      // under "Could not read that.", which is the one sentence that helps nobody.
      const e = x.data?.error;
      toast.error(
        e === 'not_a_github_repo' ? t('pce.st.notrepo', 'That is not a GitHub repository URL, it should look like github.com/owner/repo.')
          : e === 'github_unreachable' ? t('pce.st.unreachable', 'Could not read that repository — check it is public and the address is right. (GitHub also refuses for a while after many reads in one hour.)')
            : e === 'incomplete_fetch' ? t('pce.st.partial', 'Only part of that repository could be read, so the result would be misleading. Try again in a minute.')
              : e === 'bad_zip' ? t('pce.st.badzip', 'That file is not a readable zip.')
                : e === 'invalid_request' ? t('pce.st.badreq', 'That address could not be read as a repository.')
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
      if (f.size > 9 * 1024 * 1024) return toast.error(t('pce.st.zipbig', 'That zip is over 9 MB. Pick the folder instead, only the manifests are read.'));
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
    toast.success(t('pce.st.applied', 'Added, edit anything that is not right before saving.'));
  };

  return (
    <div className="rounded-xl border border-[var(--line)] p-3 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">{t('pce.buildfromrepo', "Build it from a repository")}</div>
      <p className="text-[11px] text-[var(--faint)]">
        Reads compose files and package manifests and proposes the components. It only ever reports
        what a file actually said — nothing is invented — and you edit the result before saving.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="flex-1 min-w-[200px]" value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/repo" />
        <Button type="button" size="sm" disabled={busy || !url.trim()} onClick={() => run({ url: url.trim() }, url.trim())}>
          {busy ? <Spinner /> : <><Github size={13} /> {t('pce.readit', "Read it")}</>}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={pickFolder}>{t('pce.pickfolder', "Pick a folder")}</Button>
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
            <Button type="button" size="sm" variant="primary" onClick={apply}>{t('pce.usethese', "Use these")}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>Discard</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// The Activity tab's commit source, when GitHub's statistics are not the whole story: a
// private repo, a mirror, a history that predates the API's window — or simply the wish to
// read the actual .git. One command locally, paste or upload its output, done. Stored as
// per-day and per-author counts (a few KB), independent of the config draft, so it lands the
// moment it is imported rather than on the next Save.
function CommitImport({ slug }) {
  const { t } = useI18n(); const toast = useToast();
  const [info, setInfo] = useState(null);
  const [text, setText] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const load = () => api.get(`/admin/projects/${slug}/activity-import`).then((r) => setInfo(r.import || false)).catch(() => setInfo(false));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [slug]);
  const cmd = 'git log --all --date=iso-strict --format="%H|%aI|%an|%s" > commits.txt';
  const onFile = async (f) => { if (!f) return; if (f.size > 6 * 1024 * 1024) { toast.error(t('pce.ci.toobig', 'That file is over 6 MB, export without --all, or a date range.')); return; } setText(await f.text()); if (!label) setLabel(f.name.replace(/\.[^.]+$/, '')); };
  const run = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { const r = await api.post(`/admin/projects/${slug}/activity-import`, { log: text, label: label.trim() || undefined }); setInfo(r.import); setText(''); toast.success(t('pce.ci.done', '{n} commits imported, the Activity tab reads them now.').replace('{n}', r.import.total)); }
    catch (x) { toast.error(x?.data?.error === 'no_commits' ? t('pce.ci.nothing', 'Nothing in that text looks like git log output.') : t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  const remove = async () => { try { await api.del(`/admin/projects/${slug}/activity-import`); setInfo(false); toast.success(t('pce.ci.removed', 'Import removed: GitHub statistics are used again.')); } catch { toast.error(t('common.failed', 'Failed.')); } };
  return (
    <div className="rounded-xl border border-[var(--line)] panel p-3 mb-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 text-start">
        <GitLogIcon size={15} className="text-[var(--accent-ink)] shrink-0" />
        <span className="text-sm font-medium flex-1">{t('pce.ci.title', 'Import commits (full history)')}</span>
        {info ? <Badge tone="green">{t('pce.ci.badge', '{n} commits · {d}').replace('{n}', info.total).replace('{d}', new Date(info.importedAt).toLocaleDateString())}</Badge> : info === false ? <Badge>{t('pce.ci.none', 'GitHub stats')}</Badge> : null}
        <span className="text-[11px] text-[var(--faint)]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-[12px] text-[var(--muted)]">{t('pce.ci.desc', 'GitHub’s statistics only cover the default branch and a rolling year, and nothing at all for a private repo. Run this in the repository and import the file — the Activity tab then reads the whole history (per day, per author, per year). Releases still come from GitHub.')}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 text-[11px] font-mono px-2.5 py-1.5 rounded-lg bg-[var(--bg-solid)] border border-[var(--line)] truncate" title={cmd}>{cmd}</code>
            <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard?.writeText(cmd); toast.success(t('common.copied', 'Copied.')); }}>{t('common.copy', 'Copy')}</Button>
          </div>
          <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-start">
            <Textarea rows={4} className="!text-[11px] font-mono" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('pce.ci.ph', 'Paste commits.txt here, or drop the file with the button →')} />
            <div className="flex sm:flex-col gap-2">
              <label className="cursor-pointer"><input type="file" accept=".txt,.log,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} /><span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--line)] text-sm hover:b-primary"><FileUp size={14} /> {t('pce.ci.file', 'Choose file')}</span></label>
              <Input className="!py-1.5 !text-sm sm:w-40" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('pce.ci.label', 'Label (e.g. main repo)')} />
              <Button size="sm" variant="primary" disabled={busy || !text.trim()} onClick={run}>{busy ? <Spinner /> : <><GitLogIcon size={14} /> {t('pce.ci.go', 'Import')}</>}</Button>
            </div>
          </div>
          {info && (
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-[var(--faint)]">
              <span>{t('pce.ci.current', 'Current import: {n} commits, {a} authors, {f} → {l}{lab}').replace('{n}', info.total).replace('{a}', info.authors).replace('{f}', info.first || '?').replace('{l}', info.last || '?').replace('{lab}', info.label ? ` · ${info.label}` : '')}</span>
              <button type="button" onClick={remove} className="inline-flex items-center gap-1 text-error hover:underline"><RemoveIcon size={11} /> {t('pce.ci.remove', 'Remove and use GitHub again')}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProjectConfigEditor({ value, onChange, slug, isShowcase }) {
  // Which studio page is open on its own surface, if any. A canvas is a page; editing one
  // inside a settings column meant designing at 1200px in 600px of room.
  const [studioAt, setStudioAt] = useState(null);
  const [tabAt, setTabAt] = useState(null);
  const navigate = useNavigate();
  /**
   * Open a canvas in the studio PAGE (/studio/:kind/:id/:index — pages/studio.jsx).
   *
   * The config this form holds may not be saved yet, so it is handed over through
   * sessionStorage and the page starts from it; the page then saves the whole config through
   * the same PUT this form's Save uses, with that one canvas replaced. When the form does not
   * know which page it edits (no `slug`), the old in-place modal is used instead — a studio
   * that cannot save is not an improvement on one that opens small.
   */
  const openStudio = (i) => {
    if (!slug) { setStudioAt(i); return; }
    const kind = isShowcase ? 'showcase' : 'project';
    try { sessionStorage.setItem(handoffKey(kind, slug), JSON.stringify({ config: c, name: slug, at: Date.now() })); }
    catch { /* no storage: the page fetches the saved config instead */ }
    navigate(studioPath(kind, slug, i));
  };
  // Who is allowed to turn the studio on. The SERVER is the authority (guardStudioFlag keeps
  // a grantee's flag out of the stored config whatever they send); this only decides whether
  // to draw a switch that would not work for them.
  const { user: me } = useAuth();
  const mayToggleStudio = !!me && ['ADMIN', 'SUPERADMIN'].includes(me.role);
  const toast = useToast(); const { t, lang } = useI18n();
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

  // The /dev hub is a landing page, not a project page: it has no downloads, no release notes
  // and no legal tab, and offering those was most of what its editor showed. It gets the
  // sections that match what it actually renders.
  if (slug === 'developers') {
    const hero = c.hero || {};
    const sections = c.sections || {};
    const cards = Array.isArray(c.cards) && c.cards.length ? c.cards : DEFAULT_DEV_CARDS;
    const usingDefaults = !Array.isArray(c.cards) || !c.cards.length;
    return (
      <div className="space-y-3">
        <Section icon={Eye} title={t('pce.header', "Header")} defaultOpen desc="Leave a field empty to keep the built-in wording.">
          <Field label={t('pce.title', "Title")}><Input value={hero.title || ''} onChange={(e) => setIn('hero', { title: e.target.value })} placeholder={t('pce.ph.build', "Build on BetterCommunity")} /></Field>
          <Field label={t('pce.intro', "Intro")}><Textarea rows={2} value={hero.body || ''} onChange={(e) => setIn('hero', { body: e.target.value })} placeholder={t('pce.ph.intro', "What somebody can build here, in a sentence or two.")} /></Field>
          <Field label={t('pce.smallprint', "Small print under the buttons")}><Input value={hero.note || ''} onChange={(e) => setIn('hero', { note: e.target.value })} placeholder="A key takes about a minute…" /></Field>
          <Field label={t('pce.cardhead', "Heading above the cards")}><Input value={hero.toolsTitle || ''} onChange={(e) => setIn('hero', { toolsTitle: e.target.value })} placeholder={t('pce.ph.everything', "Everything here")} /></Field>
          {/* The second hero button. It pointed at a fixed docs path, and a docs page is
              content — rename it and the developer landing page has a dead "API reference"
              on it that only a deploy could fix. */}
          <Field label={t('pce.reflabel', "Second button")}><Input value={hero.refLabel || ''} onChange={(e) => setIn('hero', { refLabel: e.target.value })} placeholder={t('pce.ph.ref', "API reference")} /></Field>
          <Field label={t('pce.refurl', "…and where it goes")}><Input value={hero.refUrl || ''} onChange={(e) => setIn('hero', { refUrl: e.target.value })} placeholder="/docs/bcweb-api" /></Field>
        </Section>

        {/* One switch under a heading that says "a whole block" was a promise the page did
            not keep: it renders four blocks and offered a switch for one of them. */}
        <Section icon={ListTodo} title={t('pce.blocks', "Blocks")} desc="Turn a whole block of the page off.">
          {[
            ['jobs', 'Show the “which of the two jobs is yours” pair'],
            // The OIDC discovery URL and the scope table. A site not running OIDC was
            // publishing a /.well-known address on its developer landing page anyway.
            ['discovery', 'Show the discovery URL and scopes'],
          ].map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={sections[k] !== false} onChange={(e) => setIn('sections', { [k]: e.target.checked })} />
              {label}
            </label>
          ))}
        </Section>

        <Section icon={Boxes} title={t('pce.cards', "Cards")} badge={cards.length} defaultOpen
          desc="What the page lists under the heading. Reorder by dragging.">
          {usingDefaults && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-[var(--line)] p-2 text-xs text-[var(--faint)]">
              <span>Showing the built-in cards. Editing one makes this page’s own list, and the built-ins stop applying.</span>
              <Button type="button" size="sm" onClick={() => set({ cards: DEFAULT_DEV_CARDS.map((x) => ({ ...x })) })}>{t('pce.startfromthese', "Start from these")}</Button>
            </div>
          )}
          {!usingDefaults && (
            <Repeatable items={c.cards} onChange={(v) => set({ cards: v })} addLabel="Add card" empty="No cards, the page will show none."
              add={() => ({ id: `card${c.cards.length + 1}`, icon: 'circle', title: 'New card', body: '', to: '', cta: 'Open' })}
              render={(card, patch) => (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <IconBtn value={card.icon} onChange={(v) => patch({ icon: v })} />
                    <Input className="flex-1" value={card.titleKey ? '' : (card.title || '')}
                      onChange={(e) => patch({ title: e.target.value, titleKey: undefined })}
                      placeholder={card.titleKey ? '(built-in wording, type to replace)' : 'Card title'} />
                  </div>
                  <Textarea rows={2} value={card.bodyKey ? '' : (card.body || '')}
                    onChange={(e) => patch({ body: e.target.value, bodyKey: undefined })}
                    placeholder={card.bodyKey ? '(built-in wording, type to replace)' : 'What it is for'} className="!text-sm" />
                  <div className="grid grid-cols-[1fr_140px] gap-2">
                    <Input value={card.to || ''} onChange={(e) => patch({ to: e.target.value })} placeholder="/dev/tools or https://…" className="!py-1.5 !text-sm" />
                    <Input value={card.ctaKey ? '' : (card.cta || '')} onChange={(e) => patch({ cta: e.target.value, ctaKey: undefined })} placeholder="Open" className="!py-1.5 !text-sm" />
                  </div>
                  <label className="flex items-center gap-2 text-[12px] text-[var(--muted)] cursor-pointer">
                    <input type="checkbox" checked={!!card.hidden} onChange={(e) => patch({ hidden: e.target.checked })} /> Hidden
                  </label>
                </div>
              )} />
          )}
        </Section>

        <Section icon={Link2} title={t('pce.links', "Links")}>
          <div className="grid sm:grid-cols-2 gap-3">
            {LINK_FIELDS.map(([k, label]) => (
              <Field key={k} label={label}><Input value={links[k] || ''} onChange={(e) => setIn('links', { [k]: e.target.value })} placeholder="https://…" /></Field>
            ))}
          </div>
          <Field label={t('pce.actbranch', 'Activity branch (optional)')} hint={t('pce.actbranch.h', 'The activity heatmap reads the repo’s default branch unless you name one here (e.g. dev). A pinned branch is read from its commits, so it shows a rolling ~year rather than all-time totals.')}>
            <Input value={c.activity?.branch || ''} onChange={(e) => setIn('activity', { branch: e.target.value.trim() })} placeholder="main" />
          </Field>
        </Section>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Basics */}
      <Section icon={Eye} title={t('pce.basics', "Basics")} defaultOpen>
        <Field label={t('pce.tagline', "Tagline")}><Input value={c.tagline || ''} onChange={(e) => set({ tagline: e.target.value })} placeholder={t('pce.ph.tagline', "One-line description shown under the title")} /></Field>
        <Field label={t('pce.version', "Version (optional)")}><Input value={c.version || ''} onChange={(e) => set({ version: e.target.value })} placeholder="1.4.0" /></Field>
      </Section>

      {/* Links */}
      <Section icon={Link2} title={t('pce.links', "Links")} badge={Object.values(links).filter(Boolean).length || null}>
        <div className="grid sm:grid-cols-2 gap-3">
          {LINK_FIELDS.map(([k, label]) => (
            <Field key={k} label={label}><Input value={links[k] || ''} onChange={(e) => setIn('links', { [k]: e.target.value })} placeholder="https://…" /></Field>
          ))}
        </div>
        <Field label={t('pce.actbranch', 'Activity branch (optional)')} hint={t('pce.actbranch.h', 'The activity heatmap reads the repo’s default branch unless you name one here (e.g. dev). A pinned branch is read from its commits, so it shows a rolling ~year rather than all-time totals.')}>
          <Input value={c.activity?.branch || ''} onChange={(e) => setIn('activity', { branch: e.target.value.trim() })} placeholder="main" />
        </Field>
        {/* Custom links — as many as you want, each its own button with a chosen
            icon (lucide / simple:brand) + label. (The old single customLabel/
            customUrl pair is auto-migrated into this list on first edit.) */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('pce.customlinks', "Custom links")}</div>
          <Repeatable items={customLinks} onChange={(v) => setIn('links', { custom: v, customLabel: undefined, customUrl: undefined })} addLabel="Add link" empty="No custom links yet."
            add={() => ({ icon: 'link', label: 'Docs', url: '' })}
            render={(it, patch) => (
              <div className="flex items-center gap-2">
                <IconBtn value={it.icon} onChange={(v) => patch({ icon: v })} />
                <Input className="!w-32" value={it.label || ''} onChange={(e) => patch({ label: e.target.value })} placeholder={t('pce.ph.label', "Label")} />
                <Input className="flex-1" value={it.url || ''} onChange={(e) => patch({ url: e.target.value })} placeholder="https://…" />
              </div>
            )} />
        </div>
      </Section>

      {/* Downloads */}
      <Section icon={Download} title={t('pce.downloads', "Downloads")} badge={downloads.length || null}>
        <Repeatable items={downloads} onChange={(v) => set({ downloads: v })} addLabel="Add download" empty="No download buttons yet."
          add={() => ({ label: 'Download', url: '', primary: downloads.length === 0 })}
          render={(it, patch) => (
            <div className="grid grid-cols-[auto_1fr_1.6fr_auto] gap-2 items-center">
              <IconBtn value={it.icon} onChange={(v) => patch({ icon: v })} />
              <Input value={it.label || ''} onChange={(e) => patch({ label: e.target.value })} placeholder={t('pce.ph.label', "Label")} />
              <Input value={it.url || ''} onChange={(e) => patch({ url: e.target.value })} placeholder="https://…" />
              <button type="button" onClick={() => patch({ primary: !it.primary })} title={t('pce.primarybtn', "Primary button")}
                className={`px-2 py-1.5 rounded-lg border text-xs flex items-center gap-1 ${it.primary ? 'border-[var(--primary)] text-[var(--accent-ink)]' : 'border-[var(--line)] text-[var(--faint)]'}`}>
                <Star size={12} className={it.primary ? 'fill-[var(--primary)]' : ''} /> Primary
              </button>
            </div>
          )} />
      </Section>

      {/* Overview media */}
      <Section icon={ImageIcon} title={t('pce.media', "Overview media")} desc="Shown at the top of the Overview tab. Use one, a video/replay wins over a still image.">
        <MediaField label={t('pce.cover', "Cover image")} value={ov.image} onChange={(v) => setIn('overview', { image: v })} accept="image/*" preview="image" />
        <MediaField label={t('pce.video', "Video (mp4/webm)")} value={ov.video} onChange={(v) => setIn('overview', { video: v })} accept="video/mp4,video/webm" preview="video" />
        <MediaField label="rrweb / BMM replay JSON" hint="Upload an rrweb or BMM recording (.json) or paste its URL, plays as a live in-app preview, shown right below." value={ov.replayUrl} onChange={(v) => setIn('overview', { replayUrl: v })} accept="application/json,.json" preview="replay" />
        <MediaField label="rrweb page URL (alternative)" value={ov.rrwebUrl} onChange={(v) => setIn('overview', { rrwebUrl: v })} accept="application/json,.json" />
      </Section>

      {/* Highlights — a headline counter + featured cards (update / video / live / announcement).
          This is the "more than a roadmap" part of the Overview. All stored in the free-form
          project config, so no schema change. */}
      <Section icon={Sparkles} title={t('pce.featured', 'Highlights')} desc="A headline number and featured cards on the Overview, updates, videos, live streams, announcements.">
        <div className="rounded-lg border border-[var(--line)] p-3">
          <label className="flex items-center gap-2 text-sm font-medium mb-2 cursor-pointer select-none">
            <input type="checkbox" className="accent-[var(--primary)]" checked={!!c.counter}
              onChange={(e) => set({ counter: e.target.checked ? { enabled: true, value: c.counter?.value || '', label: c.counter?.label || '', sub: c.counter?.sub || '' } : undefined })} />
            {t('pce.counter', 'Headline counter')}
          </label>
          {c.counter ? (() => {
            const kind = ['countdown', 'live', 'downloads'].includes(c.counter.kind) ? c.counter.kind : 'static';
            const setC = (patch) => set({ counter: { ...c.counter, ...patch } });
            return (
              <div className="space-y-2">
                {/* What KIND of counter: a fixed number, a live countdown to a date, a number
                    pulled from a URL, or the REAL count of download-button clicks on this page. */}
                <div className="flex flex-wrap rounded-lg border border-[var(--line)] overflow-hidden w-fit text-xs">
                  {[['static', t('pce.counter.k.static', 'Fixed')], ['countdown', t('pce.counter.k.countdown', 'Countdown')], ['live', t('pce.counter.k.live', 'Live URL')], ['downloads', t('pce.counter.k.downloads', 'Downloads')]].map(([v, lbl]) =>
                    <button key={v} type="button" onClick={() => setC({ kind: v })} className={`px-3 py-1.5 ${kind === v ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{lbl}</button>)}
                </div>
                {kind === 'downloads' && <p className="text-[10px] text-[var(--faint)]">{t('pce.counter.dl.h', 'Counts real clicks on this page’s download button(s). Starts at 0 and climbs as people download.')}</p>}
                <div className="grid sm:grid-cols-3 gap-2">
                  {kind === 'static' && <Field label={t('pce.counter.value', 'Big number / text')}><Input value={c.counter.value || ''} onChange={(e) => setC({ value: e.target.value })} placeholder="1,024" /></Field>}
                  {kind === 'countdown' && <Field label={t('pce.counter.target', 'Counts down to')}><Input type="datetime-local" value={c.counter.target || ''} onChange={(e) => setC({ target: e.target.value })} /></Field>}
                  {kind === 'countdown' && <Field label={t('pce.counter.done', 'When it reaches zero')}><Input value={c.counter.doneLabel || ''} onChange={(e) => setC({ doneLabel: e.target.value })} placeholder="🎉 It’s live!" /></Field>}
                  {kind === 'live' && <Field label={t('pce.counter.source', 'Number source (URL)')}><Input value={c.counter.source || ''} onChange={(e) => setC({ source: e.target.value })} placeholder="https://…/count.json or /projects/…" /></Field>}
                  {kind === 'live' && <Field label={t('pce.counter.fallback', 'Fallback while loading')}><Input value={c.counter.value || ''} onChange={(e) => setC({ value: e.target.value })} placeholder="—" /></Field>}
                  <Field label={t('pce.counter.label', 'Label')}><Input value={c.counter.label || ''} onChange={(e) => setC({ label: e.target.value })} placeholder="downloads" /></Field>
                  <Field label={t('pce.counter.sub', 'Sub-line (optional)')}><Input value={c.counter.sub || ''} onChange={(e) => setC({ sub: e.target.value })} placeholder="and counting" /></Field>
                </div>
                {kind === 'live' && <p className="text-[10px] text-[var(--faint)]">{t('pce.counter.live.h', 'The URL should return a number, or JSON with a value / count / downloads / total field. Refreshed every minute.')}</p>}
              </div>
            );
          })() : <p className="text-[11px] text-[var(--faint)]">{t('pce.counter.off', 'Off, a big headline number the Overview opens with (downloads, members, a live countdown…).')}</p>}
        </div>

        <div className="space-y-2">
          {(c.featured || []).map((f, i) => {
            const patch = (d) => set({ featured: (c.featured || []).map((x, n) => (n === i ? { ...x, ...d } : x)) });
            return (
              <div key={i} className="rounded-lg border border-[var(--line)] p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Select className="!w-auto" value={f.kind || 'update'} onChange={(e) => patch({ kind: e.target.value })}>
                    <option value="update">{t('pce.feat.k.update', 'Update')}</option>
                    <option value="video">{t('pce.feat.k.video', 'Video')}</option>
                    <option value="live">{t('pce.feat.k.live', 'Live')}</option>
                    <option value="message">{t('pce.feat.k.message', 'Announcement')}</option>
                  </Select>
                  <Input className="flex-1 min-w-[140px]" value={f.title || ''} onChange={(e) => patch({ title: e.target.value })} placeholder={t('pce.feat.title', 'Title')} />
                  <button type="button" onClick={() => set({ featured: (c.featured || []).filter((_, n) => n !== i) })} className="p-1.5 rounded-lg text-error hover:bg-error-bg" title={t('common.remove', 'Remove')}><Trash2 size={13} /></button>
                </div>
                {(f.kind === 'video' || f.kind === 'live') && (
                  <Input value={f.url || ''} onChange={(e) => patch({ url: e.target.value })}
                    placeholder={f.kind === 'live' ? 'https://twitch.tv/channel or a YouTube live URL' : 'YouTube URL, or an /api/media/… .mp4 link'} />
                )}
                <Textarea rows={2} value={f.body || ''} onChange={(e) => patch({ body: e.target.value })} placeholder={t('pce.feat.body', 'Body: Markdown, optional')} />
              </div>
            );
          })}
          {(c.featured || []).length < 8 && (
            <Button type="button" size="sm" variant="ghost" onClick={() => set({ featured: [...(c.featured || []), { kind: 'update', title: '', body: '', url: '' }] })}>
              <Plus size={13} /> {t('pce.feat.add', 'Add highlight')}
            </Button>
          )}
        </div>
      </Section>

      {/* Progress tracker */}
      <Section icon={ListTodo} title={t('pce.progress', "Progress tracker")} desc="Show a live roadmap on the Overview tab.">
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
              <div className="flex-1"><Field label="progress.json URL" hint="A raw URL, auto-refreshed and cached for 5 min. Save first, then Test."><Input value={c.progressSource || ''} onChange={(e) => set({ progressSource: e.target.value })} placeholder="https://raw.githubusercontent.com/…/progress.json" /></Field></div>
              <Button type="button" size="sm" onClick={testRemote}><Play size={13} /> {t('pce.testsaved', "Test saved")}</Button>
            </div>
          </div>
        )}

        {progMode === 'inline' && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Field label={t('pce.pctcode', "Code %")}><Input type="number" min={0} max={100} value={prog.code ?? 0} onChange={(e) => setProg({ code: Number(e.target.value) })} /></Field>
              <Field label={t('pce.pctart', "Art / visual %")}><Input type="number" min={0} max={100} value={prog.art ?? 0} onChange={(e) => setProg({ art: Number(e.target.value) })} /></Field>
              <Field label={t('pce.lastupdate', "Last update")}><Input value={prog.lastUpdate || ''} onChange={(e) => setProg({ lastUpdate: e.target.value })} placeholder={t('pce.ph.month', "Jul 2026")} /></Field>
            </div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">Categories</div>
            <Repeatable items={prog.categories || []} onChange={(v) => setProg({ categories: v })} addLabel="Add category" empty="No categories yet."
              add={() => ({ name: 'New category', items: [] })}
              render={(cat, patch) => (
                <div className="space-y-2">
                  <Input value={cat.name || ''} onChange={(e) => patch({ name: e.target.value })} placeholder={t('pce.ph.category', "Category name")} className="font-medium" />
                  <Repeatable items={cat.items || []} onChange={(v) => patch({ items: v })} addLabel="Add item" empty="No items."
                    add={() => ({ label: 'New item', status: 'planned', percent: 0 })}
                    render={(it, ipatch) => (
                      <div className="grid grid-cols-[1fr_120px_84px] gap-2 items-center">
                        <Input value={it.label || ''} onChange={(e) => ipatch({ label: e.target.value })} placeholder={t('pce.ph.item', "Item label")} />
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
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2 flex items-center gap-1.5"><Eye size={12} /> {t('pce.livepreview', "Live preview")}</div>
              <ProgressTracker data={prog} title={t('pce.progress2', "Progress")} lang="en" />
            </div>
          </div>
        )}
      </Section>

      {/* How it runs */}
      <Section icon={Network} title={t('pce.howruns', "How it runs")} desc="A diagram of the pieces this project is made of, shown on its own tab. It is a description you write — never the live infrastructure, which is admin-only for a reason." badge={stackNodes.length || null}>
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
          <Field label={t('pce.tabtitle', "Tab title")} hint="Defaults to “How it runs”."><Input value={stack.title || ''} onChange={(e) => setIn('stack', { title: e.target.value })} placeholder={t('pce.ph.howruns', "How it runs")} /></Field>
          <Field label={t('pce.introline', "Intro line (optional)")}><Input value={stack.note || ''} onChange={(e) => setIn('stack', { note: e.target.value })} placeholder="A short sentence above the diagram" /></Field>
          {/* Publishing a code map is a decision, not a default. It describes how somebody's
              repository is laid out, which files matter and what calls what — true of a public
              repository too, and nothing else here turns a detail public because a feature
              shipped. Off unless this is ticked; the page then loads it on demand. */}
          {!isShowcase && (
            <label className="flex items-start gap-2 text-[13px] mt-1">
              <input type="checkbox" className="mt-0.5" checked={stack.showCodeMap === true}
                onChange={(e) => setIn('stack', { showCodeMap: e.target.checked })} />
              <span>
                Show the code map on the page
                <span className="block text-[11px] text-[var(--faint)]">
                  Readers get the folders, the imports, the calls between languages and the
                  step-by-step of what runs — from the last snapshot the webhook stored. Nothing
                  is published until a repository has actually been read.
                </span>
              </span>
            </label>
          )}

          {/* What an admin can say ABOUT the map, and what they can keep out of it. The map
              itself is generated and must stay generated — nothing here edits a file, an
              import or a call, because the whole claim of the feature is that every line was
              read from the source. What is editable is the framing and the scope. */}
          {!isShowcase && stack.showCodeMap === true && (
            <div className="space-y-2 mt-2 ps-6">
              <Field label={t('pce.introcodemap', "Intro line for the code map (optional)")}
                hint="Your words, shown above the map. The standing explanation of what a code map is stays underneath it.">
                <Textarea rows={2} value={stack.codeMapNote || ''}
                  onChange={(e) => setIn('stack', { codeMapNote: e.target.value })}
                  placeholder="e.g. The front end never touches your files, every read goes through a Rust command." />
              </Field>
              <Field label={t('pce.excludepaths', "Paths to keep out of it")}
                hint="One per line. A folder takes everything under it. These are removed on the SERVER — they are not sent to the browser at all, so they cannot be read out of the response either. The page says how many were left out, never which.">
                <Textarea rows={3}
                  value={(stack.codeMapHide || []).join('\n')}
                  onChange={(e) => setIn('stack', { codeMapHide: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })}
                  placeholder={'src-tauri/target\nvendor/\ninternal/secrets.ts'} />
              </Field>
            </div>
          )}
        </div>

        <StackDetect
          onDraft={(d) => setIn('stack', { nodes: d.nodes, edges: d.edges })}
          hasExisting={stackNodes.length > 0}
        />

        {/* Below the one-off import: that reads a repo ONCE into this config, while this keeps a
            stored graph current on every push. Different jobs, and confusing them means somebody
            wonders why their diagram never changes. */}
        <CodeGraphSettings projectKey={slug} />

        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">Components</div>
        <Repeatable items={stackNodes} onChange={(v) => setIn('stack', { nodes: v })} addLabel="Add component" empty="No components yet."
          add={() => ({ id: `n${stackNodes.length + 1}`, label: 'New component', kind: 'app' })}
          render={(n, patch) => (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_120px] gap-2">
                <Input value={n.label || ''} onChange={(e) => patch({ label: e.target.value })} placeholder={t('pce.ph.piecename', "Name (e.g. API)")} className="font-medium" />
                <select value={n.kind || 'app'} onChange={(e) => patch({ kind: e.target.value })} className="input !py-1.5 !text-sm">
                  {STACK_KIND_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-[110px_1fr_100px] gap-2">
                <Input value={n.id || ''} onChange={(e) => patch({ id: e.target.value })} placeholder="id" className="!py-1.5 !text-xs font-mono" />
                <Input value={n.tech || ''} onChange={(e) => patch({ tech: e.target.value })} placeholder={t('pce.ph.builtwith', "Built with (Fastify, Postgres\u2026)")} className="!py-1.5 !text-sm" />
                <Input value={n.version || ''} onChange={(e) => patch({ version: e.target.value })} placeholder="version" className="!py-1.5 !text-sm" />
              </div>
              <Textarea rows={2} value={n.note || ''} onChange={(e) => patch({ note: e.target.value })} placeholder={t('pce.ph.piecedesc', "What this piece does, in a sentence or two.")} className="!text-sm" />
              <Input value={n.docs || ''} onChange={(e) => patch({ docs: e.target.value })} placeholder={t('pce.ph.docurl', "Documentation URL (optional)")} className="!py-1.5 !text-sm" />
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
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2 flex items-center gap-1.5"><Eye size={12} /> {t('pce.livepreview', "Live preview")}</div>
            <StackMap stack={stack} />
          </div>
        )}
      </Section>

      {/* Release notes */}
      <Section icon={ScrollText} title={t('pce.relnotes', "Release notes (GitHub)")} desc="Pulls .md files from a GitHub repo path, shown on the Release Notes tab.">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('pce.owner', "Owner")}><Input value={rn.owner || ''} onChange={(e) => setIn('releaseNotes', { owner: e.target.value })} placeholder="org-or-user" /></Field>
          <Field label="Repo"><Input value={rn.repo || ''} onChange={(e) => setIn('releaseNotes', { repo: e.target.value })} placeholder="my-repo" /></Field>
          <Field label={t('pce.branch', "Branch")}><Input value={rn.branch || ''} onChange={(e) => setIn('releaseNotes', { branch: e.target.value })} placeholder="main" /></Field>
          <Field label={t('pce.mdpath', "Path (folder of .md)")}><Input value={rn.path || ''} onChange={(e) => setIn('releaseNotes', { path: e.target.value })} placeholder="changelogs" /></Field>
        </div>
        {isShowcase && <p className="text-[11px] text-[var(--faint)]"><Github size={11} className="inline" /> Remember to enable the "Release notes" sub-tab in the project settings for this to show.</p>}
      </Section>

      {/* Community */}
      <Section icon={Users} title={t('pce.community', "Community")} badge={(contributors.length + messages.length) || null}>
        <Field label={t('pce.communitylink', "Community link (Discord/forum)")}><Input value={community.url || ''} onChange={(e) => setIn('community', { url: e.target.value })} placeholder="https://discord.gg/…" /></Field>

        {/* Contributors — build them right here (no external JSON needed). A URL
            still works as an alternative for teams that host their own list. */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">Contributors</div>
          <Repeatable items={contributors} onChange={(v) => setIn('community', { contributors: v })} addLabel="Add contributor" empty="No contributors yet, add them below, or use a JSON URL."
            add={() => ({ name: 'Name', role: '', category: 'contributors', pfp: '', description: '', links: {} })}
            render={(it, patch) => (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {it.pfp ? <img src={it.pfp} alt="" className="w-8 h-8 rounded-full object-cover border border-[var(--line)] shrink-0" /> : <span className="w-8 h-8 rounded-full bg-[var(--surface-2)] grid place-items-center text-xs shrink-0">{(it.name || '?')[0]}</span>}
                  <Input value={it.name || ''} onChange={(e) => patch({ name: e.target.value })} placeholder="Name" />
                  <Input value={it.role || ''} onChange={(e) => patch({ role: e.target.value })} placeholder="Role" className="!w-32" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input value={it.category || ''} onChange={(e) => patch({ category: e.target.value })} placeholder={t('pce.ph.contribcat', "Category (e.g. team, contributors)")} />
                  <MediaFieldInline value={it.pfp} onChange={(v) => patch({ pfp: v })} placeholder={t('pce.ph.avatar', "Avatar URL / upload")} accept="image/*" />
                </div>
                <Textarea rows={2} value={it.description || ''} onChange={(e) => patch({ description: e.target.value })} placeholder={t('pce.ph.bio', "Short bio (optional)")} />
                <div className="grid grid-cols-2 gap-2">
                  <Input value={it.links?.github || ''} onChange={(e) => patch({ links: { ...it.links, github: e.target.value } })} placeholder="GitHub URL" />
                  <Input value={it.links?.website || ''} onChange={(e) => patch({ links: { ...it.links, website: e.target.value } })} placeholder={t('pce.ph.website', "Website URL")} />
                </div>
              </div>
            )} />
        </div>

        {/* Community messages / ticker */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('pce.ticker', "Messages (ticker)")}</div>
          <Repeatable items={messages} onChange={(v) => setIn('community', { messages: v })} addLabel="Add message" empty="No messages."
            add={() => ({ from: '', text: '' })}
            render={(it, patch) => (
              <div className="grid grid-cols-[130px_1fr] gap-2">
                <Input value={it.from || ''} onChange={(e) => patch({ from: e.target.value })} placeholder="From" />
                <Input value={it.text || ''} onChange={(e) => patch({ text: e.target.value })} placeholder={t('pce.ph.message', "Message")} />
              </div>
            )} />
        </div>

        <details>
          <summary className="text-xs text-[var(--muted)] cursor-pointer">{t('pce.contribadv', "Advanced: load contributors from a JSON URL instead")}</summary>
          <div className="mt-2"><Field label={t('pce.contribjson', "Contributors JSON URL")} hint="Overrides the inline list above when set."><Input value={community.contributorsUrl || ''} onChange={(e) => setIn('community', { contributorsUrl: e.target.value })} placeholder="https://raw.githubusercontent.com/…/contributors.json" /></Field></div>
        </details>
      </Section>

      {/* Legal — object shape (fixed projects) vs card array (showcase) */}
      <Section icon={ShieldCheck} title={t('pce.legal', "Legal")} badge={legalIsArray ? (legalArr.length || null) : (Object.values(legalObj).filter(Boolean).length || null)}>
        {legalIsArray ? (
          <Repeatable items={legalArr} onChange={(v) => set({ legal: v })} addLabel="Add legal card" empty="No legal cards yet."
            add={() => ({ icon: 'shield', title: 'License', text: '', url: '' })}
            render={(it, patch) => (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <IconBtn value={it.icon} onChange={(v) => patch({ icon: v })} />
                  <Input value={it.title || ''} onChange={(e) => patch({ title: e.target.value })} placeholder={t('pce.ph.title', "Title")} />
                </div>
                <Textarea rows={2} value={it.text || ''} onChange={(e) => patch({ text: e.target.value })} placeholder={t('pce.ph.shortdesc', "Short description (optional)")} />
                <Input value={it.url || ''} onChange={(e) => patch({ url: e.target.value })} placeholder={t('pce.ph.linkurl', "Link URL (optional)")} />
              </div>
            )} />
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-[1fr_1.4fr] gap-3">
              <Field label={t('pce.licname', "License name")}><Input value={legalObj.license || ''} onChange={(e) => setLegalObj({ license: e.target.value })} placeholder="MIT" /></Field>
              <Field label={t('pce.licurl', "License URL")}><Input value={legalObj.licenseUrl || ''} onChange={(e) => setLegalObj({ licenseUrl: e.target.value })} placeholder="https://…/LICENSE" /></Field>
            </div>
            <Field label={t('pce.tosurl', "Terms of Use URL")}><Input value={legalObj.tos || ''} onChange={(e) => setLegalObj({ tos: e.target.value })} placeholder="https://…/terms" /></Field>
            <Field label={t('pce.privurl', "Privacy Policy URL")}><Input value={legalObj.privacy || ''} onChange={(e) => setLegalObj({ privacy: e.target.value })} placeholder="https://…/privacy" /></Field>
            <Field label="README URL"><Input value={legalObj.readme || ''} onChange={(e) => setLegalObj({ readme: e.target.value })} placeholder="https://…/README.md" /></Field>
            <button type="button" onClick={() => set({ legal: [] })} className="text-[11px] text-[var(--faint)] hover:text-[var(--text)] underline">{t('pce.legalcards', "Switch to card-style legal (advanced)")}</button>
          </div>
        )}
      </Section>

      {/* Timeline (Prmtp123 §8) — hand-written dated events, merged with GitHub releases on the
          Activity tab. Shown for every project kind. */}
      <Section icon={CalendarDays} title={t('pce.timeline', "Timeline")} badge={(c.timeline?.length) || null}
        desc="Dated events shown on the Activity tab, newest first, merged with GitHub releases. Use it for updates, announcements, milestones — anything not a git release.">
        {/* Pull the repo's GitHub releases in as editable entries (uses the GitHub link above).
            The Activity tab merges live release markers anyway; this is for annotating them. */}
        <div className="flex items-center justify-end mb-2">
          <Button size="sm" variant="ghost" disabled={!c.links?.github} title={!c.links?.github ? t('pce.tl.needgh', 'Set the GitHub link above first.') : undefined}
            onClick={async () => {
              try {
                const r = await api.post('/admin/projects/github-timeline', { github: c.links?.github });
                const existing = c.timeline || [];
                const have = new Set(existing.map((e) => `${e.date}|${(e.title || '').toLowerCase()}`));
                const add = (r.events || []).filter((e) => !have.has(`${e.date}|${(e.title || '').toLowerCase()}`));
                if (!add.length) { toast.success(t('pce.tl.none', 'No new releases to import.')); return; }
                set({ timeline: [...add, ...existing] });
                toast.success(t('pce.tl.imported', 'Imported {n} release(s).').replace('{n}', add.length));
              } catch (x) { toast.error(x?.data?.error === 'no_github' ? t('pce.tl.needgh', 'Set the GitHub link above first.') : t('common.failed', 'Failed.')); }
            }}>
            <Github size={13} /> {t('pce.tl.import', 'Import GitHub releases')}
          </Button>
        </div>
        {!isShowcase && slug && <CommitImport slug={slug} />}
        <Repeatable items={c.timeline || []} onChange={(v) => set({ timeline: v })} addLabel="Add event" empty="No timeline events yet."
          add={() => ({ kind: 'update', date: '', title: '', body: '', url: '' })}
          render={(it, patch) => (
            <div className="space-y-2">
              <div className="grid sm:grid-cols-[9rem_9rem_1fr] gap-2">
                <Field label={t('pce.tl.kind', "Kind")}>
                  <Select value={it.kind || 'update'} onChange={(e) => patch({ kind: e.target.value })}>
                    {['release', 'update', 'announcement', 'message', 'custom'].map((k) => <option key={k} value={k}>{t(`tl.kind.${k}`, k)}</option>)}
                  </Select>
                </Field>
                <Field label={t('pce.tl.date', "Date")}><Input type="date" value={it.date || ''} onChange={(e) => patch({ date: e.target.value })} /></Field>
                <Field label={t('pce.tl.title', "Title")}><Input value={it.title || ''} onChange={(e) => patch({ title: e.target.value })} placeholder={t('pce.ph.tltitle', "What happened")} /></Field>
              </div>
              <Field label={t('pce.tl.body', "Details (optional)")}><Textarea rows={2} value={it.body || ''} onChange={(e) => patch({ body: e.target.value })} /></Field>
              <Field label={t('pce.tl.url', "Link (optional)")}><Input value={it.url || ''} onChange={(e) => patch({ url: e.target.value })} placeholder="https://…" /></Field>
            </div>
          )}
        />
      </Section>

      {/* Blog limits — showcase ("Other Projects") pages only. Caps how much this page's
          own blog can hold; enforced when a new article is created (blog.mjs). 0 = off. */}
      {isShowcase && (
        <Section icon={ScrollText} title={t('pce.bloglimits', "Blog limits")} desc="Cap this page's own blog. New articles are refused once a limit is reached. Leave 0 for no limit.">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t('pce.maxarticles', "Max articles")}>
              <Input type="number" min={0} value={c.blogMaxPosts ?? ''} onChange={(e) => set({ blogMaxPosts: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} placeholder="0 = unlimited" />
            </Field>
            <Field label={t('pce.maxsize', "Max total size (KB)")} hint="Combined size of every article body (EN + FR).">
              <Input type="number" min={0} value={c.blogMaxKB ?? ''} onChange={(e) => set({ blogMaxKB: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} placeholder="0 = unlimited" />
            </Field>
          </div>
        </Section>
      )}

      {/* Custom tabs — every project page, fixed or showcase.
          The page offers eight tabs the platform knows how to build. This is the ninth onward:
          whatever this project needs and nobody anticipated — a title, an icon and a B.MD
          document, rendered by the same renderer as everything else. They are appended after
          the built-in tabs, so adding one never moves a tab somebody has already linked to. */}
      {(() => {
        const list = Array.isArray(c.customTabs) ? c.customTabs : [];
        const put = (next) => set({ customTabs: next });
        const patch = (i, p2) => put(list.map((x, n) => (n === i ? { ...x, ...p2 } : x)));
        const move = (i, d) => { const j = i + d; if (j < 0 || j >= list.length) return; const n = [...list]; [n[i], n[j]] = [n[j], n[i]]; put(n); };
        return (
          <Section icon={ListTodo} title={t('pce.ctabs', 'Custom tabs')} badge={list.length}
            desc="A tab of your own, written in B.MD. It appears after the built-in tabs. A tab with no title or no body is not shown at all.">
            <div className="space-y-3">
              {list.map((ct, i) => (
                <div key={ct.id || i} className="rounded-xl border border-[var(--line)] p-3 flex items-center gap-2 flex-wrap">
                  {/* An ICON. Every built-in tab has one; a custom tab passed `null` and sat in
                      the row looking like the odd one out — while the description above this
                      section had been promising "a title, an icon and a B.MD document" the
                      whole time. The field was simply never built. */}
                  <IconBtn value={ct.icon || ''} onChange={(name) => patch(i, { icon: name })} />
                  <Input className="flex-1 min-w-[140px]" value={ct.title || ''} onChange={(e) => patch(i, { title: e.target.value })} placeholder={t('pce.ctabs.title', 'Tab title')} />
                  <span className="text-[11px] text-[var(--faint)] tabular-nums whitespace-nowrap">
                    {t('pce.ctabs.n', '{n} char(s)').replace('{n}', (ct.body || '').length)}
                  </span>
                  {/* The body is B.MD — the same document language as the blog and the docs —
                      and it was edited in a five-row monospace box with no toolbar, no block
                      menu and no preview. It gets the real editor, on a surface with room. */}
                  <Button size="sm" variant="ghost" onClick={() => setTabAt(i)}><ListTodo size={13} /> {t('pce.ctabs.edit', 'Write it')}</Button>
                  <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} title={t('common.up', 'Up')}>↑</Button>
                  <Button size="sm" variant="ghost" disabled={i === list.length - 1} onClick={() => move(i, 1)} title={t('common.down', 'Down')}>↓</Button>
                  <Button size="sm" variant="ghost" className="!text-error" onClick={() => put(list.filter((_, n) => n !== i))} title={t('common.remove', 'Remove')}>×</Button>
                </div>
              ))}
              {tabAt != null && list[tabAt] && (
                <Modal open onClose={() => setTabAt(null)} icon={ListTodo} width="max-w-[96vw]"
                  title={list[tabAt].title || t('pce.ctabs.untitled', 'Untitled tab')}>
                  <MarkdownEditor value={list[tabAt].body || ''} onChange={(v) => patch(tabAt, { body: v })} full
                    placeholder={t('pce.ctabs.body', 'B.MD, the same blocks as the blog and the docs.')} />
                </Modal>
              )}
              <Button size="sm" onClick={() => put([...list, { id: `t${Date.now().toString(36)}`, title: '', body: '' }])}>
                + {t('pce.ctabs.add', 'Add a tab')}
              </Button>
            </div>
          </Section>
        );
      })()}

      {/* Studio pages — a tab laid out by hand instead of written top to bottom.
          Same "complete or not offered" rule as a custom tab: a canvas with no blocks is an
          empty plane, which reads as a broken tab rather than as a design choice, so the page
          does not offer it until something is on it. */}
      {(() => {
        const list = Array.isArray(c.canvases) ? c.canvases : [];
        const put = (next) => set({ canvases: next });
        const patch = (i, p2) => put(list.map((x, n) => (n === i ? { ...x, ...p2 } : x)));
        return (
          <Section icon={LayoutTemplate} title={t('pce.canvases', 'Studio pages')} badge={list.length}
            desc="Place blocks where you want them. Wide screens see the layout as you built it; narrow ones scale it down, and phones stack the blocks in reading order — use the phone button to see that before you publish.">
            <div className="space-y-4">
              {/* The switch, admins only. Off, the section says so and offers nothing: a page
                  builder half-available is worse than one that plainly is not. */}
              {mayToggleStudio ? (
                <label className="flex items-start gap-2.5 text-sm rounded-xl border border-[var(--line)] p-3 cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={c.studioEnabled === true}
                    onChange={(e) => set({ studioEnabled: e.target.checked })} />
                  <span>
                    <span className="font-medium">{t('pce.studio.on', 'Enable the studio for this page')}</span>
                    <span className="block text-[11px] text-[var(--faint)] mt-0.5">{t('pce.studio.on.h', 'Admins only. Off, the pages below are neither editable nor shown.')}</span>
                  </span>
                </label>
              ) : c.studioEnabled !== true ? (
                <p className="text-xs text-[var(--muted)]">{t('pce.studio.off', 'The studio is off for this page. An administrator can turn it on.')}</p>
              ) : null}
              {/* A ROW per page, and the studio opens on its own surface.
                  It used to render a full studio inline for every canvas at once: each one got
                  whatever width was left in a settings column — a page designed at 1200px,
                  edited at 600 — and several of them stacked made the form unnavigable. A
                  canvas is a page; it wants a page's worth of room. */}
              {c.studioEnabled === true && list.map((cv, i) => (
                <div key={cv.id || i} className="rounded-xl border border-[var(--line)] p-3 flex items-center gap-2 flex-wrap">
                  <Input className="flex-1 min-w-[140px]" value={cv.title || ''} onChange={(e) => patch(i, { title: e.target.value })} placeholder={t('pce.canvases.title', 'Tab title')} />
                  <span className="text-[11px] text-[var(--faint)] tabular-nums whitespace-nowrap">
                    {t('pce.canvases.n', '{n} block(s)').replace('{n}', (cv.blocks || []).length)}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => openStudio(i)}><LayoutTemplate size={13} /> {t('pce.canvases.edit', 'Open the studio')}</Button>
                  <Button size="sm" variant="ghost" className="!text-error" onClick={() => put(list.filter((_, n) => n !== i))} title={t('common.remove', 'Remove')}>×</Button>
                </div>
              ))}
              {studioAt != null && list[studioAt] && (
                <Modal open onClose={() => setStudioAt(null)} icon={LayoutTemplate} width="max-w-[96vw]"
                  title={list[studioAt].title || t('pce.canvases.untitled', 'Untitled page')}>
                  <CanvasStudio value={list[studioAt]} onChange={(next) => patch(studioAt, next)} />
                </Modal>
              )}
              {/* Start from something. A blank canvas is the worst thing to hand somebody who
                  has never used one — every preset is ordinary blocks the moment it lands. */}
              {c.studioEnabled === true && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-[var(--faint)]">{t('pce.canvases.start', 'Start from:')}</span>
                  {CANVAS_PRESETS.map((pr) => (
                    <Button key={pr.id} size="sm" variant="ghost"
                      onClick={() => put([...list, { id: `c${Date.now().toString(36)}`, title: '', blocks: presetBlocks(pr.id) }])}>
                      + {lang === 'fr' ? pr.nameFr : pr.name}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </Section>
        );
      })()}
    </div>
  );
}
