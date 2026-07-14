import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Upload, Boxes, Server, ArrowLeft, Wand2, FileJson, Layers, Rocket, ChevronDown, CheckCircle2, Package } from 'lucide-react';
import { PageHeader, Card, Button, Field, Input, Select, Textarea, Spinner, Badge, EmptyState } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import { useToast } from '../ui/ui.jsx';
import { useAuth } from './auth.jsx';
import { api, uploadPayload } from '../lib/api.js';

const KINDS = { bmm: ['APP', 'PLUGIN', 'THEME'], bsm: ['PRESET'] };
const KIND_LABEL = { APP: 'App', PLUGIN: 'Plugin', THEME: 'Theme', PRESET: 'Preset' };

// Minimal JSON textarea (mirrors the dashboard's editor) — used for the "advanced" panel.
function JsonBox({ value, onChange }) {
  return <Textarea value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false}
    className="font-mono text-xs !leading-relaxed" style={{ minHeight: 160 }} />;
}

// Detect a BMM-native catalog file (plugins[]/themes[]/apps[]) → bulk import.
function catalogEntries(json, projectKey) {
  const out = [];
  for (const pl of json.plugins || []) out.push({ kind: 'PLUGIN', name: pl.name || pl.id, version: pl.version || '1.0.0', description: pl.description || '', tags: pl.tags || [], meta: { download_url: pl.download_url || pl.url || '', game: pl.game || '', icon_url: pl.icon_url || null } });
  for (const th of json.themes || []) out.push({ kind: 'THEME', name: th.name || th.id, version: th.version || '1.0.0', description: th.description || '', tags: th.tags || [], meta: { download_url: th.url || th.download_url || '' } });
  for (const a of json.apps || []) out.push({ kind: 'APP', name: a.title || a.name || a.id, version: a.version || '1.0.0', description: a.description || '', tags: a.tags || [], meta: { download_url: a.download?.url || a.download_url || '', category: a.category || 'other' } });
  return out.filter((e) => e.name);
}

// ── Path 1: propose to the OFFICIAL catalog (free, moderated) ──
function OfficialSubmit({ onBack }) {
  const { t } = useI18n(); const toast = useToast(); const navigate = useNavigate();
  const [projectKey, setProjectKey] = useState('bmm');
  const [kind, setKind] = useState('APP');
  const [form, setForm] = useState({ name: '', version: '1.0.0', description: '' });
  const [file, setFile] = useState(null);
  const [meta, setMeta] = useState('{}');
  const [advanced, setAdvanced] = useState(false);
  const [bulk, setBulk] = useState(null); // { entries:[...] } when a catalog.json was dropped
  const [busy, setBusy] = useState(false);

  const kinds = KINDS[projectKey] || ['APP'];
  useEffect(() => { if (!kinds.includes(kind)) setKind(kinds[0]); }, [projectKey]); // eslint-disable-line

  const onFile = async (f) => {
    setFile(f); setBulk(null);
    if (!f) return;
    const lower = f.name.toLowerCase();
    try {
      if (lower.endsWith('.bmmplug') || lower.endsWith('.zip')) {
        // Plugin package (zip) — read plugin.json for prefill; the file is uploaded as payload.
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(await f.arrayBuffer());
        const mf = zip.file('plugin.json') || Object.values(zip.files).find((x) => x.name.endsWith('plugin.json'));
        if (mf) {
          const m = JSON.parse(await mf.async('string'));
          setKind('PLUGIN'); setForm((s) => ({ ...s, name: m.name || s.name, version: m.version || s.version, description: m.description || s.description }));
          setMeta(JSON.stringify({ game: m.game || '', download_url: '' }, null, 2));
          toast.success(t('sub2.parsed.plugin', 'Plugin manifest read — fields prefilled.'));
        }
      } else if (lower.endsWith('.json') || lower.endsWith('.bmmtheme')) {
        const json = JSON.parse(await f.text());
        const entries = catalogEntries(json, projectKey);
        if (entries.length > 0) {
          setBulk({ entries }); setFile(null);
          toast.success(t('sub2.parsed.catalog', 'Catalog file detected — {n} entries to propose.').replace('{n}', entries.length));
          return;
        }
        if (json.vars || json.id) { // a single theme object
          setKind('THEME'); setForm((s) => ({ ...s, name: json.name || s.name, version: json.version || s.version, description: json.description || s.description }));
          setMeta(JSON.stringify(json, null, 2)); toast.success(t('sub2.parsed.theme', 'Theme read — fields prefilled.'));
        } else if (kind === 'PRESET') {
          setForm((s) => ({ ...s, name: json.name || s.name, version: json.version || s.version })); setMeta(JSON.stringify(json, null, 2));
        }
      }
    } catch { toast.error(t('sub2.parsefail', "Couldn't read that file.")); }
  };

  const submitBulk = async () => {
    setBusy(true);
    try {
      const { solvePow } = await import('../lib/pow.js');
      const pow = await solvePow(() => api.get('/auth/pow'));
      const r = await api.post('/catalog/bulk', { projectKey, entries: bulk.entries, pow });
      toast.success(t('sub2.bulk.done', 'Proposed {n} items for review.').replace('{n}', r.created));
      navigate('/dashboard');
    } catch (x) {
      const e = x.data?.error;
      toast.error(e === 'too_many_pending' ? t('sub.toomanypending', 'You already have submissions awaiting review — wait for moderation.')
        : e === 'no_valid_entries' ? t('sub2.bulk.none', 'No entry had a usable download URL.')
        : e || t('repos.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  const submitOne = async () => {
    if (form.name.trim().length < 2) return toast.error(t('sub.namereq', 'Name is required.'));
    let metaObj = {}; try { metaObj = JSON.parse(meta || '{}'); } catch { return toast.error(t('sub.metajson', 'Meta must be valid JSON.')); }
    setBusy(true);
    try {
      const { solvePow } = await import('../lib/pow.js');
      const pow = await solvePow(() => api.get('/auth/pow'));
      let payloadKey; if (file) payloadKey = await uploadPayload(kind, file);
      const res = await api.post('/catalog', { projectKey, kind, name: form.name.trim(), version: form.version.trim() || '1.0.0', description: form.description.trim(), tags: [], meta: metaObj, payloadKey, payloadSize: file?.size, pow });
      if (res?.checkoutUrl) { window.location.href = res.checkoutUrl; return; }
      toast.success(t('sub.sent', 'Submitted for review.'));
      navigate('/dashboard');
    } catch (x) {
      const e = x.data?.error;
      toast.error(e === 'too_many_pending' ? t('sub.toomanypending', 'You already have submissions awaiting review — wait for moderation.')
        : e === 'free_tier_full' ? t('sub.freetierfull', 'Free hosting for catalog files is full right now — self-host and paste a URL instead.')
        : e === 'free_tier_already_used' ? t('sub.freeused', "You've used your one free hosted upload — self-host and paste a URL, or pay for hosting.")
        : e || x.message || t('repos.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1.5"><ArrowLeft size={14} /> {t('common.back', 'Back')}</button>

      {bulk ? (
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2"><Layers size={16} className="text-[var(--primary-2)]" /> <h2 className="font-semibold">{t('sub2.bulk.title', 'Bulk membership')}</h2></div>
          <p className="text-sm text-[var(--muted)] mb-3">{t('sub2.bulk.desc', 'This catalog file holds {n} entries. Each becomes its own proposal to the official catalog. Uncheck any you want to skip.').replace('{n}', bulk.entries.length)}</p>
          <div className="space-y-1.5 max-h-[46vh] overflow-y-auto mb-3">
            {bulk.entries.map((e, i) => (
              <label key={i} className="flex items-center gap-3 p-2.5 rounded-xl border border-[var(--line)] cursor-pointer">
                <input type="checkbox" checked={e._skip !== true} onChange={(ev) => setBulk((b) => ({ entries: b.entries.map((x, j) => j === i ? { ...x, _skip: !ev.target.checked } : x) }))} />
                <Badge tone="">{KIND_LABEL[e.kind]}</Badge>
                <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{e.name}</div><div className="text-xs text-[var(--faint)] truncate">{e.meta.download_url || t('sub2.nourl', 'no download URL — will be skipped')}</div></div>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setBulk(null)}>{t('common.cancel', 'Cancel')}</Button>
            <div className="flex-1" />
            <Button variant="primary" disabled={busy} onClick={() => { const entries = bulk.entries.filter((e) => e._skip !== true).map(({ _skip, ...e }) => e); if (!entries.length) return toast.error(t('sub2.bulk.pick', 'Pick at least one entry.')); setBulk({ entries }); submitBulk(); }}>{busy ? <Spinner /> : <><CheckCircle2 size={15} /> {t('sub2.bulk.submit', 'Propose all')}</>}</Button>
          </div>
        </Card>
      ) : (
        <Card className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('sub.project', 'Project')}><Select value={projectKey} onChange={(e) => setProjectKey(e.target.value)}><option value="bmm">BMM</option><option value="bsm">BSM</option></Select></Field>
            <Field label={t('sub.type', 'Type')}><Select value={kind} onChange={(e) => setKind(e.target.value)}>{kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select></Field>
            <Field label={t('sub.name', 'Name')}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label={t('sub.version', 'Version')}><Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></Field>
          </div>
          <Field label={t('sub.desc', 'Description')}><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label={t('sub2.file', 'File')} hint={t('sub2.filehint', 'Drop a .bmmplug, theme/preset .json, or a whole catalog.json for bulk import. Uploaded files are auto-parsed.')}>
            <Input type="file" onChange={(e) => onFile(e.target.files?.[0] || null)} /></Field>
          {file && <div className="text-xs text-[var(--faint)] flex items-center gap-1.5"><Package size={12} /> {file.name} ({(file.size / 1e6).toFixed(1)} MB)</div>}
          <div>
            <button type="button" onClick={() => setAdvanced((v) => !v)} className="text-xs text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1.5"><ChevronDown size={13} className={advanced ? 'rotate-180' : ''} /> {t('sub2.advanced', 'Advanced — edit metadata JSON')}</button>
            {advanced && <div className="mt-2"><div className="flex justify-end mb-1"><button type="button" onClick={() => setMeta(JSON.stringify(kind === 'APP' ? { category: 'other', price: 'free', download_url: '' } : kind === 'PLUGIN' ? { game: '', download_url: '' } : { name: form.name }, null, 2))} className="text-xs flex items-center gap-1 text-[var(--primary-2)]"><Wand2 size={12} /> {t('sub.gentmpl', 'Generate template')}</button></div><JsonBox value={meta} onChange={setMeta} /></div>}
          </div>
          <div className="flex justify-end pt-1"><Button variant="primary" disabled={busy} onClick={submitOne}>{busy ? <Spinner /> : <><Upload size={15} /> {t('sub.forreview', 'Submit for review')}</>}</Button></div>
        </Card>
      )}
    </div>
  );
}

// ── Path 2: host your OWN catalog (paid/mo for managed, free for raw) ──
function HostCatalog({ onBack }) {
  const { t } = useI18n(); const toast = useToast(); const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', description: '', visibility: 'public', mode: 'raw' });
  const [rawFile, setRawFile] = useState(null);
  const [rawJson, setRawJson] = useState(null);
  const [pools, setPools] = useState(null);
  const [groupId, setGroupId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/me/hosting/groups').then((r) => setPools(r.groups || [])).catch(() => setPools([])); }, []);

  const onRaw = async (f) => {
    setRawFile(f); setRawJson(null);
    if (!f) return;
    try { const j = JSON.parse(await f.text()); if (!(j.plugins || j.themes || j.apps)) throw 0; setRawJson(j); toast.success(t('sub2.raw.ok', 'Catalog feed read.')); }
    catch { toast.error(t('sub2.raw.bad', 'Not a valid BMM catalog.json (needs plugins/themes/apps).')); }
  };

  const create = async () => {
    if (form.name.trim().length < 2) return toast.error(t('sub2.catname', 'A catalog name is required.'));
    setBusy(true);
    try {
      const body = { name: form.name.trim(), description: form.description.trim(), mode: form.mode, visibility: form.visibility };
      if (form.mode === 'raw') { if (!rawJson) { setBusy(false); return toast.error(t('sub2.raw.need', 'Upload your catalog.json first.')); } body.rawJson = rawJson; }
      else { if (!groupId) { setBusy(false); return toast.error(t('sub2.pool.need', 'Pick a storage pool (or buy one on the Hosting page).')); } body.groupId = groupId; }
      const r = await api.post('/me/catalogs', body);
      toast.success(t('sub2.created', 'Catalog created.'));
      navigate('/dashboard');
    } catch (x) {
      const e = x.data?.error;
      toast.error(e === 'managed_needs_pool' ? t('sub2.pool.need', 'Pick a storage pool first.')
        : e === 'not_your_pool' ? t('sub2.pool.notyours', "That pool isn't yours.")
        : e || t('repos.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1.5"><ArrowLeft size={14} /> {t('common.back', 'Back')}</button>
      <Card className="p-5 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('sub2.catname.l', 'Catalog name')}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My Server Plugins" /></Field>
          <Field label={t('sub2.visibility', 'Visibility')}><Select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}><option value="public">{t('sub2.public', 'Public (listed)')}</option><option value="private">{t('sub2.private', 'Private (invite only)')}</option></Select></Field>
        </div>
        <Field label={t('sub.desc', 'Description')}><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>

        <Field label={t('sub2.mode', 'Hosting mode')}>
          <div className="grid sm:grid-cols-2 gap-2">
            {[['raw', FileJson, t('sub2.mode.raw', 'Just my catalog.json'), t('sub2.mode.raw.d', 'Downloads stay on your own links. Free.')],
              ['managed', Rocket, t('sub2.mode.managed', 'Host files with us'), t('sub2.mode.managed.d', 'Upload items + files into a storage pool. Paid by size.')]].map(([m, Icon, label, desc]) => (
              <button key={m} type="button" onClick={() => setForm({ ...form, mode: m })} className={`text-left p-3 rounded-xl border transition ${form.mode === m ? 'border-[var(--primary)] bg-[var(--primary)]/5' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
                <div className="flex items-center gap-2 font-medium text-sm"><Icon size={15} className="text-[var(--primary-2)]" /> {label}</div>
                <div className="text-xs text-[var(--faint)] mt-0.5">{desc}</div>
              </button>
            ))}
          </div>
        </Field>

        {form.mode === 'raw' ? (
          <Field label={t('sub2.raw.file', 'Your catalog.json')} hint={t('sub2.raw.hint', 'The BMM-native feed you exported from BMM (plugins/themes/apps).')}>
            <Input type="file" accept=".json,application/json" onChange={(e) => onRaw(e.target.files?.[0] || null)} />
            {rawJson && <div className="text-xs text-emerald-400 mt-1 flex items-center gap-1.5"><CheckCircle2 size={12} /> {t('sub2.raw.entries', '{n} entries').replace('{n}', (rawJson.plugins || rawJson.themes || rawJson.apps || []).length)}</div>}
          </Field>
        ) : (
          <Field label={t('sub2.pool', 'Storage pool')} hint={t('sub2.pool.hint', 'A managed catalog draws from a storage pool — the same space your repos use.')}>
            {pools == null ? <Spinner /> : pools.length === 0 ? (
              <div className="text-sm text-[var(--muted)]">{t('sub2.pool.none', 'You have no storage pool yet.')} <Link to="/hosting" className="text-[var(--primary-2)] underline">{t('sub2.pool.buy', 'Get one on the Hosting page')}</Link>.</div>
            ) : (
              <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">{t('sub2.pool.choose', 'Choose a pool…')}</option>
                {pools.map((g) => <option key={g.id} value={g.id}>{g.name} — {((g.poolBytes - g.usedBytes) / 1e9).toFixed(1)} GB free</option>)}
              </Select>
            )}
          </Field>
        )}
        <div className="flex justify-end pt-1"><Button variant="primary" disabled={busy} onClick={create}>{busy ? <Spinner /> : <><Server size={15} /> {t('sub2.create', 'Create catalog')}</>}</Button></div>
      </Card>
    </div>
  );
}

export function Submit() {
  const { t } = useI18n(); const { user } = useAuth();
  const [path, setPath] = useState(null);

  if (!user) return (
    <div className="max-w-2xl mx-auto">
      <PageHeader icon={Upload} title={t('sub.title', 'Submit content')} />
      <Card className="p-6 text-center"><p className="text-sm text-[var(--muted)] mb-3">{t('sub2.signin', 'Sign in to submit content or host a catalog.')}</p><Link to="/auth"><Button variant="primary">{t('nav.signin', 'Sign in')}</Button></Link></Card>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader icon={Upload} title={t('sub.title', 'Submit content')} subtitle={t('sub2.sub', 'Propose to the official catalog, or host your own.')} />
      {path === 'official' ? <OfficialSubmit onBack={() => setPath(null)} />
        : path === 'host' ? <HostCatalog onBack={() => setPath(null)} />
        : (
          <div className="grid sm:grid-cols-2 gap-3">
            <button onClick={() => setPath('official')} className="text-left p-5 rounded-2xl border border-[var(--line)] hover:border-[var(--primary)] transition">
              <div className="w-11 h-11 rounded-xl bg-[var(--primary)]/10 grid place-items-center mb-3"><Boxes size={20} className="text-[var(--primary-2)]" /></div>
              <div className="font-semibold">{t('sub2.official', 'Propose to the official catalog')}</div>
              <div className="text-sm text-[var(--muted)] mt-1">{t('sub2.official.d', 'Submit a plugin, theme, app or preset. Free, reviewed by our team. You can bulk-import a whole catalog.json.')}</div>
            </button>
            <button onClick={() => setPath('host')} className="text-left p-5 rounded-2xl border border-[var(--line)] hover:border-[var(--primary)] transition">
              <div className="w-11 h-11 rounded-xl bg-emerald-500/10 grid place-items-center mb-3"><Server size={20} className="text-emerald-400" /></div>
              <div className="font-semibold">{t('sub2.host', 'Host my own catalog')}</div>
              <div className="text-sm text-[var(--muted)] mt-1">{t('sub2.host.d', 'Publish and manage your own catalog. Free if you self-host the downloads, or paid to host the files with us.')}</div>
            </button>
          </div>
        )}
    </div>
  );
}
