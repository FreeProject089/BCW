// Live consumer traffic — "who is pulling what right now" — for catalogues, storage pools and
// the whole platform. One component for every view, because the API answers every view in
// ONE shape (apps/api/src/lib/access-traffic.mjs shapeTraffic()):
//
//   recent  [{ id, source: 'repo'|'catalog', subjectId, name, ip, path, kind, keyed, at }]
//   rollup  [{ source, subjectId, name, owner, poolId, count }]      (24 h, busiest first)
//   pools   [{ poolId, name?, color?, repos, catalogs, count }]       (poolId null = no pool)
//   totals  { recent, repo24h, catalog24h, all24h }
//
// The repo-only admin card (repos-admin.jsx AdminRepoTraffic) predates the shared shape and
// keeps its own route and field names; this is its visual twin, same 15 min / 24 h split and
// the same 10 s refresh, so the three cards read as one family.
//
// `keyed` is all the API ever says about a catalogue's private share link: whether a VALID
// key was presented. The key itself never leaves the server, so there is nothing to mask here.
import { useEffect, useState } from 'react';
import { Wifi, ChevronDown, Server, Boxes, KeyRound, HardDrive } from 'lucide-react';
import { Card, Badge, Dropdown } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';

const REFRESH_MS = 10000;

/** Poll `url` every 10 s while mounted and open. `null` url = nothing to load. */
function useLiveTraffic(url, open) {
  const [state, setState] = useState({ data: null, error: null });
  useEffect(() => {
    if (!url || !open) return undefined;
    let on = true;
    setState({ data: null, error: null });
    const load = () => api.get(url)
      .then((d) => on && setState({ data: d, error: null }))
      .catch((x) => on && setState((s) => ({ data: s.data, error: x?.status || x?.data?.error || 'failed' })));
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { on = false; clearInterval(id); };
  }, [url, open]);
  return state;
}

const hhmm = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function SourceIcon({ source, className = '' }) {
  const I = source === 'catalog' ? Boxes : Server;
  return <I size={11} className={`shrink-0 ${source === 'catalog' ? 'text-info' : 'text-[var(--accent-ink)]'} ${className}`} />;
}

function Bar({ value, max, color }) {
  return (
    <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
      <div className={`h-full ${color ? '' : 'bg-gradient-to-r from-brand to-brand-2'}`}
        style={{ width: `${Math.max(4, (value / (max || 1)) * 100)}%`, ...(color ? { background: color } : {}) }} />
    </div>
  );
}

/**
 * The card. `url` is one of the traffic routes; `showPools` adds the per-pool breakdown (the
 * all-pools view); `onPickPool(poolId)` makes each pool row a button that narrows the view.
 * `bare` drops the Card and the fold, for use inside an owner's already-open panel.
 */
export function LiveTraffic({ url, title, icon: Icon = Wifi, showPools = false, onPickPool, headerExtra = null, bare = false, defaultOpen = true }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const { data, error } = useLiveTraffic(url, bare || open);
  const recent = data?.recent || [];
  const rollup = data?.rollup || [];
  const pools = data?.pools || [];
  const totals = data?.totals || { repo24h: 0, catalog24h: 0, all24h: 0 };
  const max = rollup[0]?.count || 1;
  const poolMax = pools[0]?.count || 1;
  const mixed = rollup.some((r) => r.source === 'repo') && rollup.some((r) => r.source === 'catalog');

  const body = (
    <>
      {error && !data && (
        <div className="text-sm text-[var(--faint)] py-3">
          {error === 404 || error === 'not_found' ? t('tl.gone', 'Nothing to show: this no longer exists or is not yours.') : t('tl.failed', 'Could not load the traffic.')}
        </div>
      )}
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)] mb-3" data-tl-totals>
            <span>{t('tl.total24', '24 h: {n} requests').replace('{n}', String(totals.all24h))}</span>
            {totals.repo24h > 0 && <span className="flex items-center gap-1"><SourceIcon source="repo" /> {t('tl.repos24', '{n} to repos').replace('{n}', String(totals.repo24h))}</span>}
            {totals.catalog24h > 0 && <span className="flex items-center gap-1"><SourceIcon source="catalog" /> {t('tl.cats24', '{n} to catalogues').replace('{n}', String(totals.catalog24h))}</span>}
          </div>
          {showPools && pools.length > 0 && (
            <div className="mb-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mb-1.5">{t('tl.perpool', 'Last 24h, per pool')}</div>
              <div className="space-y-1.5 max-h-48 overflow-auto pe-1">
                {pools.map((g) => {
                  const label = g.poolId ? (g.name || '?') : t('tl.nopool', 'Not in a pool');
                  const row = (
                    <>
                      <HardDrive size={11} className="shrink-0" style={g.color ? { color: g.color } : undefined} />
                      <span className="w-32 truncate font-medium text-start" title={g.owner ? `${label} · ${g.owner}` : label}>{label}</span>
                      <Bar value={g.count} max={poolMax} color={g.color || undefined} />
                      <span className="text-[10px] text-[var(--faint)] shrink-0 hidden sm:inline">{t('tl.poolmix', '{r} repos · {c} cat.').replace('{r}', String(g.repos)).replace('{c}', String(g.catalogs))}</span>
                      <span className="tabular-nums text-[var(--muted)] w-10 text-end">{g.count}</span>
                    </>
                  );
                  return onPickPool && g.poolId
                    ? <button key={g.poolId} type="button" onClick={() => onPickPool(g.poolId)} className="w-full flex items-center gap-2 text-xs rounded-md hover:bg-[var(--surface-2)] px-1 -mx-1" title={t('tl.pickpool', 'Show only this pool')}>{row}</button>
                    : <div key={g.poolId || 'none'} className="flex items-center gap-2 text-xs">{row}</div>;
                })}
              </div>
            </div>
          )}
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mb-1.5">{t('radm.now15', 'Now (15 min)')}</div>
              {!recent.length ? <div className="text-sm text-[var(--faint)] py-3">{t('radm.notraffic', 'No traffic right now.')}</div> : (
                <div className="divide-y divide-[var(--line)] max-h-64 overflow-auto rounded-lg border border-[var(--line)]">
                  {recent.map((e) => (
                    <div key={`${e.source}-${e.id}`} className="flex items-center gap-2 px-3 py-1.5 text-xs min-w-0">
                      <span className={`shrink-0 font-bold ${e.kind === 'download' ? 'text-[var(--accent-ink)]' : 'text-[var(--faint)]'}`} title={e.kind === 'download' ? t('tl.kind.dl', 'Download') : t('tl.kind.connect', 'Listing fetched')}>{e.kind === 'download' ? '↓' : '•'}</span>
                      {mixed && <SourceIcon source={e.source} />}
                      <span className="font-medium truncate max-w-[9rem]" title={e.name}>{e.name}</span>
                      <span className="font-mono text-[var(--muted)] truncate flex-1 min-w-0" title={e.path}>{e.path}</span>
                      {e.keyed && <span className="shrink-0 text-[var(--accent-ink)]" title={t('tl.keyed', 'Opened through the private share link')}><KeyRound size={11} /></span>}
                      <span className="text-[var(--faint)] font-mono shrink-0 hidden sm:inline">{e.ip}</span>
                      <span className="text-[var(--faint)] shrink-0 tabular-nums">{hhmm(e.at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mb-1.5">{t('tl.last24', 'Last 24h, requests per item')}</div>
              {!rollup.length ? <div className="text-sm text-[var(--faint)] py-3">{t('tl.none24', 'Nothing in the last 24h.')}</div> : (
                <div className="space-y-1.5 max-h-64 overflow-auto pe-1">
                  {rollup.map((r) => (
                    <div key={`${r.source}-${r.subjectId}`} className="flex items-center gap-2 text-xs">
                      {mixed && <SourceIcon source={r.source} />}
                      <span className="w-36 truncate font-medium" title={`${r.name} · ${r.owner}`}>{r.name}</span>
                      <Bar value={r.count} max={max} />
                      <span className="tabular-nums text-[var(--muted)] w-10 text-end">{r.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );

  if (bare) return <div className="mt-3 pt-3 border-t border-[var(--line)]" data-live-traffic>{body}</div>;
  return (
    <Card className="p-4 mb-4" data-live-traffic>
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" className="flex-1 min-w-0 flex items-center gap-2 text-start" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <Icon size={16} className="text-[var(--accent-ink)] shrink-0" />
          <span className="font-semibold truncate" title={title}>{title}</span>
          {recent.length > 0 && <Badge tone="primary" className="shrink-0">{t('tl.inlast15', '{n} in the last 15 min').replace('{n}', String(recent.length))}</Badge>}
          <ChevronDown size={15} className={`ms-auto shrink-0 text-[var(--faint)] transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {headerExtra}
      </div>
      {open && <div className="mt-3">{body}</div>}
    </Card>
  );
}

/** Admin → Catalogs → Community: every catalogue at once (manage_catalogs). */
export function AdminCatalogTraffic() {
  const { t } = useI18n();
  return <LiveTraffic url="/admin/catalogs/traffic" title={t('tl.cats.title', 'Live catalogue traffic')} icon={Boxes} />;
}

/**
 * Admin → Repos & pools → Storage pools: the platform view (every pool, repos AND catalogues)
 * or one pool, picked from the list the pool manager already loaded (manage_repos).
 */
export function AdminPoolTraffic({ groups = [] }) {
  const { t } = useI18n();
  const [pool, setPool] = useState('');
  const known = groups.some((g) => g.id === pool);
  const url = pool && known ? `/admin/hosting/groups/${pool}/traffic` : '/admin/hosting/traffic';
  const options = [
    { value: '', label: t('tl.allpools', 'All pools') },
    ...groups.map((g) => ({ value: g.id, label: g.ownerName ? `${g.name} · ${g.ownerName}` : g.name })),
  ];
  return (
    <LiveTraffic url={url} title={t('tl.pools.title', 'Live traffic, pools')} icon={HardDrive}
      showPools={!pool} onPickPool={(id) => setPool(id)}
      headerExtra={groups.length > 0 ? <Dropdown size="sm" value={pool} onChange={setPool} options={options} /> : null} />
  );
}
