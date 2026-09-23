import { useEffect, useRef, useState } from 'react';
import { X, Sparkles, PartyPopper, Flag, Gift, Star, Rocket, CalendarDays, Bell, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { fxAllowed } from '../lib/fx-pref.js';

// Announcement icon options (named lucide icons — never a unicode emoji).
const BADGE_ICONS = { sparkles: Sparkles, party: PartyPopper, flag: Flag, gift: Gift, star: Star, rocket: Rocket, calendar: CalendarDays, bell: Bell };

// Small flag image (same CDN the rest of the app uses) — shown in the event badge.
const flagUrl = (cc) => `https://flagcdn.com/32x24/${String(cc).toLowerCase()}.png`;

// Does this event play fireworks?
//
// `effect` is an optional enum whose only value is 'fireworks', and the admin form never
// set it — so every event created there stored `effect: undefined` and the canvas never
// ran. A New Year or a national day with no fireworks is not a configuration, it is the
// feature missing, so those two kinds now imply them and only a `custom` event has to ask.
// Kept as a check on the LIVE event rather than a fix in the form alone, because events
// already saved would otherwise stay silent.
export function wantsFireworks(ev) {
  if (!ev) return false;
  if (ev.effect === 'none') return false; // an explicit opt-out still wins
  return ev.effect === 'fireworks' || ev.kind === 'new_year' || ev.kind === 'national_holiday';
}

export default function EventEffect() {
  const { t, lang } = useI18n();
  const [ev, setEv] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  // Ad-hoc preview config, fired from the admin Events page via a window event — plays
  // the fireworks on demand (ignoring reduce-motion / the live-event gate) so an admin
  // can actually SEE and tune density / flag drops / the country flag before going live.
  const [preview, setPreview] = useState(null);
  const mount = useRef(null);

  useEffect(() => {
    let alive = true;
    api.get('/events/active').then((r) => { if (alive) setEv(r?.event || null); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onPreview = (e) => setPreview({ effect: 'fireworks', kind: 'custom', ...(e.detail || {}) });
    window.addEventListener('bcw:fx-preview', onPreview);
    return () => window.removeEventListener('bcw:fx-preview', onPreview);
  }, []);

  // Respect prefers-reduced-motion (no canvas, announcement only). A localStorage
  // override (`bcw_fx_preview=1`) forces the effect on — a preview hook for admins
  // (and for testing in reduced-motion environments like headless browsers).
  let forcePreview = false;
  try { forcePreview = localStorage.getItem('bcw_fx_preview') === '1'; } catch {}
  // One shared rule (lib/fx-pref.js), not a copy. The old inline version let
  // prefers-reduced-motion veto the effect with no override, while Settings showed the
  // switch as ON — so on a machine with reduced motion enabled the admin preview played
  // and the live event did nothing, with the UI insisting it was enabled.
  const reduced = !fxAllowed({ force: forcePreview });

  useEffect(() => {
    // A preview always plays (bypasses reduce-motion + the live gate); otherwise the
    // live event plays when it's a fireworks effect and motion is allowed.
    const fx = preview || (ev && wantsFireworks(ev) && !reduced && !dismissed ? ev : null);
    if (!fx) return;
    const el = mount.current; if (!el) return;
    // No WebGL2 → skip the effect silently (no THREE console errors). This is a pure
    // overlay, so nothing else depends on it running.
    try { if (!window.WebGL2RenderingContext || !document.createElement('canvas').getContext('webgl2')) return; } catch { return; }
    // M18 (agent-perf-M18): three.js and GSAP arrive with the show, not with the page.
    // fireworks.js is fetched the first time there is something to draw, so a visitor on a
    // day without an event never downloads either library for this overlay.
    let stop = null, cancelled = false;
    import('./fireworks.js')
      .then((m) => { if (!cancelled) stop = m.startFireworks(el, fx, { oneShot: !!preview, onDone: () => setPreview(null) }) || null; })
      .catch(() => { /* a decorative overlay: a failed fetch leaves the page as it is */ });
    return () => { cancelled = true; if (stop) stop(); };
  }, [ev, reduced, dismissed, preview]);

  if ((!ev || dismissed) && !preview) return null;
  // `ev` can be null during a preview-only run — keep every access optional so a preview
  // fired before any event is live never crashes the app (that was the real "fireworks
  // don't work": the render threw on ev.titleEn and blanked the page).
  const title = (lang?.startsWith('fr') ? ev?.titleFr : ev?.titleEn) || '';
  const message = (lang?.startsWith('fr') ? ev?.messageFr : ev?.messageEn) || '';
  const BadgeIcon = BADGE_ICONS[ev?.badgeIcon] || Sparkles;
  if (!title && !message && reduced && !preview) return null;

  const isHoliday = ev?.kind === 'national_holiday' && ev?.countryCode;
  const link = ev?.linkUrl || null;
  const external = link && /^https?:\/\//.test(link);
  // Icon + text + (a "go" arrow when the badge links somewhere).
  const inner = (
    <>
      {isHoliday
        ? <img src={flagUrl(ev.countryCode)} alt="" width={32} height={24} className="shrink-0 rounded-[3px] object-cover ring-1 ring-[var(--line-strong)]" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        : <BadgeIcon size={24} className="shrink-0 text-[var(--accent-ink)]" />}
      <div className="min-w-0 flex-1">
        {title && <div className="font-bold gradient-text text-base sm:text-lg leading-tight truncate" title={title}>{title}</div>}
        {message && <div className="text-xs sm:text-sm text-[var(--muted)] truncate" title={message}>{message}</div>}
      </div>
      {link && <ArrowRight size={16} className="shrink-0 text-[var(--faint)]" />}
    </>
  );
  const rowCls = `flex items-center gap-2.5 sm:gap-3 px-3.5 sm:px-5 py-2.5 sm:py-3 pe-9 ${link ? 'rounded-2xl transition hover:panel' : ''}`;
  return (
    <>
      {(!reduced || preview) && <div ref={mount} aria-hidden className="fixed inset-0 z-[45]" style={{ pointerEvents: 'none' }} />}
      {(title || message) && (
        <div className="fixed left-1/2 -translate-x-1/2 top-16 md:top-20 z-[46] w-[min(94vw,26rem)] anim-fade" style={{ pointerEvents: 'auto' }}>
          <div className="relative rounded-2xl border border-[var(--line-strong)] shadow-2xl overflow-hidden" style={{ background: 'var(--bg-solid)' }}>
            {link
              ? (external
                ? <a href={link} target="_blank" rel="noopener noreferrer" className={rowCls}>{inner}</a>
                : <Link to={link} onClick={() => setDismissed(true)} className={rowCls}>{inner}</Link>)
              : <div className={rowCls}>{inner}</div>}
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDismissed(true); }} aria-label={t('promo.badge.dismiss', 'Dismiss')} className="absolute right-1.5 top-1.5 rounded p-1 text-[var(--faint)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"><X size={15} /></button>
          </div>
        </div>
      )}
    </>
  );
}
