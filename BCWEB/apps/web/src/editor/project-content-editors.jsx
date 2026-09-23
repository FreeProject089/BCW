// The editors behind pages/project-content.jsx (PLAN-SEPT23 G2 + G3): a release entry, a docs
// or legal page, an import of a repository's markdown, and the GitHub address the release
// import asks for when the project names none. Loaded lazily: only an editor ever opens these.
//
// The server decides who may save (canEditProject / canEditShowcase behind 2FA); these screens
// only appear for somebody the server already said `canEdit` to.
import { useMemo, useState } from 'react';
import { BookOpen, Clock, Download, FileText, Github, Languages, Link2, Plus, Save, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Button, Input, Textarea, Modal, Dropdown, ByteSize, Spinner, useToast } from '../ui/ui.jsx';
import { EntryModal, EntryActions, EntryField, EntrySection, useDirtyForm } from '../ui/entry-modal.jsx';
import { MarkdownEditor } from './markdown-editor.jsx';

/** The site's languages, plus any language this entry is already written in. */
function useLangList(content) {
  const { locales } = useI18n();
  return useMemo(() => {
    const out = (locales || []).map((l) => ({ code: l.code, name: l.nativeName || l.code }));
    for (const c of Object.keys(content || {})) if (!out.some((l) => l.code === c)) out.push({ code: c, name: c.toUpperCase() });
    return out;
  }, [locales, content]);
}

/** One tab per language, marked when something is written in it. */
function LangRow({ langs, tab, onTab, filled }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-1 mb-3" role="tablist" aria-label={t('pcp.langs', 'Languages')}>
      {langs.map((l) => (
        <button key={l.code} type="button" role="tab" aria-selected={tab === l.code} onClick={() => onTab(l.code)}
          className={`px-2.5 py-1.5 rounded-lg text-sm flex items-center gap-1.5 border transition ${tab === l.code ? 'panel border-[var(--line)] font-medium' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}>
          <Languages size={13} /> {l.name}
          <span className={`w-1.5 h-1.5 rounded-full ${filled(l.code) ? 'bg-[var(--success,#16a34a)]' : 'bg-[var(--line-strong)]'}`} aria-hidden="true" />
          <span className="sr-only">{filled(l.code) ? t('pcp.lang.done', 'written') : t('pcp.lang.empty', 'empty')}</span>
        </button>
      ))}
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const lines = (s) => String(s || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
/** The first problem the server named, in words a person can act on. */
function issueText(t, x) {
  const d = x?.data || {};
  if (d.error === 'version_taken') return t('pcr.err.taken', 'Another entry already uses this version.');
  if (d.error === 'invalid_version') return t('pcr.err.version', 'A version is letters, digits, dots, hyphens or plus signs, 40 at most.');
  if (d.error === 'slug_taken') return t('pcp.err.slug', 'Another page of this project already uses this address.');
  if (d.error === 'conflict') return t('pcp.err.conflict', 'Somebody else saved this page meanwhile. Copy your text, close, reopen the page and apply it again.');
  if (d.error === 'limit') return t('pcp.err.limit', 'This project has reached its limit for these pages.');
  if (d.error === 'forbidden') return t('de.noperm', 'You don’t have permission.');
  if (d.error === 'invalid_input' && d.issues?.length) {
    const i = d.issues[0];
    if (/url|github|blog/.test(i.path)) return t('pcr.err.url', 'A link must be a full http(s) address, or /blog/<slug> for a post of this site.');
    if (/checksum/.test(i.path)) return t('pcr.err.checksum', 'A checksum is written sha256:<hex> (or sha512, sha1, md5).');
    return `${t('pcr.err.field', 'Check this field')}: ${i.path}`;
  }
  return t('be.failed', 'Failed.');
}

// ── A release entry ─────────────────────────────────────────────────────────────────────
function ReleaseEditor({ base, entry, onClose, onSaved }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  // A version that only had a page snapshot has no entry yet: saving it creates one.
  const isNew = !entry?.version || entry.snapshotOnly;
  const [f, setF] = useState(() => ({
    version: entry?.version || '',
    channel: entry?.channel || 'stable',
    date: entry?.date ? String(entry.date).slice(0, 10) : today(),
    published: entry?.published !== false,
    content: Object.fromEntries(Object.entries(entry?.content || {}).map(([l, e]) => [l, {
      title: e.title || '', highlights: (e.highlights || []).join('\n'), notes: e.notes || '', breaking: (e.breaking || []).join('\n'),
    }])),
    assets: (entry?.assets || []).map((a) => ({ label: a.label || '', url: a.url || '', size: a.size ?? null, checksum: a.checksum || '', platform: a.platform || '' })),
    links: { blog: entry?.links?.blog || '', github: entry?.links?.github || '' },
  }));
  const [tab, setTab] = useState(() => (entry?.content?.[lang] ? lang : 'en'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = useDirtyForm(f, 1);
  const langs = useLangList(f.content);
  const cur = f.content[tab] || { title: '', highlights: '', notes: '', breaking: '' };
  const setCur = (patch) => setF((s) => ({ ...s, content: { ...s.content, [tab]: { ...cur, ...patch } } }));
  const setAsset = (i, patch) => setF((s) => ({ ...s, assets: s.assets.map((a, j) => (j === i ? { ...a, ...patch } : a)) }));

  const save = async () => {
    const v = f.version.trim();
    if (!v) { setError(t('pcr.err.noversion', 'Give this entry a version.')); return; }
    const urlVersion = isNew ? v : entry.version;
    const content = {};
    for (const [l, e] of Object.entries(f.content)) content[l] = { title: e.title, highlights: lines(e.highlights), notes: e.notes, breaking: lines(e.breaking) };
    const body = {
      channel: f.channel, date: f.date || undefined, published: f.published, content,
      assets: f.assets.filter((a) => a.label.trim() && a.url.trim()).map((a) => ({
        label: a.label.trim(), url: a.url.trim(), size: Number.isFinite(a.size) && a.size > 0 ? a.size : null,
        checksum: a.checksum.trim() || null, platform: a.platform.trim() || null,
      })),
      links: { blog: f.links.blog.trim(), github: f.links.github.trim() },
      ...(!isNew && v !== entry.version ? { rename: v } : {}),
    };
    setBusy(true); setError('');
    try {
      await api.put(`${base}/changelog/${encodeURIComponent(urlVersion)}`, body);
      toast.success(t('pcr.saved', 'Version {v} saved.').replace('{v}', v));
      onSaved();
    } catch (x) { setError(issueText(t, x)); }
    finally { setBusy(false); }
  };

  const channels = [
    { value: 'stable', label: t('pcv.ch.stable', 'Stable') }, { value: 'beta', label: t('pcv.ch.beta', 'Beta') },
    { value: 'rc', label: t('pcv.ch.rc', 'Release candidate') }, { value: 'alpha', label: t('pcv.ch.alpha', 'Alpha') },
    { value: 'nightly', label: t('pcv.ch.nightly', 'Nightly') },
  ];

  return (
    <EntryModal title={isNew ? t('pcr.new', 'New version') : t('pcr.edit', 'Edit version {v}').replace('{v}', entry.version)} icon={Clock} width="max-w-3xl"
      dirty={dirty} busy={busy} onClose={onClose} onSave={save}
      footer={<EntryActions busy={busy} onSave={save} saveLabel={<><Save size={15} /> {t('common.save', 'Save')}</>}
        toggles={<label className="flex items-center gap-2 text-sm text-[var(--muted)] cursor-pointer">
          <input type="checkbox" checked={f.published} onChange={(e) => setF({ ...f, published: e.target.checked })} />
          {f.published ? t('de.published', 'Published') : t('de.draft', 'Draft')}
        </label>} />}>
      {error && <div role="alert" className="mb-3 text-sm text-error">{error}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <EntryField label={t('pcr.version', 'Version')}>
          <Input value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} placeholder="2.4.0" />
        </EntryField>
        <EntryField label={t('pcv.channel', 'Channel')}>
          <Dropdown value={f.channel} onChange={(v) => setF({ ...f, channel: v })} options={channels} />
        </EntryField>
        <EntryField label={t('pcr.date', 'Release date')}>
          <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </EntryField>
      </div>

      <LangRow langs={langs} tab={tab} onTab={setTab} filled={(c) => Object.values(f.content[c] || {}).some((x) => String(x || '').trim())} />
      <EntryField label={t('pcr.title', 'Title (optional)')}>
        <Input value={cur.title} onChange={(e) => setCur({ title: e.target.value })} placeholder={t('pcr.title.ph', 'The big spring update')} />
      </EntryField>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <EntryField label={t('pcr.highlights', 'Highlights, one per line')}>
          <Textarea rows={5} value={cur.highlights} onChange={(e) => setCur({ highlights: e.target.value })} />
        </EntryField>
        <EntryField label={t('pcr.breaking', 'Breaking changes, one per line')}>
          <Textarea rows={5} value={cur.breaking} onChange={(e) => setCur({ breaking: e.target.value })} />
        </EntryField>
      </div>
      <div className="mt-3">
        <div className="text-xs font-medium text-[var(--muted)] mb-1.5">{t('pcr.notes', 'Full notes')}</div>
        <MarkdownEditor full minHeight={200} value={cur.notes} onChange={(v) => setCur({ notes: v })}
          placeholder={t('pcr.notes.ph', 'Everything in this version, with content blocks if you like.')} />
      </div>

      <EntrySection icon={Download} title={t('pcr.assets', 'Downloads')} status={f.assets.length ? String(f.assets.length) : ''} defaultOpen={f.assets.length > 0}>
        {f.assets.map((a, i) => (
          <div key={i} className="rounded-lg border border-[var(--line)] p-2.5 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input value={a.label} onChange={(e) => setAsset(i, { label: e.target.value })} placeholder={t('pcr.asset.label', 'Name, e.g. Windows installer')} aria-label={t('pcr.asset.label', 'Name, e.g. Windows installer')} />
              <Input value={a.url} onChange={(e) => setAsset(i, { url: e.target.value })} placeholder="https://" aria-label={t('pcr.asset.url', 'Download address')} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr_0.8fr_auto] gap-2 items-center">
              <ByteSize value={a.size || 0} onChange={(b) => setAsset(i, { size: b })} aria-label={t('pcr.asset.size', 'Size')} />
              <Input value={a.checksum} onChange={(e) => setAsset(i, { checksum: e.target.value })} placeholder="sha256:…" className="!font-mono !text-xs" aria-label={t('pcr.asset.checksum', 'Checksum')} />
              <Input value={a.platform} onChange={(e) => setAsset(i, { platform: e.target.value })} placeholder={t('pcr.asset.platform', 'Platform')} aria-label={t('pcr.asset.platform', 'Platform')} />
              <Button size="sm" variant="ghost" className="!text-error" onClick={() => setF({ ...f, assets: f.assets.filter((_, j) => j !== i) })}
                title={t('pcr.asset.remove', 'Remove this file')} aria-label={t('pcr.asset.remove', 'Remove this file')}><Trash2 size={13} /></Button>
            </div>
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setF({ ...f, assets: [...f.assets, { label: '', url: '', size: null, checksum: '', platform: '' }] })}>
          <Plus size={13} /> {t('pcr.asset.add', 'Add a file')}
        </Button>
      </EntrySection>

      <EntrySection icon={Link2} title={t('pcr.links', 'Where it was announced')} status={[f.links.blog && t('pcv.blog', 'Announcement'), f.links.github && 'GitHub'].filter(Boolean).join(' · ')}>
        <EntryField label={t('pcr.link.blog', 'Blog post')} hint={t('pcr.link.blog.h', 'A post of this site (/blog/<slug>) or a full address.')}>
          <Input value={f.links.blog} onChange={(e) => setF({ ...f, links: { ...f.links, blog: e.target.value } })} placeholder="/blog/…" />
        </EntryField>
        <EntryField label={t('pcv.github', 'GitHub release')}>
          <Input value={f.links.github} onChange={(e) => setF({ ...f, links: { ...f.links, github: e.target.value } })} placeholder="https://github.com/…/releases/tag/…" />
        </EntryField>
      </EntrySection>
    </EntryModal>
  );
}

/** Asked only when the project has no GitHub link of its own. */
function GithubPrompt({ onClose, onGithub }) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  return (
    <Modal open onClose={onClose} title={t('pcv.import', 'Import from GitHub')} icon={Github}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
        <Button variant="primary" disabled={!/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(url.trim())} onClick={() => onGithub(url.trim())}><Github size={14} /> {t('pcv.import.go', 'Import')}</Button>
      </>}>
      <p className="text-sm text-[var(--muted)] mb-3">{t('pcv.import.ask', 'This project names no GitHub repository. Which one publishes its releases?')}</p>
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo" aria-label={t('pcv.import.url', 'Repository address')} />
    </Modal>
  );
}

// ── A docs or legal page ────────────────────────────────────────────────────────────────
function PageEditor({ base, kind, page, onClose, onSaved }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [f, setF] = useState(() => ({
    slug: page?.slug || '', icon: page?.icon || '', order: page?.order ?? 0, published: page ? page.published !== false : true,
    content: Object.fromEntries(Object.entries(page?.content || {}).map(([l, e]) => [l, { title: e.title || '', category: e.category || '', body: e.body || '' }])),
  }));
  const [tab, setTab] = useState(() => (page?.content?.[lang] ? lang : 'en'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = useDirtyForm(f, 1);
  const langs = useLangList(f.content);
  const cur = f.content[tab] || { title: '', category: '', body: '' };
  const setCur = (patch) => setF((s) => ({ ...s, content: { ...s.content, [tab]: { ...cur, ...patch } } }));

  // The legal pages a project usually needs, one click each on a new page.
  const PRESETS = kind === 'legal' && !page ? [
    ['privacy', t('pcp.p.privacy', 'Privacy policy'), 'Politique de confidentialité', 'Privacy policy'],
    ['terms', t('pcp.p.terms', 'Terms of use'), 'Conditions d’utilisation', 'Terms of use'],
    ['licence', t('pcp.p.licence', 'Licence'), 'Licence', 'Licence'],
    ['eula', t('pcp.p.eula', 'End-user licence agreement'), 'Contrat de licence utilisateur final', 'End-user licence agreement'],
    ['cookies', t('pcp.p.cookies', 'Cookies'), 'Cookies', 'Cookies'],
    ['notices', t('pcp.p.notices', 'Third-party notices'), 'Mentions des tiers', 'Third-party notices'],
  ] : [];

  const save = async () => {
    const hasTitle = Object.values(f.content).some((e) => e.title.trim());
    if (!hasTitle) { setError(t('pcp.err.title', 'Give this page a title, in at least one language.')); return; }
    const body = {
      ...(f.slug.trim() ? { slug: f.slug.trim() } : {}), icon: f.icon.trim() || null, order: Number(f.order) || 0, published: f.published,
      content: f.content, ...(page ? { baseVersion: page.version } : {}),
    };
    setBusy(true); setError('');
    try {
      const r = page
        ? await api.put(`${base}/pages/${kind}/${encodeURIComponent(page.slug)}`, body)
        : await api.post(`${base}/pages/${kind}`, body);
      toast.success(page ? t('de.pagesaved', 'Page saved.') : t('de.pagecreated', 'Page created.'));
      onSaved(r.page?.slug);
    } catch (x) { setError(issueText(t, x)); }
    finally { setBusy(false); }
  };

  return (
    <EntryModal title={page ? t('de.editpage', 'Edit page') : t('de.newpage', 'New page')} icon={kind === 'legal' ? ShieldCheck : BookOpen} width="max-w-3xl"
      dirty={dirty} busy={busy} onClose={onClose} onSave={save}
      footer={<EntryActions busy={busy} onSave={save} saveLabel={<><Save size={15} /> {t('de.save', 'Save')}</>}
        toggles={<label className="flex items-center gap-2 text-sm text-[var(--muted)] cursor-pointer">
          <input type="checkbox" checked={f.published} onChange={(e) => setF({ ...f, published: e.target.checked })} />
          {f.published ? t('de.published', 'Published') : t('de.draft', 'Draft')}
        </label>} />}>
      {error && <div role="alert" className="mb-3 text-sm text-error">{error}</div>}
      {PRESETS.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-[var(--muted)] mb-1.5">{t('pcp.presets', 'Start from a usual page')}</div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(([slug, label, fr, en]) => (
              <Button key={slug} size="sm" variant="ghost" onClick={() => setF((s) => ({
                ...s, slug, icon: 'shield',
                content: { ...s.content, en: { ...(s.content.en || { body: '', category: '' }), title: en }, fr: { ...(s.content.fr || { body: '', category: '' }), title: fr } },
              }))}><FileText size={13} /> {label}</Button>
            ))}
          </div>
        </div>
      )}
      <LangRow langs={langs} tab={tab} onTab={setTab} filled={(c) => Object.values(f.content[c] || {}).some((x) => String(x || '').trim())} />
      {tab !== 'en' && <div className="text-xs text-[var(--muted)] mb-3">{t('pcp.langnote', 'Every language is optional. A reader whose language is missing gets the English, marked as not translated.')}</div>}
      <EntryField label={t('dcs.title', 'Title')}>
        <Input className="!text-lg !font-semibold" value={cur.title} onChange={(e) => setCur({ title: e.target.value })} placeholder={t('dcs.ph.pagetitle', 'Page title')} />
      </EntryField>
      <div className="mt-3">
        <div className="text-xs font-medium text-[var(--muted)] mb-1.5">{t('de.content', 'Content')}</div>
        <MarkdownEditor full minHeight={280} value={cur.body} onChange={(v) => setCur({ body: v })}
          placeholder={t('de.ph.body', 'Write with content blocks, use the Blocks button.')} />
      </div>
      <EntrySection icon={BookOpen} title={t('pcp.sec.place', 'Address, place and icon')} status={[f.slug, kind === 'doc' && cur.category].filter(Boolean).join(' · ')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <EntryField label={t('pcp.slug', 'Address')} hint={t('pcp.slug.h', 'Lower-case letters, digits and hyphens. Left empty, it is made from the title.')}>
            <Input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} placeholder="getting-started" />
          </EntryField>
          {kind === 'doc' && (
            <EntryField label={t('dcs.category', 'Category')} hint={t('pcp.cat.h', '"Guides / Setup" nests the page under a subcategory.')}>
              <Input value={cur.category} onChange={(e) => setCur({ category: e.target.value })} placeholder={t('dcs.ph.cat', 'Guides / Setup')} />
            </EntryField>
          )}
          <EntryField label={t('de.icon', 'Icon')}>
            <Input value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} placeholder="book" />
          </EntryField>
          <EntryField label={t('dcs.order', 'Order')}>
            <Input type="number" value={f.order} onChange={(e) => setF({ ...f, order: e.target.value })} />
          </EntryField>
        </div>
      </EntrySection>
    </EntryModal>
  );
}

// ── Import a repository's markdown ──────────────────────────────────────────────────────
function ImportPages({ base, kind, onClose, onSaved }) {
  const { t, locales } = useI18n();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [asLang, setAsLang] = useState('en');
  const [publish, setPublish] = useState(false);
  const [drafts, setDrafts] = useState(null);
  const [pick, setPick] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const read = async () => {
    setBusy(true); setError(''); setDrafts(null);
    try {
      const r = await api.post(`${base}/pages/${kind}/import`, { url: url.trim() });
      setDrafts(r.drafts || []);
      setPick(new Set((r.drafts || []).map((_, i) => i)));
      if (r.truncated) toast.info(t('pci.truncated', 'Only the first {n} files were read.').replace('{n}', String((r.drafts || []).length)));
    } catch (x) {
      setError(x?.data?.error === 'unsupported_url'
        ? t('pci.err.url', 'Paste a GitHub address: a .md file, a folder, or the repository itself (its docs folder is read).')
        : t('pcv.import.fail', 'GitHub could not be read. Try again in a moment.'));
    } finally { setBusy(false); }
  };

  const create = async () => {
    setBusy(true);
    let ok = 0; let first = null;
    for (const [i, d] of (drafts || []).entries()) {
      if (!pick.has(i)) continue;
      try {
        const r = await api.post(`${base}/pages/${kind}`, {
          content: { [asLang]: { title: d.title, category: kind === 'doc' ? d.category : '', body: d.body } },
          published: publish, source: { url: d.url },
        });
        ok++; first = first || r.page?.slug;
      } catch { /* counted below */ }
    }
    setBusy(false);
    const failed = pick.size - ok;
    if (failed) toast.error(t('pci.partial', '{ok} page(s) created, {n} could not be.').replace('{ok}', String(ok)).replace('{n}', String(failed)));
    else toast.success(t('pci.done', '{n} page(s) created.').replace('{n}', String(ok)));
    onSaved(first);
  };

  return (
    <Modal open onClose={onClose} title={t('pcd.import', 'Import from a repository')} icon={Upload} width="max-w-2xl"
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel', 'Cancel')}</Button>
        {drafts?.length > 0 && <Button variant="primary" disabled={busy || !pick.size} onClick={create}>{busy ? <Spinner /> : <Plus size={14} />} {t('pci.create', 'Create {n} page(s)').replace('{n}', String(pick.size))}</Button>}
      </>}>
      <p className="text-sm text-[var(--muted)] mb-3">{t('pci.sub', 'Reads the markdown of a GitHub repository. Nothing is saved until you choose the pages to create.')}</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo/tree/main/docs" aria-label={t('pci.url', 'GitHub address')} className="flex-1" />
        <Button onClick={read} disabled={busy || !url.trim()}>{busy && !drafts ? <Spinner /> : <Github size={14} />} {t('pci.read', 'Read')}</Button>
      </div>
      {error && <div role="alert" className="mt-2 text-sm text-error">{error}</div>}
      {drafts && (
        drafts.length === 0 ? <div className="mt-4 text-sm text-[var(--faint)]">{t('pci.none', 'No markdown file found there.')}</div> : (
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <span className="text-xs text-[var(--muted)]">{t('pci.as', 'Language of these pages')}</span>
              <Dropdown value={asLang} onChange={setAsLang} options={(locales || []).map((l) => ({ value: l.code, label: l.nativeName || l.code }))} />
              <label className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)] cursor-pointer">
                <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> {t('pci.publish', 'Publish right away')}
              </label>
            </div>
            <div className="space-y-1 max-h-[40vh] overflow-auto scroll-thin">
              {drafts.map((d, i) => (
                <label key={d.path} className="flex items-start gap-2 rounded-lg border border-[var(--line)] px-3 py-2 cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={pick.has(i)} onChange={() => setPick((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate" title={d.title}>{d.title}</span>
                    <span className="block text-[11px] text-[var(--faint)] font-mono truncate" title={d.path}>{d.path}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )
      )}
    </Modal>
  );
}

export default function ProjectContentEditors({ mode, base, kind, entry, page, onClose, onSaved, onGithub }) {
  if (mode === 'release') return <ReleaseEditor base={base} entry={entry} onClose={onClose} onSaved={onSaved} />;
  if (mode === 'github') return <GithubPrompt onClose={onClose} onGithub={onGithub} />;
  if (mode === 'import') return <ImportPages base={base} kind={kind} onClose={onClose} onSaved={onSaved} />;
  return <PageEditor base={base} kind={kind} page={page} onClose={onClose} onSaved={onSaved} />;
}
