import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  Boxes, Download, Search, XCircle, Package, Inbox, Tag, FileJson, Eye, Lock, Users, Copy, BadgeCheck,
} from 'lucide-react';
import { Button, Card, Badge, Input, Select, PageHeader, EmptyState, Modal, useToast } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAsync, Loading, KIND_ICON, KIND_LABEL } from './pages.jsx';

/* ─────────────────────────  Catalog  ───────────────────────── */
const SORTS = [['recent', 'Newest'], ['popular', 'Most popular'], ['month', 'Popular this month'], ['views', 'Most viewed']];
export function Catalog() {
  const toast = useToast(); const { t } = useI18n();
  const [sp, setSp] = useSearchParams();
  const project = sp.get('project') || '', kind = sp.get('kind') || '', q = sp.get('q') || '', sort = sp.get('sort') || 'recent';
  const { data, loading } = useAsync(() => api.get(`/catalog?${new URLSearchParams({ project, kind, q, sort })}`), [project, kind, q, sort]);
  const set = (k, v) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n); };
  const [sel, setSel] = useState(new Set());
  const items = data?.items || [];
  // Multi-select download makes sense for presets (small JSON files).
  const multi = project === 'bsm' || kind === 'PRESET';
  const toggle = (slug) => setSel((s) => { const n = new Set(s); n.has(slug) ? n.delete(slug) : n.add(slug); return n; });
  const downloadSelected = async () => {
    try {
      const { files } = await api.post('/catalog/downloads', { slugs: [...sel] });
      files.forEach((f, i) => setTimeout(() => { const a = document.createElement('a'); a.href = f.url; a.download = `${f.name || f.slug}.json`; document.body.appendChild(a); a.click(); a.remove(); }, i * 350));
      toast.success(t('cat.downloading', 'Downloading {n} preset(s)…').replace('{n}', files.length)); setSel(new Set());
    } catch { toast.error(t('cat.dlfail', 'Download failed.')); }
  };
  return (
    <div>
      <PageHeader icon={Package} title={`${t('cat.title', 'Catalog')}${project ? ` · ${project.toUpperCase()}` : ''}`} subtitle={t('cat.sub', 'Community apps, plugins, themes and presets.')} />
      {/* Filter bar: project switcher · search · kind pills · sort — grouped into one
          tidy card instead of a loose flex row. */}
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)]/40 p-3 mb-5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {[['', t('cat.allprojects', 'All')], ['bmm', 'BMM'], ['bsm', 'BSM']].map(([pk, l]) => (
            <button key={pk} onClick={() => { set('project', pk); if (kind) set('kind', ''); }} className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${project === pk ? 'bg-gradient-to-br from-brand to-brand-2 text-white shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{l}</button>
          ))}
          <div className="flex-1" />
          <Select className="!w-auto" value={sort} onChange={(e) => set('sort', e.target.value)}>{SORTS.map(([v, l]) => <option key={v} value={v}>{t(`cat.sort.${v}`, l)}</option>)}</Select>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
            <Input className="!pl-9" placeholder={t('cat.search', 'Search mods, plugins, themes & presets…')} defaultValue={q} onKeyDown={(e) => e.key === 'Enter' && set('q', e.target.value)} />
          </div>
          {/* Kinds are project-scoped: presets are a BSM thing; BMM has apps/plugins/themes. */}
          <div className="flex gap-1.5 flex-wrap">
            {(project === 'bsm' ? ['', 'PRESET'] : project === 'bmm' ? ['', 'APP', 'PLUGIN', 'THEME'] : ['', 'APP', 'PLUGIN', 'THEME', 'PRESET']).map((k) => {
              const I = k ? (KIND_ICON[k] || Package) : Package;
              return <button key={k} onClick={() => set('kind', k)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition ${kind === k ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary-2)] font-medium' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--line-strong)]'}`}><I size={14} /> {k ? (KIND_LABEL[k] || k) : t('cat.all', 'All')}</button>;
            })}
          </div>
        </div>
      </div>
      {multi && sel.size > 0 && (
        <div className="flex items-center gap-3 mb-4 p-3 rounded-xl border border-[var(--primary)] bg-orange-500/5">
          <span className="text-sm font-medium">{t('cat.selected', '{n} selected').replace('{n}', sel.size)}</span>
          <Button size="sm" variant="primary" onClick={downloadSelected}><Download size={14} /> {t('cat.dlsel', 'Download selected')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>{t('cat.clear', 'Clear')}</Button>
        </div>
      )}
      {loading ? <Loading /> : (items.length ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((it) => { const I = KIND_ICON[it.kind] || Package; const checked = sel.has(it.slug); return (
            <div key={it.id} className="relative">
              {multi && it.payloadKey !== null && (
                <label className="absolute top-3 left-3 z-10" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(it.slug)} className="w-4 h-4 accent-[var(--primary)] cursor-pointer" />
                </label>
              )}
              <Link to={`/item/${it.slug}`}><Card hover className={`p-5 h-full ${checked ? 'border-[var(--primary)]' : ''}`}>
                <div className="flex items-center justify-between"><div className={`grid place-items-center w-9 h-9 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] ${multi ? 'ml-6' : ''}`}><I size={17} className="text-[var(--primary-2)]" /></div><Badge>v{it.version}</Badge></div>
                <div className="font-semibold mt-3">{it.name}</div>
                <div className="text-sm text-[var(--muted)] mt-1 line-clamp-2">{it.description || t('cat.nodesc', 'No description.')}</div>
                <div className="text-xs text-[var(--faint)] mt-3 flex items-center gap-3 flex-wrap">
                  <span className="flex items-center gap-1"><Users size={12} /> {it.owner?.displayName}</span>
                  <span className="flex items-center gap-1"><Eye size={12} /> {it.views ?? 0}</span>
                  <span className="flex items-center gap-1"><Download size={12} /> {it.downloads ?? 0}{it.monthDownloads != null ? ` (${it.monthDownloads}/mo)` : ''}</span>
                </div>
              </Card></Link>
            </div>); })}
        </div>
      ) : <EmptyState icon={Inbox} title={t('cat.empty.t', 'Nothing here yet')} sub={t('cat.empty.s', 'Be the first to publish to this catalog.')} />)}
      <CommunityCatalogsStrip />
    </div>
  );
}

// A strip of community-hosted catalogs under the official grid — separate from the
// trusted official items (different trust level), each linking to its /c/:slug page.
function CommunityCatalogsStrip() {
  const { t } = useI18n();
  const { data } = useAsync(() => api.get('/c'), []);
  const cats = data?.catalogs || [];
  if (!cats.length) return null;
  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="font-semibold flex items-center gap-2"><Boxes size={16} className="text-[var(--primary-2)]" /> {t('cc.pub.title', 'Community catalogs')}</h2>
        <Badge tone="">{cats.length}</Badge>
      </div>
      <p className="text-sm text-[var(--muted)] mb-3">{t('cc.pub.desc', 'Catalogs hosted by community members — added directly in BMM as a source. Unverified; add at your own discretion.')}</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cats.map((c) => (
          <Link key={c.id} to={`/c/${c.slug}`}><Card hover className="p-4 h-full">
            <div className="flex items-center justify-between"><div className="grid place-items-center w-9 h-9 rounded-lg bg-success-bg border border-[var(--line)]"><Boxes size={17} className="text-success" /></div><Badge tone="">{c.itemCount} {t('cc.items', 'items')}</Badge></div>
            <div className="font-semibold mt-3">{c.name}</div>
            <div className="text-sm text-[var(--muted)] mt-1 line-clamp-2">{c.description || t('cat.nodesc', 'No description.')}</div>
            <div className="text-xs text-[var(--faint)] mt-3 flex items-center gap-3"><span className="flex items-center gap-1"><Users size={12} /> {c.owner}</span><span className="flex items-center gap-1"><Download size={12} /> {c.downloads ?? 0}</span></div>
          </Card></Link>
        ))}
      </div>
    </div>
  );
}

export function ItemDetail() {
  const { slug } = useParams();
  const [sp] = useSearchParams();
  const toast = useToast(); const { t } = useI18n();
  // A private/unlisted item is reachable only with its share key (?k=…) — carry it
  // through to the detail + download calls so the owner's shared link works end-to-end.
  const key = sp.get('k');
  const kq = key ? `?k=${encodeURIComponent(key)}` : '';
  const { data, loading, err } = useAsync(() => api.get(`/catalog/${slug}${kq}`), [slug, kq]);
  const [warn, setWarn] = useState(false);
  if (loading) return <Loading />;
  if (err) return <EmptyState icon={XCircle} title={t('item.notfound', 'Not found')} />;
  const it = data.item; const I = KIND_ICON[it.kind] || Package;
  const v = it.kind === 'PLUGIN' ? it.meta?.validation : null; // { valid, reason, sha256, files }
  const doDownload = async () => { try { const { url } = await api.get(`/catalog/${slug}/download${kq}`); window.open(url, '_blank'); } catch { toast.error(t('cat.dlfail', 'Download failed.')); } };
  // Invalid plugins pop a warning first; the user must confirm to proceed.
  const download = () => { if (v && v.valid === false) return setWarn(true); doDownload(); };
  // BMM installs APP/PLUGIN/THEME via a bmm://catalog/<kind>/install deeplink (handled
  // in BMM's deep_link_manager). Resolve a real download URL, then fire the deeplink.
  const bmmInstallable = ['APP', 'PLUGIN', 'THEME'].includes(it.kind) && (it.payloadKey || it.meta?.download_url || it.meta?.download?.url);
  const openInBmm = async () => {
    let url = it.meta?.download_url || it.meta?.download?.url;
    if (!url && it.payloadKey) { try { const r = await api.get(`/catalog/${slug}/download${kq}`); url = r.url; } catch {} }
    if (!url) return toast.error(t('item.nourl', 'No download URL for this item.'));
    const type = it.kind === 'APP' ? (it.meta?.download?.file_type || 'exe') : '';
    const dl = `bmm://catalog/${it.kind.toLowerCase()}/install?name=${encodeURIComponent(it.name)}&url=${encodeURIComponent(url)}${type ? `&type=${type}` : ''}`;
    window.location.href = dl;
  };
  return (
    <div className="max-w-3xl">
      {it.private && (
        <Card className="p-3.5 mb-5 flex items-center gap-2.5 bg-warning-bg border-warning-border">
          <Lock size={17} className="text-warning shrink-0" />
          <div className="text-sm"><b>{t('item.private.t', 'Private — not listed publicly')}</b> <span className="text-[var(--muted)]">{t('item.private.d', 'This item isn’t in the public catalog yet. Only people with this direct link can see it; it’ll be listed once an admin validates it.')}</span></div>
        </Card>
      )}
      {v && (
        <Card className={`p-3.5 mb-5 flex items-center gap-2.5 ${v.valid ? 'bg-success-bg' : 'bg-error-bg border-error-border'}`}>
          {v.valid ? <BadgeCheck size={18} className="text-success shrink-0" /> : <XCircle size={18} className="text-error shrink-0" />}
          <div className="flex-1 text-sm">
            {v.valid ? <><b className="text-success">{t('item.verified', 'Verified plugin')}</b> {t('item.verified.d', '— package and file checksums match.')}</>
              : <><b className="text-error">{t('item.invalid', 'Invalid checksum')}</b> {t('item.invalid.d', '— this .bmmplug failed integrity checks ({reason}). Installing is not recommended.').replace('{reason}', v.reason)}</>}
          </div>
          {v.sha256 && <code className="text-[10px] text-[var(--faint)] hidden sm:block">{v.sha256.slice(0, 12)}…</code>}
        </Card>
      )}
      <div className="flex items-start gap-4">
        <div className="grid place-items-center w-14 h-14 rounded-2xl bg-[var(--surface-2)] border border-[var(--line)]"><I size={26} className="text-[var(--primary-2)]" /></div>
        <div className="flex-1">
          <div className="flex items-center gap-2"><Badge tone="primary">{it.kind}</Badge><Badge>v{it.version}</Badge></div>
          <h1 className="text-2xl font-bold mt-2">{it.name}</h1>
          <div className="text-sm text-[var(--faint)] mt-1 flex items-center gap-4 flex-wrap">
            <span className="flex items-center gap-1"><Users size={13} /> {it.owner?.displayName}</span>
            <span className="flex items-center gap-1"><Eye size={13} /> {it.views ?? 0} {t('item.views', 'views')}</span>
            <span className="flex items-center gap-1"><Download size={13} /> {it.downloads ?? 0} {t('item.downloads', 'downloads')}</span>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          {bmmInstallable && <Button variant="primary" onClick={openInBmm}><Boxes size={16} /> {t('repos.openbmm', 'Open in BMM')}</Button>}
          {(it.payloadKey || it.meta?.download_url) && <Button variant={bmmInstallable ? 'default' : 'primary'} onClick={download}><Download size={16} /> {t('item.download', 'Download')}</Button>}
        </div>
      </div>
      {/* Per-item catalog.json — import THIS item individually as a BMM source. */}
      {bmmInstallable && (() => {
        const jsonUrl = `${location.origin}/api/catalog/${it.slug}/catalog.json`;
        return (
          <Card className="p-3 mt-5 flex items-center gap-2.5 flex-wrap">
            <FileJson size={16} className="text-[var(--primary-2)] shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-[var(--faint)]">{t('item.json.label', 'catalog.json — import this {k} individually in BMM').replace('{k}', it.kind.toLowerCase())}</div>
              <code className="text-xs text-[var(--muted)] break-all">{jsonUrl}</code>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button size="sm" onClick={() => { navigator.clipboard?.writeText(jsonUrl); toast.success(t('item.json.copied', 'catalog.json link copied.')); }}><Copy size={13} /> {t('cat.copylink', 'Copy link')}</Button>
              <a href={`bmm://catalog/${it.kind.toLowerCase()}/add-source?url=${encodeURIComponent(jsonUrl)}`}><Button size="sm"><Boxes size={13} /> {t('item.json.addbmm', 'Add as BMM source')}</Button></a>
            </div>
          </Card>
        );
      })()}
      <p className="text-[var(--muted)] leading-relaxed mt-6 whitespace-pre-wrap">{it.description || t('cat.nodesc', 'No description.')}</p>
      {it.tags?.length > 0 && <div className="flex flex-wrap gap-2 mt-4">{it.tags.map((tg) => <Badge key={tg}><Tag size={11} /> {tg}</Badge>)}</div>}
      <Card className="mt-6 p-5"><div className="text-xs font-semibold text-[var(--faint)] uppercase tracking-wider mb-2 flex items-center gap-1.5"><FileJson size={13} /> {t('item.metadata', 'Metadata')}</div>
        <pre className="text-xs text-[var(--muted)] overflow-auto max-h-80">{JSON.stringify(it.meta, null, 2)}</pre></Card>

      {warn && (
        <Modal open onClose={() => setWarn(false)} title={t('item.warn.title', 'Integrity check failed')} icon={XCircle} width="max-w-md"
          footer={<><Button variant="ghost" onClick={() => setWarn(false)}>{t('common.cancel', 'Cancel')}</Button><Button className="!bg-error-bg !text-error !border-error-border" onClick={() => { setWarn(false); doDownload(); }}>{t('item.dlanyway', 'Download anyway')}</Button></>}>
          <div className="flex items-start gap-3">
            <XCircle size={22} className="text-error shrink-0 mt-0.5" />
            <div className="text-sm text-[var(--muted)]">
              {t('item.warn.body1', 'This')} <code>.bmmplug</code> {t('item.warn.body2', 'did not pass validation')} (<b className="text-error">{v?.reason}</b>). {t('item.warn.body3', "Its checksums don't match, which means the package may have been altered or corrupted.")}
              <div className="mt-2 text-[var(--text)] font-medium">{t('item.warn.rec', 'We strongly recommend not installing it.')}</div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
