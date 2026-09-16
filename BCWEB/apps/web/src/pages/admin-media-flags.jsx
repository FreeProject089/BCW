// Admin -> Moderation -> Lookalike pictures: uploads whose perceptual hash sits within a few
// bits of a picture ANOTHER account holds (or is byte-identical to it). Staff look at the two
// and clear the flag (a false positive, the same person twice) or mark it acted on.
//
// The screen exists to answer one question, "are these the same picture", and the first
// version made that question hard to answer. Both pictures were squeezed into a square box
// about 120px wide, side by side, which is exactly the size at which a crop, a watermark or a
// recolour is invisible. So the work is:
//
//   · a REVIEW mode, one pair at a time and as large as the window allows, with a blink
//     toggle that swaps the two in place. Alternating two images in the same rectangle is the
//     oldest trick there is for spotting the difference between them, and it costs nothing:
//     a change of which <img> is on top.
//   · KEYBOARD, because this is a queue and a queue is the same three keys a hundred times.
//     J/K move, C clears, A marks acted on, B blinks, ? lists them.
//   · the fact that decides most cases: how many OTHER pending flags each account already
//     has. One flag between two accounts is usually a stock image; the same account on eight
//     of them is the thing worth acting on. It comes from the API as `ownerFlags`.
//   · a resolved flag LEAVES the pending queue immediately, so the list is what is left to do
//     rather than a log you lose your place in.
//
// The list mode is kept, because scanning twenty at once is a real second way to work.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Images, RefreshCw, Check, Gavel, Sliders, ArrowLeftRight, ScanSearch, Keyboard, Rows3, Maximize2, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAsync } from './pages.jsx';
import { Button, Card, Badge, Input, Field, Select, EmptyState, Spinner, useToast, Explain } from '../ui/ui.jsx';

const when = (d) => new Date(d).toLocaleString();
// t() takes no variables; the few counted strings fill their {x} here.
const fmt = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
const KIND_LABEL = { upload: 'Upload', archive: 'Archive', 'archive-entry': 'Inside an archive', avatar: 'Avatar', 'team-avatar': 'Team avatar' };
const fileName = (key) => (key.includes('#') ? key.split('#').slice(1).join('#') : key.split('/').pop());

/** One picture, at whatever size its container gives it. */
function Shot({ h, t, big = false }) {
  const [broken, setBroken] = useState(false);
  const dead = h.kind === 'archive' || broken;
  return (
    <div className={`w-full overflow-hidden rounded-lg panel-quiet flex items-center justify-center ${big ? 'aspect-[4/3]' : 'aspect-square'}`}>
      {dead
        ? <Images size={big ? 48 : 28} className="text-[var(--faint)]" />
        : <img src={`/api${h.preview}`} alt={fileName(h.key)} loading="lazy" className="max-w-full max-h-full object-contain" onError={() => setBroken(true)} />}
    </div>
  );
}

/** Who uploaded it, and whether this is the only time they have shown up here. */
function Who({ h, t, flags }) {
  const name = fileName(h.key);
  return (
    <div className="min-w-0 space-y-0.5">
      <div className="text-[12px] font-medium truncate" title={h.key}>{name}</div>
      <div className="text-[12px] truncate">
        {h.owner
          ? <a className="underline hover:text-[var(--text)]" href={`/admin?s=users&q=${encodeURIComponent(h.owner.id)}`} title={h.owner.displayName}>{h.owner.displayName}{h.owner.status !== 'active' ? ` · ${h.owner.status}` : ''}</a>
          : <span className="text-[var(--faint)]">{t('adm.mf.noowner', 'owner unknown')}</span>}
        {/* Two or more means this account is a pattern, not an incident. */}
        {flags > 1 && <Badge tone="warning" className="ms-1.5">{fmt(t('adm.mf.ownerflags', '{n} pending flags'), { n: flags })}</Badge>}
      </div>
      <div className="text-[11px] text-[var(--faint)] flex flex-wrap gap-x-2">
        <span>{t(`adm.mf.kind.${h.kind}`, KIND_LABEL[h.kind] || h.kind)}</span>
        {h.width ? <span>{h.width}×{h.height}</span> : null}
        {h.refType ? <span>{h.refType}</span> : null}
        <span>{when(h.createdAt)}</span>
      </div>
    </div>
  );
}

/**
 * The two pictures, and a way to actually compare them.
 *
 * Side by side answers "do these look alike". Blink answers "what is different", which is the
 * question that decides whether a flag is a crop of somebody else's work or an unrelated
 * picture that happens to hash nearby. The two images are stacked in one box and one is faded
 * out; nothing is downloaded twice and nothing moves, so a 4px watermark is visible.
 */
function Compare({ f, t, ownerFlags, blink, onBlink }) {
  const [side, setSide] = useState(0);   // which one blink is showing
  useEffect(() => {
    if (!blink) return undefined;
    const id = setInterval(() => setSide((v) => 1 - v), 700);
    return () => clearInterval(id);
  }, [blink]);
  if (blink) {
    return (
      <div className="space-y-2">
        <div className="relative w-full aspect-[4/3] overflow-hidden rounded-lg panel-quiet">
          {[f.hash, f.match].map((h, i) => (
            <img key={h.id} src={`/api${h.preview}`} alt=""
              className="absolute inset-0 m-auto max-w-full max-h-full object-contain transition-opacity duration-150"
              style={{ opacity: side === i ? 1 : 0 }} />
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 text-[12px]">
          <span className={side === 0 ? 'font-semibold' : 'text-[var(--faint)]'}>{f.hash.owner?.displayName || t('adm.mf.noowner', 'owner unknown')}</span>
          <Button size="sm" variant="ghost" onClick={onBlink}><ArrowLeftRight size={13} /> {t('adm.mf.blinkoff', 'Stop blinking')}</Button>
          <span className={side === 1 ? 'font-semibold' : 'text-[var(--faint)]'}>{f.match.owner?.displayName || t('adm.mf.noowner', 'owner unknown')}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {[f.hash, f.match].map((h) => (
        <div key={h.id} className="space-y-1.5">
          <Shot h={h} t={t} big />
          <Who h={h} t={t} flags={h.ownerId ? ownerFlags[h.ownerId] || 0 : 0} />
        </div>
      ))}
    </div>
  );
}

function Settings({ stats, onSaved }) {
  const { t } = useI18n(); const toast = useToast();
  const [f, setF] = useState(null); const [busy, setBusy] = useState(false);
  const s = f || stats?.settings; if (!s) return null;
  const save = async () => {
    setBusy(true);
    try { await api.put('/admin/media-hashes/settings', { threshold: Number(s.threshold), enabled: !!s.enabled }); toast.success(t('common.saved', 'Saved.')); setF(null); onSaved?.(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  const scan = async (backfill) => {
    setBusy(true);
    try { const r = await api.post('/admin/media-hashes/scan', { backfill }); toast.success(fmt(t('adm.mf.scanned', 'Hashed {h}, flagged {f}, backfilled {b}.'), { h: r.hashed, f: r.flagged, b: r.backfilled })); onSaved?.(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  return (
    <Card className="p-4 space-y-3">
      <div className="font-semibold flex items-center gap-2"><Sliders size={15} /> {t('adm.mf.settings', 'Detection')}</div>
      {/* What a distance MEANS is the only part of this that has to be on screen while
          somebody is choosing a number; the rest of the paragraph folds. */}
      <Explain summary={t('adm.mf.settings.lead', 'A distance is how many bits two hashes differ by.')} className="text-[12px]">
        {t('adm.mf.settings.d', 'Every uploaded picture (and the pictures inside uploaded archives, and linked avatars) gets a perceptual hash. Two hashes within the distance below are flagged when they belong to different accounts. 0 to 4 is the same picture re-saved, 6 to 10 a crop or a watermark, 20+ a different picture.')}
      </Explain>
      <div className="grid sm:grid-cols-3 gap-3 items-end">
        <Field label={t('adm.mf.threshold', 'Max distance (bits)')}><Input type="number" min={0} max={20} value={s.threshold} onChange={(e) => setF({ ...s, threshold: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })} /></Field>
        <Field label={t('adm.mf.enabled', 'Hashing')}>
          <Select value={s.enabled ? 'on' : 'off'} onChange={(e) => setF({ ...s, enabled: e.target.value === 'on' })}>
            <option value="on">{t('common.on', 'On')}</option><option value="off">{t('common.off', 'Off')}</option>
          </Select>
        </Field>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" onClick={save} disabled={busy || !f}>{t('common.save', 'Save')}</Button>
          <Button size="sm" variant="ghost" onClick={() => scan(false)} disabled={busy}><ScanSearch size={13} /> {t('adm.mf.scan', 'Hash now')}</Button>
          <Button size="sm" variant="ghost" onClick={() => scan(true)} disabled={busy} title={t('adm.mf.backfill.t', 'Also register pictures uploaded before hashing existed (owner unknown).')}>{t('adm.mf.backfill', 'Backfill')}</Button>
        </div>
      </div>
      {stats && <div className="text-[11px] text-[var(--faint)]">{fmt(t('adm.mf.stats', '{p} waiting · {h} hashed · flags: {a} pending, {c} cleared, {d} acted on'), { p: stats.pending, h: stats.hashed, a: stats.flags.pending, c: stats.flags.cleared, d: stats.flags.actioned })}</div>}
    </Card>
  );
}

/** The verdict buttons, the same three wherever they appear. */
function Verdict({ f, resolve, t, size = 'sm' }) {
  return (
    <span className="flex gap-1 flex-wrap">
      {f.status !== 'cleared' && <Button size={size} variant="ghost" onClick={() => resolve(f.id, 'cleared')}><Check size={13} /> {t('adm.mf.clear', 'Clear')}</Button>}
      {f.status !== 'actioned' && <Button size={size} variant="ghost" className="!text-error" onClick={() => resolve(f.id, 'actioned')}><Gavel size={13} /> {t('adm.mf.action', 'Acted on')}</Button>}
      {f.status !== 'pending' && <Button size={size} variant="ghost" onClick={() => resolve(f.id, 'pending')}>{t('adm.mf.reopen', 'Reopen')}</Button>}
    </span>
  );
}

function Verdicts({ f, t }) {
  return (
    <>
      <Badge tone={f.reason === 'exact' ? 'error' : 'warning'}>{f.reason === 'exact' ? t('adm.mf.exact', 'identical bytes') : fmt(t('adm.mf.near', 'distance {d}'), { d: f.distance })}</Badge>
      <Badge tone={f.status === 'pending' ? 'warning' : f.status === 'actioned' ? 'error' : 'success'}>{t(`adm.mf.st.${f.status}`, f.status)}</Badge>
      <span className="text-[var(--faint)]">{when(f.createdAt)}</span>
      {f.note ? <span className="text-[var(--muted)]">· {f.note}</span> : null}
    </>
  );
}

export function AdminMediaFlags() {
  const { t } = useI18n(); const toast = useToast();
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(0);
  const [showCfg, setShowCfg] = useState(false);
  const [mode, setMode] = useState('review');   // review = one at a time, list = scan many
  const [at, setAt] = useState(0);              // which one, in review mode
  const [blink, setBlink] = useState(false);
  const [keys, setKeys] = useState(false);      // the shortcut list
  // Resolved flags are dropped from the page rather than re-fetched: the queue has to be what
  // is LEFT, and a reload after every verdict both costs a round trip and moves the ground
  // under the next keystroke.
  const [done, setDone] = useState(() => new Set());
  const list = useAsync(() => api.get(`/admin/media-flags?status=${status}&page=${page}`), [status, page]);
  const stats = useAsync(() => api.get('/admin/media-hashes/stats'), []);
  useEffect(() => { setDone(new Set()); setAt(0); }, [status, page]);

  const all = list.data?.flags || [];
  const ownerFlags = list.data?.ownerFlags || {};
  const flags = useMemo(() => (status === 'pending' ? all.filter((f) => !done.has(f.id)) : all), [all, done, status]);
  const pages = Math.max(1, Math.ceil((list.data?.total || 0) / (list.data?.pageSize || 40)));
  const cur = flags[Math.min(at, Math.max(0, flags.length - 1))] || null;

  const resolve = useCallback(async (id, st) => {
    try {
      await api.post(`/admin/media-flags/${id}`, { status: st });
      if (status === 'pending' && st !== 'pending') {
        setDone((d) => new Set(d).add(id));
        stats.reload();
      } else { await list.reload(); stats.reload(); }
    } catch { toast.error(t('common.failed', 'Failed.')); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, list, stats]);

  // The keys. Ignored while something is being typed into, because a moderator who is writing
  // a note should not be marking flags acted on by pressing A.
  useEffect(() => {
    if (mode !== 'review') return undefined;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'j' || e.key === 'ArrowRight') { setAt((v) => Math.min(flags.length - 1, v + 1)); setBlink(false); }
      else if (k === 'k' || e.key === 'ArrowLeft') { setAt((v) => Math.max(0, v - 1)); setBlink(false); }
      else if (k === 'b') setBlink((v) => !v);
      else if (k === '?') setKeys((v) => !v);
      else if (cur && k === 'c') resolve(cur.id, 'cleared');
      else if (cur && k === 'a') resolve(cur.id, 'actioned');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, flags.length, cur, resolve]);

  const header = (
    <div className="flex items-center gap-2 flex-wrap">
      <h2 className="font-semibold flex items-center gap-2"><Images size={16} className="text-[var(--accent-ink)]" /> {t('adm.mf.title', 'Lookalike pictures')}</h2>
      {stats.data?.flags?.pending ? <Badge tone="warning">{stats.data.flags.pending}</Badge> : null}
      <div className="ms-auto flex items-center gap-2 flex-wrap">
        <div className="flex rounded-lg border border-[var(--line)] overflow-hidden text-[11px]">
          <button type="button" onClick={() => setMode('review')} className={`px-2.5 py-1 inline-flex items-center gap-1 ${mode === 'review' ? 'panel-quiet text-[var(--text)] font-medium' : 'text-[var(--muted)]'}`}><Maximize2 size={11} /> {t('adm.mf.mode.review', 'Review')}</button>
          <button type="button" onClick={() => setMode('list')} className={`px-2.5 py-1 inline-flex items-center gap-1 ${mode === 'list' ? 'panel-quiet text-[var(--text)] font-medium' : 'text-[var(--muted)]'}`}><Rows3 size={11} /> {t('adm.mf.mode.list', 'List')}</button>
        </div>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className="!w-auto">
          <option value="pending">{t('adm.mf.st.pending', 'Pending')}</option>
          <option value="cleared">{t('adm.mf.st.cleared', 'Cleared')}</option>
          <option value="actioned">{t('adm.mf.st.actioned', 'Acted on')}</option>
          <option value="all">{t('adm.mf.st.all', 'All')}</option>
        </Select>
        <Button size="sm" variant="ghost" onClick={() => { list.reload(); stats.reload(); }} title={t('common.refresh', 'Refresh')}><RefreshCw size={13} /></Button>
        <Button size="sm" variant="ghost" onClick={() => setShowCfg((v) => !v)}><Sliders size={13} /> {t('adm.mf.settings', 'Detection')}</Button>
      </div>
    </div>
  );

  const empty = (
    <EmptyState icon={Check} title={t('adm.mf.empty.t', 'Nothing flagged')}
      sub={status === 'pending' ? t('adm.mf.empty.s2', 'No picture is waiting on you. Detection keeps running, a new lookalike lands here on its own.') : t('adm.mf.empty.s', 'No picture in this state looks like another account’s.')}
      action={status === 'pending' ? null : { label: t('adm.mf.gopending', 'Back to what is pending'), icon: Check, onClick: () => { setStatus('pending'); setPage(0); } }} />
  );

  return (
    <div className="space-y-4">
      {header}
      <Explain summary={t('adm.mf.lead', 'A picture that looks like one another account uploaded earlier.')} className="text-[12px]">
        {t('adm.mf.desc', 'Clear it when it is a false positive or the same person on two accounts; mark it acted on once you have handled the account or the content. Detection never removes anything on its own.')}
      </Explain>
      {showCfg && <Settings stats={stats.data} onSaved={() => { stats.reload(); list.reload(); }} />}

      {list.loading && !list.data ? <div className="py-6 text-center"><Spinner /></div>
        : !flags.length ? empty
        : mode === 'review' && cur ? (
          <Card className="p-3 sm:p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap text-[12px]">
              <Verdicts f={cur} t={t} />
              <span className="ms-auto flex items-center gap-1.5">
                <Button size="sm" variant="ghost" disabled={at === 0} onClick={() => { setAt(at - 1); setBlink(false); }} aria-label={t('common.prev', 'Previous')}><ChevronLeft size={14} /></Button>
                <span className="tabular-nums text-[var(--faint)]">{Math.min(at + 1, flags.length)} / {flags.length}</span>
                <Button size="sm" variant="ghost" disabled={at + 1 >= flags.length} onClick={() => { setAt(at + 1); setBlink(false); }} aria-label={t('common.next', 'Next')}><ChevronRight size={14} /></Button>
              </span>
            </div>
            <Compare f={cur} t={t} ownerFlags={ownerFlags} blink={blink} onBlink={() => setBlink((v) => !v)} />
            <div className="flex items-center gap-2 flex-wrap">
              {!blink && <Button size="sm" variant="ghost" onClick={() => setBlink(true)} title={t('adm.mf.blink.t', 'Swap the two in the same frame, which is how a crop or a watermark becomes visible.')}><ArrowLeftRight size={13} /> {t('adm.mf.blink', 'Blink between them')}</Button>}
              <Verdict f={cur} resolve={resolve} t={t} />
              <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setKeys((v) => !v)} aria-expanded={keys}><Keyboard size={13} /> {t('adm.mf.keys', 'Shortcuts')}</Button>
            </div>
            {keys && (
              <ul className="text-[11px] text-[var(--muted)] flex flex-wrap gap-x-4 gap-y-1">
                <li><kbd>J</kbd> {t('adm.mf.k.next', 'next')}</li>
                <li><kbd>K</kbd> {t('adm.mf.k.prev', 'previous')}</li>
                <li><kbd>C</kbd> {t('adm.mf.clear', 'Clear')}</li>
                <li><kbd>A</kbd> {t('adm.mf.action', 'Acted on')}</li>
                <li><kbd>B</kbd> {t('adm.mf.blink', 'Blink between them')}</li>
              </ul>
            )}
          </Card>
        ) : (
          <div className="space-y-3">
            {flags.map((f) => (
              <Card key={f.id} className="p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap text-[12px]">
                  <Verdicts f={f} t={t} />
                  <span className="ms-auto"><Verdict f={f} resolve={resolve} t={t} /></span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[f.hash, f.match].map((h) => (
                    <div key={h.id} className="flex gap-2 min-w-0">
                      <div className="w-24 shrink-0"><Shot h={h} t={t} /></div>
                      <Who h={h} t={t} flags={h.ownerId ? ownerFlags[h.ownerId] || 0 : 0} />
                    </div>
                  ))}
                </div>
                <button type="button" className="text-[11px] text-[var(--accent-ink)] hover:underline inline-flex items-center gap-1"
                  onClick={() => { setMode('review'); setAt(flags.indexOf(f)); }}>
                  <Maximize2 size={11} /> {t('adm.mf.open', 'Look at this one properly')}
                </button>
              </Card>
            ))}
            {pages > 1 && <div className="flex items-center justify-center gap-2 text-[12px]">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('common.prev', 'Previous')}</Button>
              <span>{page + 1} / {pages}</span>
              <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t('common.next', 'Next')}</Button>
            </div>}
          </div>
        )}
      {/* The page control belongs to both modes: review walks one page at a time. */}
      {mode === 'review' && pages > 1 && flags.length > 0 && (
        <div className="flex items-center justify-center gap-2 text-[12px]">
          <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('common.prev', 'Previous')}</Button>
          <span>{t('adm.mf.pageof', 'Page')} {page + 1} / {pages}</span>
          <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t('common.next', 'Next')}</Button>
        </div>
      )}
    </div>
  );
}
