// The owner's side of hosted catalogues: the "My catalogs" tab of the dashboard (items, access
// lists, sync password). Moved out of pages/admin.jsx unchanged (full audit Sept 24 2026, web):
// dashboard.jsx loaded it with lazyNamed(() => import('./admin.jsx')), so every member who
// opened that tab downloaded the whole admin screen (2 MB, 566 KB gzip) to see their own list.
import { useEffect, useState, useRef } from 'react';
import { ChipList, AccountChipList, PubkeyList } from '../ui/access-lists.jsx';
import { Link, useSearchParams } from 'react-router-dom';
import { Boxes, Download, Upload, Package, ShieldCheck, HardDrive, Eye, Lock, Settings2, Trash2, Plus, Copy, Globe, RefreshCw, X, ChevronUp, ChevronDown, Activity, Loader2, ExternalLink } from 'lucide-react';
import { Button, Card, Badge, Input, Select, EmptyState, Spinner, ActionBar, useDialog, useToast } from '../ui/ui.jsx';
import { api, uploadPayload } from '../lib/api.js';
import DomainPanel from '../ui/domain-panel.jsx';
import { useI18n } from '../i18n.jsx';
import { LiveTraffic } from './traffic-live.jsx';
import { useAsync, Loading, KIND_LABEL } from './pages.jsx';
import { fmtBytes } from '../lib/format.js';

export function CatalogSyncPassword({ catalog, onChange }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialog = useDialog();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const has = !!catalog.hasPassword;

  const save = async () => {
    if (pw.length < 4) return toast.error(t('ocpw.short', 'Password too short (min 4).'));
    setBusy(true);
    try {
      await api.put(`/me/catalogs/${catalog.id}/sync-password`, { password: pw });
      setPw('');
      toast.success(t('ocpw.set', 'Download password set.'));
      onChange?.();
    } catch { toast.error(t('acc.failed', 'Failed.')); } finally { setBusy(false); }
  };

  const clear = async () => {
    // Removing a protection is not a thing to do by mis-click, and the confirm says what
    // actually changes rather than "are you sure".
    if (!(await dialog.confirm({
      title: t('ocpw.clear.t', 'Remove the download password'),
      message: t('ocpw.clear.m', 'The catalog becomes readable by anyone your access lists already allow. Continue?'),
      okLabel: t('rd.remove', 'Remove'), danger: true,
    }))) return;
    setBusy(true);
    try {
      await api.put(`/me/catalogs/${catalog.id}/sync-password`, { password: '' });
      toast.success(t('ocpw.cleared', 'Download password removed.'));
      onChange?.();
    } catch { toast.error(t('acc.failed', 'Failed.')); } finally { setBusy(false); }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-[var(--muted)] inline-flex items-center gap-1">
        <Lock size={12} /> {t('ocpw.label', 'Download password')}
      </span>
      {has && <Badge tone="amber">{t('ocpw.on', 'Set')}</Badge>}
      <Input
        type="password" value={pw} onChange={(e) => setPw(e.target.value)}
        placeholder={has ? t('ocpw.replace', 'Replace…') : t('ocpw.new', 'Set a password…')}
        className="w-40" autoComplete="new-password"
      />
      <Button size="sm" variant="secondary" disabled={busy || !pw} onClick={save}>{t('ocpw.save', 'Set')}</Button>
      {has && <Button size="sm" variant="ghost" disabled={busy} onClick={clear}>{t('rd.remove', 'Remove')}</Button>}
    </div>
  );
}

// Owner: who may read this catalog.
//
// Catalogs enforced bans and a whitelist server-side long before this screen existed — the
// rules ran, and nobody could see or set them. The lists themselves are the same three the
// repo dashboard edits, so the editors are imported rather than rewritten.
//
// The list route serialises through an allowlist that (rightly) omits `access` — a public
// browse must not ship somebody's ban list — so the panel fetches the owner-scoped detail
// route when it opens, exactly as the item manager does.
export function OwnerCatalogAccess({ catalog, onChange }) {
  const { t } = useI18n(); const toast = useToast();
  const { data, loading } = useAsync(() => api.get(`/me/catalogs/${catalog.id}`), [catalog.id]);
  const [acc, setAcc] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data?.catalog) setAcc(data.catalog.access || {}); }, [data]);
  if (loading || !acc) return <div className="mt-3 pt-3 border-t border-[var(--line)]"><Spinner /></div>;

  const bans = acc.bans || {};
  const setList = (field, val) => setAcc((a) => ({ ...a, [field]: val }));
  const setBanList = (field, val) => setAcc((a) => ({ ...a, bans: { ...(a.bans || {}), [field]: val } }));
  const addTo = (cur, v) => [...new Set([...(cur || []), v])];
  const rmFrom = (cur, v) => (cur || []).filter((x) => x !== v);
  const addAcct = (cur, e) => ((cur || []).some((a) => a.type === e.type && a.id === e.id) ? cur : [...(cur || []), e]);
  const rmAcct = (cur, e) => (cur || []).filter((a) => !(a.type === e.type && a.id === e.id));

  const save = async () => {
    setBusy(true);
    try { await api.patch(`/me/catalogs/${catalog.id}`, { access: acc }); toast.success(t('oca.saved', 'Access saved.')); onChange?.(); }
    catch (x) {
      // The server refuses a non-ed25519 key. Say which failure it was: "Failed." on a form
      // holding a key someone just pasted is the least useful thing we could tell them.
      toast.error(x.data?.error === 'unsupported_public_key'
        ? t('oca.badkey', 'One of the public keys is not a supported type (ed25519, RSA or ECDSA).')
        : t('acc.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 pt-3 border-t border-[var(--line)] space-y-4">
      <Card className="p-4 space-y-4">
        <div className="text-sm font-semibold">{t('oca.allow', 'Who may download')}</div>
        {/* Said plainly, because the rule is not obvious and a whitelist that silently does
            nothing is worse than no whitelist: the IP/id/account lists gate a PRIVATE catalog
            (or a site-wide whitelist mode). A public catalog ignores them — but never ignores
            the bans, the password, or a required key. */}
        <div className="text-xs text-[var(--muted)]">
          {catalog.visibility === 'private'
            ? t('oca.priv', 'This catalog is private: only the lists below (or the share link) can read it.')
            : t('oca.pub', 'This catalog is public, so these allow lists are not applied — set it to Private for them to take effect. Bans, the password and any required key still apply.')}
        </div>
        <ChipList label={t('repos.allowedips', 'Allowed IPs')} items={acc.ips || []} onAdd={(v) => setList('ips', addTo(acc.ips, v))} onRemove={(v) => setList('ips', rmFrom(acc.ips, v))} placeholder="203.0.113.4" />
        <ChipList label={t('repos.allowedkeys', 'Allowed keys')} items={acc.keys || []} onAdd={(v) => setList('keys', addTo(acc.keys, v))} onRemove={(v) => setList('keys', rmFrom(acc.keys, v))} placeholder="BMM creator id…" />
        <AccountChipList label={t('repos.allowedaccounts', 'Allowed accounts')} items={acc.accounts || []} onAdd={(e) => setList('accounts', addAcct(acc.accounts, e))} onRemove={(e) => setList('accounts', rmAcct(acc.accounts, e))} placeholder={t('repos.acct.search', 'Search creator id / Discord / username…')} />
        <PubkeyList items={acc.pubkeys || []} onAdd={(v) => setList('pubkeys', addTo(acc.pubkeys, v))} onRemove={(v) => setList('pubkeys', rmFrom(acc.pubkeys, v))} />
      </Card>
      <Card className="p-4 space-y-4">
        <div className="text-sm font-semibold">{t('oca.ban', 'Banned')}</div>
        <div className="text-xs text-[var(--muted)]">{t('oca.ban.note', 'Applied to every download, public catalog included — and before anything else, so a banned client is told it is banned rather than asked for a password.')}</div>
        <ChipList label={t('repos.bannedips', 'Banned IPs')} items={bans.ips || []} onAdd={(v) => setBanList('ips', addTo(bans.ips, v))} onRemove={(v) => setBanList('ips', rmFrom(bans.ips, v))} placeholder="198.51.100.7" />
        <ChipList label={t('rd.bannedkeys', 'Banned keys')} items={bans.keys || []} onAdd={(v) => setBanList('keys', addTo(bans.keys, v))} onRemove={(v) => setBanList('keys', rmFrom(bans.keys, v))} placeholder="BMM creator id…" />
        <AccountChipList label={t('repos.bannedaccounts', 'Banned accounts')} items={bans.accounts || []} onAdd={(e) => setBanList('accounts', addAcct(bans.accounts, e))} onRemove={(e) => setBanList('accounts', rmAcct(bans.accounts, e))} placeholder={t('repos.acct.search', 'Search creator id / Discord / username…')} />
      </Card>
      <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('repos.savesettings', 'Save settings')}</Button></div>
    </div>
  );
}

// Exported because dashboard.jsx reaches it by NAME through lazyNamed. Without the keyword
// the lazy resolves to undefined and the whole Catalogues tab renders as React error #306 —
// which says "element type is invalid" and names nothing, so it reads like a broken component
// rather than a missing export. CatalogSyncPassword above carries the same note; this is the
// second time.
export function OwnerCatalogs() {
  const { t } = useI18n(); const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/me/catalogs'), []);
  // M19: one catalogue open at a time, on one tab, both in the URL (?cat=&ctab=). It used to
  // be four independent toggles (items, access, traffic, domain) that stacked under the card
  // in click order, so "Access" could open below a full traffic table, off screen, and a
  // reload closed everything. The URL makes a link to "my catalogue's access" possible too.
  const [sp, setSp] = useSearchParams();
  const openCat = sp.get('cat');
  const openTab = sp.get('ctab');
  const setOpen = (id, tab) => {
    const n = new URLSearchParams(sp);
    if (id) n.set('cat', id); else n.delete('cat');
    if (id && tab) n.set('ctab', tab); else n.delete('ctab');
    setSp(n, { replace: true });
  };
  const [hidden, setHidden] = useState(() => new Set()); // optimistically-removed during the undo window
  const cats = (data?.catalogs || []).filter((c) => !hidden.has(c.id));
  const total = (k) => cats.reduce((n, c) => n + (Number(c[k]) || 0), 0);
  const patch = async (c, body) => { try { await api.patch(`/me/catalogs/${c.id}`, body); reload(); } catch (x) { toast.error(x.data?.error || t('acc.failed', 'Failed.')); } };
  const rotate = async (c) => { try { const r = await api.post(`/me/catalogs/${c.id}/rotate-key`); navigator.clipboard?.writeText(`${location.origin}/c/${c.slug}?k=${r.shareKey}`); toast.success(t('oc.keyrotated', 'New share link copied.')); reload(); } catch { toast.error(t('acc.failed', 'Failed.')); } };
  // Optimistic delete with an undo window: hide the card now and count down; the catalog
  // is only removed when the timer elapses (Undo restores it, nothing is deleted).
  const del = (c) => {
    setHidden((s) => new Set(s).add(c.id));
    if (openCat === c.id) setOpen(null);
    const unhide = () => setHidden((s) => { const n = new Set(s); n.delete(c.id); return n; });
    toast.action({
      tone: 'success', duration: 6000, cancelLabel: t('common.undo', 'Undo'),
      msg: t('oc.deleted2', 'Catalog deleted.'),
      onCommit: async () => { try { await api.del(`/me/catalogs/${c.id}`); reload(); } catch { toast.error(t('acc.failed', 'Failed.')); unhide(); } },
      onCancel: unhide,
    });
  };
  const copyFeed = (c) => { navigator.clipboard?.writeText(`${location.origin}/api/c/${c.slug}/catalog.json`); toast.success(t('ccp.copied', 'Copied.')); };
  const tone = (s) => s === 'SUSPENDED' ? 'red' : s === 'HIDDEN' ? 'amber' : 'green';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div><h2 className="font-semibold flex items-center gap-2"><Boxes size={16} className="text-[var(--accent-ink)]" /> {t('mycat.title', 'My catalogs')}</h2>
          <p className="text-sm text-[var(--muted)]">{t('oc.desc', 'Catalogs you host. Share the /c link or add them in BMM. Managed catalogs draw from a storage pool.')}</p></div>
        <Link to="/submit"><Button size="sm" variant="primary"><Plus size={14} /> {t('oc.new', 'New catalog')}</Button></Link>
      </div>
      {/* M19: the totals first, the four numbers an owner opens this tab to see. */}
      {cats.length > 0 && <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {[[Boxes, cats.length, t('oc.k.cats', 'Catalogs')], [Package, total('itemCount'), t('oc.k.items', 'Items')],
          [Download, total('downloads'), t('oc.k.dl', 'Downloads')], [Eye, total('views'), t('oc.k.views', 'Views')]].map(([I, n, label]) => (
          <Card key={label} className="p-3.5 flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-xl grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, var(--primary) 14%, var(--bg-solid))', color: 'var(--accent-ink)' }}><I size={17} /></span>
            <div className="min-w-0"><div className="text-lg font-extrabold tabular-nums leading-tight">{Number(n).toLocaleString()}</div><div className="text-[11px] text-[var(--muted)]">{label}</div></div>
          </Card>
        ))}
      </div>}
      {loading ? <Loading /> : cats.length ? <div className="space-y-2">
        {cats.map((c) => {
          const isOpen = openCat === c.id;
          // Items first for a managed catalogue (that is the work); a raw one has no items
          // here, so it opens on its settings.
          const tabs = [
            c.mode === 'managed' && ['items', t('oc.items', 'Items'), Package],
            ['settings', t('oc.settings', 'Settings'), Settings2],
            ['access', t('oc.access', 'Access'), ShieldCheck],
            ['traffic', t('oc.traffic', 'Live traffic'), Activity],
            ['domain', t('oc.domain', 'Custom domain'), Globe],
          ].filter(Boolean);
          const tab = tabs.some(([id]) => id === openTab) ? openTab : tabs[0][0];
          const quota = c.storageQuotaBytes || 0; const used = c.storageUsedBytes || 0;
          const pct = quota ? Math.min(100, (used / quota) * 100) : 0;
          return (
          <Card key={c.id} className="p-4">
            {/* Content, then actions on their own row — the same shape as the repo cards.
                The actions can't share a row with the title: ActionBar sizes itself from its
                container, and next to a flex-1 sibling that container IS its content, so it
                would measure "everything fits" at every width and never fold. */}
            <div className="min-w-0">
              <div className="font-medium flex items-center gap-2 flex-wrap min-w-0"><span className="truncate min-w-0" title={c.name}>{c.name}</span> <Badge tone={tone(c.status)}>{c.status}</Badge><Badge tone={c.visibility === 'private' ? 'amber' : ''}>{c.visibility}</Badge><Badge tone="">{c.mode}</Badge></div>
              <div className="text-xs text-[var(--faint)] flex items-center gap-2 flex-wrap mt-0.5">
                <span>{c.itemCount} {t('cc.items', 'items')}</span>
                <span className="flex items-center gap-1"><Download size={11} /> {c.downloads ?? 0}</span>
                <span className="flex items-center gap-1"><Eye size={11} /> {c.views ?? 0}</span>
                <a href={`/c/${c.slug}`} target="_blank" rel="noreferrer" className="underline truncate max-w-full">/c/{c.slug}</a>
              </div>
              {/* A managed catalogue draws from a pool: how much of its share is used. */}
              {c.mode === 'managed' && quota > 0 && <div className="mt-2 max-w-sm">
                <div className="flex items-center justify-between text-[11px] text-[var(--muted)]"><span className="flex items-center gap-1"><HardDrive size={11} /> {fmtBytes(used)} / {fmtBytes(quota)}</span><span className="tabular-nums">{Math.round(pct)}%</span></div>
                <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden mt-1" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={t('oc.k.storage', 'Storage')}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: `var(--${pct >= 97 ? 'error' : pct >= 85 ? 'warning' : 'primary'})` }} />
                </div>
              </div>}
            </div>
            <div className="mt-3">
              <ActionBar actions={[
                { key: 'manage', label: isOpen ? t('oc.close', 'Close') : t('oc.manage', 'Manage'), icon: isOpen ? ChevronUp : ChevronDown, onClick: () => setOpen(isOpen ? null : c.id, isOpen ? null : openTab) },
                { key: 'feed', label: t('oc.feed', 'Feed URL'), icon: Copy, onClick: () => copyFeed(c) },
                { key: 'open', label: t('oc.openpage', 'Open page'), icon: ExternalLink, onClick: () => window.open(`/c/${c.slug}`, '_blank', 'noopener') },
                { key: 'del', label: t('common.delete', 'Delete'), icon: Trash2, danger: true, onClick: () => del(c) },
              ]} />
            </div>
            {isOpen && <>
            <div className="flex gap-1 mt-3 border-b border-[var(--line)] overflow-x-auto" role="tablist">
              {tabs.map(([tid, label, I]) => (
                <button key={tid} role="tab" aria-selected={tab === tid} onClick={() => setOpen(c.id, tid)} className={`press-sm flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors ${tab === tid ? 'border-[var(--primary)] text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}><I size={14} /> {label}</button>
              ))}
            </div>
            {tab === 'settings' && <div className="flex items-center gap-3 mt-3 flex-wrap text-sm">
              <label className="flex items-center gap-1.5 text-[var(--muted)]">{t('oc.visibility', 'Visibility')}
                <Select className="!w-auto" value={c.visibility} onChange={(e) => patch(c, { visibility: e.target.value })}><option value="public">{t('sub2.public', 'Public')}</option><option value="private">{t('sub2.private', 'Private')}</option></Select></label>
              {c.visibility === 'public' && <label className="flex items-center gap-1.5 text-[var(--muted)] cursor-pointer"><input type="checkbox" checked={c.listed} onChange={(e) => patch(c, { listed: e.target.checked })} /> {t('oc.listed', 'Listed publicly')}</label>}
              {/* Which app this catalog is for. Without it the catalog index cannot say,
                  and a client filtering by app has to choose between dropping it and
                  taking everything — so an unset catalog reaches fewer people than a
                  labelled one, not more. "Not specified" stays selectable: a catalog set
                  to the wrong app is worse than an unlabelled one, and would otherwise be
                  permanently mislabelled. */}
              <label className="flex items-center gap-1.5 text-[var(--muted)]">
                {t('oc.forapp', 'For')}
                <Select className="!w-auto" value={c.app || ''} onChange={(e) => patch(c, { app: e.target.value })}>
                  <option value="">{t('oc.forapp.none', 'Not specified')}</option>
                  {['bmm', 'bsm', 'installer'].map((k) => <option key={k} value={k}>{k.toUpperCase()}</option>)}
                </Select>
              </label>
              {c.visibility === 'private' && <Button size="sm" variant="ghost" onClick={() => rotate(c)}><RefreshCw size={12} /> {t('oc.sharelink', 'Copy share link')}</Button>}
              <CatalogSyncPassword catalog={c} onChange={reload} />
            </div>}
            {tab === 'items' && <OwnerCatalogItems catalog={c} onChange={reload} />}
            {tab === 'access' && <OwnerCatalogAccess catalog={c} onChange={reload} />}
            {/* Feed fetches and item downloads, private share-link hits included (marked with a
                key): the owner route, never the staff one. */}
            {tab === 'traffic' && <div className="mt-3"><LiveTraffic bare url={`/me/catalogs/${c.id}/traffic`} /></div>}
            {/* The API always accepted `catalogs` here (routes/domains.mjs); only repos had the panel. */}
            {tab === 'domain' && <div className="mt-3"><DomainPanel kind="catalogs" id={c.id} /></div>}
            </>}
          </Card>
          );
        })}
      </div> : <EmptyState icon={Boxes} title={t('mycat.none.t', 'No catalogs yet')} sub={t('mycat.none.s', 'Host your own catalog of plugins, themes or apps.')}
        action={{ label: t('oc.new', 'New catalog'), icon: Plus, to: '/submit' }} />}
    </div>
  );
}

// Managed-catalog item manager. Each item either points at an external download URL, or
// hosts a file uploaded straight into the catalog's storage pool (the size limit is just
// the pool's free space — enforced server-side on create).
export function OwnerCatalogItems({ catalog, onChange }) {
  const { t } = useI18n(); const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get(`/me/catalogs/${catalog.id}`), [catalog.id]);
  const [f, setF] = useState({ name: '', url: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(() => new Set());
  const fileRef = useRef(null);
  // The catalog's own kind — every item takes it. `kind` comes from the API; `kinds[0]` is
  // the fallback for a catalog serialised before that field existed.
  const itemKind = String(catalog.kind || catalog.kinds?.[0] || 'APP').toUpperCase();
  const items = (data?.catalog?.items || []).filter((it) => !hidden.has(it.id));
  const add = async () => {
    if (f.name.trim().length < 1) return toast.error(t('oc.it.name', 'Name required.'));
    setBusy(true);
    try {
      let payloadKey, payloadSize;
      if (file) { payloadKey = await uploadPayload(itemKind, file); payloadSize = file.size; }
      await api.post(`/me/catalogs/${catalog.id}/items`, {
        kind: itemKind, name: f.name.trim(),
        payloadKey, payloadSize,
        meta: (!file && f.url) ? { download_url: f.url.trim() } : {},
      });
      setF({ ...f, name: '', url: '' }); setFile(null); if (fileRef.current) fileRef.current.value = '';
      reload(); onChange?.();
    } catch (x) {
      const e = x.data?.error;
      toast.error(e === 'too_large' ? t('sub2.toobig', 'Files over 100MB must be arranged via the contact page.') : e === 'pool_exceeded' ? t('oc.it.poolfull', 'Not enough pool space left.') : e || t('acc.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  const rm = (it) => {
    setHidden((s) => new Set(s).add(it.id));
    const unhide = () => setHidden((s) => { const n = new Set(s); n.delete(it.id); return n; });
    toast.action({
      tone: 'success', duration: 6000, cancelLabel: t('common.undo', 'Undo'),
      msg: t('oc.it.removed', 'Item removed.'),
      onCommit: async () => { try { await api.del(`/me/catalogs/${catalog.id}/items/${it.id}`); reload(); onChange?.(); } catch { toast.error(t('acc.failed', 'Failed.')); unhide(); } },
      onCancel: unhide,
    });
  };
  return (
    <div className="mt-3 pt-3 border-t border-[var(--line)]">
      {loading ? <Loading /> : <>
        {items.length > 0 && <div className="space-y-1 mb-2">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-2 text-sm py-1">
              <Badge tone="">{it.kind}</Badge><span className="flex-1 min-w-0 truncate" title={it.name}>{it.name}</span>
              {it.payloadKey && <span className="text-[11px] text-[var(--faint)] flex items-center gap-1"><HardDrive size={11} /> {fmtBytes(it.payloadSize)}</span>}
              <span className="text-[11px] text-[var(--faint)] flex items-center gap-1"><Download size={11} /> {it.downloads ?? 0}</span>
              <button onClick={() => rm(it)} className="text-[var(--faint)] hover:text-error"><X size={13} /></button>
            </div>
          ))}
        </div>}
        <div className="flex flex-wrap items-end gap-2">
          {/* Not a choice. A catalog serves one kind, so every item in it has that kind by
              definition — offering a picker here only invited an item the feed would refuse
              to emit (the API now answers kind_mismatch). Shown, not selectable. */}
          <Badge tone="primary" title={t('oc.it.kindfixed', 'This catalog serves one type; every item uses it.')}>{KIND_LABEL[itemKind] || itemKind}</Badge>
          <Input className="flex-1 min-w-[120px]" placeholder={t('sub.name', 'Name')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          {!file && <Input className="flex-1 min-w-[160px]" placeholder="https://…/download" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />}
          {file && <span className="text-xs text-[var(--muted)] flex items-center gap-1 min-w-0"><Upload size={12} /> <span className="truncate max-w-[160px]" title={file.name}>{file.name}</span> ({fmtBytes(file.size)}) <button onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }} className="hover:text-error"><X size={12} /></button></span>}
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} title={t('oc.it.upload', 'Upload a file to your pool instead of linking a URL')}><Upload size={13} /> {t('oc.it.uploadbtn', 'Upload')}</Button>
          <Button size="sm" variant="default" onClick={add} disabled={busy}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} {t('oc.additem', 'Add')}</Button>
        </div>
        <p className="text-[11px] text-[var(--faint)] mt-1.5">{t('oc.it.hint', 'Link a download URL, or upload a file, uploads use your pool space (up to what is free).')}</p>
      </>}
    </div>
  );
}
