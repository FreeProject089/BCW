import { useEffect, useState } from 'react';
import { X, Tag } from 'lucide-react';
import { api } from './api.js';
import { useI18n } from './i18n.jsx';

// Site-wide promo announcement badge. Polls the public resolver for the campaign that
// is live right now and, if any (and not dismissed), shows a thin bar at the very top
// with the admin's custom message + the discount. Dismissal is per-campaign (a new
// campaign re-appears). Purely presentational — the actual discount is applied at
// checkout server-side.
const KEY = (id) => `bcw_promo_dismissed_${id}`;
const isHex = (s) => typeof s === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s);

function fmtLeft(ends, t) {
  const ms = new Date(ends).getTime() - Date.now();
  if (ms <= 0) return null;
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5);
  if (d >= 1) return `${d}${t('promo.badge.d', 'd')} ${h}${t('promo.badge.h', 'h')}`;
  const m = Math.floor((ms % 36e5) / 6e4);
  return `${h}${t('promo.badge.h', 'h')} ${m}${t('promo.badge.m', 'm')}`;
}

export default function PromoBadge() {
  const { t, lang } = useI18n();
  const [c, setC] = useState(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => api.get('/promo/campaign/active').then((r) => {
      if (!alive) return;
      const camp = r?.campaign;
      if (camp && camp.badgeEnabled) {
        try { if (localStorage.getItem(KEY(camp.id))) { setGone(true); } } catch {}
        setC(camp);
      } else { setC(null); }
    }).catch(() => {});
    load();
    const id = setInterval(load, 5 * 60 * 1000); // refresh so it appears/expires without a reload
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!c || gone) return null;
  const custom = (lang?.startsWith('fr') ? c.badgeMessageFr : c.badgeMessageEn) || '';
  const msg = custom || t('promo.badge.default', 'Limited-time offer');
  const accent = isHex(c.badgeColor) ? c.badgeColor : '';
  const left = fmtLeft(c.endsAt, t);
  const dismiss = () => { try { localStorage.setItem(KEY(c.id), '1'); } catch {} setGone(true); };

  return (
    <div
      role="status"
      className="relative z-50 flex items-center justify-center gap-2 px-9 py-1.5 text-[13px] font-semibold text-white text-center"
      style={accent
        ? { background: accent }
        : { background: 'linear-gradient(90deg, var(--primary), var(--primary-2))' }}
    >
      <Tag size={14} className="shrink-0 opacity-90" />
      <span className="truncate">{msg}</span>
      <span className="shrink-0 rounded-full bg-white/25 px-2 py-0.5 text-[12px] font-bold tabular-nums">−{c.percentOff}%</span>
      {left && <span className="shrink-0 hidden sm:inline opacity-90 tabular-nums">· {left}</span>}
      <button
        onClick={dismiss}
        aria-label={t('promo.badge.dismiss', 'Dismiss')}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-white/20"
      >
        <X size={14} />
      </button>
    </div>
  );
}
