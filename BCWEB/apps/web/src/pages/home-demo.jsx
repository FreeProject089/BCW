// The product, shown rather than described: a small window with the three things people do
// here (find something, install it, host their own), one tab each.
//
// It stands where the landing page shows its media. When an admin has configured the project
// showcase, THAT is the demo and this is not drawn; this is what fills the frame on a site that
// has not, which used to be an empty rectangle with a sparkle in it.
//
// Everything in the window is an illustration of the interface, drawn from the same tokens as
// the real one, and says so (the caption under it). The entries are generic ("A texture pack"),
// not invented products with invented download counts: a demo that makes up numbers is the
// one kind of marketing this site has decided not to do.
//
// The tabs are the WAI-ARIA pattern (roving tabindex, arrows / Home / End), and every panel is
// rendered, stacked in one grid cell, the hidden ones `visibility: hidden`: the window is as tall
// as its tallest panel, so switching tabs never moves the page. Nothing rotates on its own.
import { useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Download, CheckCircle2, BadgeCheck, Users, Cloud, Link2, Globe, ArrowRight, Package, Palette, Server } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { HandNote } from '../ui/marker.jsx';

export default function HomeDemo({ className = '' }) {
  const { t } = useI18n();
  const uid = useId();
  const refs = useRef({});
  const tabs = [
    { id: 'browse', label: t('home.demo.t1', 'Find'), where: t('home.demo.w1', 'Catalogue') },
    { id: 'install', label: t('home.demo.t2', 'Install'), where: 'BetterModsManager' },
    { id: 'host', label: t('home.demo.t3', 'Host'), where: t('home.demo.w3', 'Hosting') },
  ];
  const [tab, setTab] = useState('browse');
  const onKey = (e, i) => {
    const n = tabs.length;
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n
      : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    setTab(tabs[to].id);
    refs.current[tabs[to].id]?.focus();
  };
  const cur = tabs.find((x) => x.id === tab);

  const rows = [
    [Palette, t('home.demo.r1', 'A texture pack'), true],
    [Server, t('home.demo.r2', 'A server preset'), false],
    [Package, t('home.demo.r3', 'An interface mod'), false],
  ];

  const panel = (id, children) => (
    <div key={id} id={`${uid}-p-${id}`} role="tabpanel" aria-labelledby={`${uid}-t-${id}`}
      tabIndex={tab === id ? 0 : undefined} aria-hidden={tab === id ? undefined : true}
      className="[grid-area:1/1] min-w-0 p-4 sm:p-6 outline-none" style={{ visibility: tab === id ? 'visible' : 'hidden' }}>
      {children}
    </div>
  );

  return (
    <figure className={`home-demo m-0 text-start ${className}`}>
      <div className="card overflow-hidden">
        {/* The window's own chrome: three dots and where you are. */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--line)] bg-[var(--surface-2)]">
          <span aria-hidden className="flex gap-1.5 shrink-0">
            {[0, 1, 2].map((i) => <i key={i} className="block w-2.5 h-2.5 rounded-full bg-[var(--line-strong)]" />)}
          </span>
          <span className="min-w-0 flex-1 text-center text-[12px] text-[var(--muted)] truncate" title={cur.where}>{cur.where}</span>
          <span aria-hidden className="w-[42px] shrink-0" />
        </div>

        <div role="tablist" aria-label={t('home.demo.tabs', 'What you can do here')}
          className="flex flex-wrap gap-1.5 px-4 sm:px-6 pt-4">
          {tabs.map(({ id, label }, i) => {
            const on = tab === id;
            return (
              <button key={id} ref={(el) => { refs.current[id] = el; }} type="button" role="tab"
                id={`${uid}-t-${id}`} aria-selected={on} aria-controls={`${uid}-p-${id}`} tabIndex={on ? 0 : -1}
                onClick={() => setTab(id)} onKeyDown={(e) => onKey(e, i)}
                className={`tap-44 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${on ? 'border-[var(--primary)] text-[var(--accent-ink)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--line-strong)]'}`}
                style={on ? { background: 'color-mix(in srgb, var(--primary) 10%, transparent)' } : undefined}>
                <span aria-hidden className="tabular-nums opacity-70">{i + 1}</span>{label}
              </button>
            );
          })}
        </div>

        <div className="grid">
          {panel('browse', (
            <>
              <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-[13px] text-[var(--faint)]" aria-hidden>
                <Search size={14} className="shrink-0" /> <span className="truncate">{t('home.demo.search', 'Search mods, presets, repos')}</span>
              </div>
              <ul className="mt-3 flex flex-col gap-2">
                {rows.map(([Icon, name, official], i) => (
                  <li key={name} className="flex items-center gap-3 rounded-xl border border-[var(--line)] p-3 min-w-0">
                    <span aria-hidden className="grid place-items-center w-9 h-9 rounded-lg shrink-0 border border-[var(--line)]"
                      style={{ background: `color-mix(in srgb, var(--primary) ${18 - i * 5}%, var(--surface-2))` }}>
                      <Icon size={17} className="text-[var(--accent-ink)]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold leading-snug">{name}</span>
                      <span className="flex items-center gap-1 text-[11.5px] text-[var(--muted)] mt-0.5">
                        {official ? <BadgeCheck size={12} className="text-success shrink-0" /> : <Users size={12} className="shrink-0" />}
                        {official ? t('home.demo.official', 'Official catalogue') : t('home.demo.community', 'Community catalogue')}
                      </span>
                    </span>
                    <span className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold btn-primary" aria-hidden>
                      <Download size={13} /> {t('home.demo.install', 'Install')}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex justify-end">
                <HandNote arrow="up">{t('home.demo.note1', 'One click, and it is in the app')}</HandNote>
              </div>
            </>
          ))}

          {panel('install', (
            <>
              <div className="rounded-xl border border-[var(--line)] p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 size={20} className="text-success shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold leading-snug">{t('home.demo.done', 'Installed: A texture pack')}</div>
                    <div className="text-[12.5px] text-[var(--muted)] mt-1 leading-relaxed">{t('home.demo.done.d', 'The catalogue link opened BetterModsManager, which fetched it and added it to your profile.')}</div>
                  </div>
                </div>
                <div className="mt-4 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden" aria-hidden>
                  <div className="h-full w-full rounded-full bg-success" />
                </div>
              </div>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2 text-[12.5px]">
                {[t('home.demo.i1', 'No manual download'), t('home.demo.i2', 'No hunting for files')].map((x) => (
                  <li key={x} className="flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2">
                    <CheckCircle2 size={14} className="text-success shrink-0" /> <span className="min-w-0">{x}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <HandNote arrow="up">{t('home.demo.note2', 'It lands where the app expects it')}</HandNote>
              </div>
            </>
          ))}

          {panel('host', (
            <>
              <div className="rounded-xl border border-[var(--line)] p-4">
                <div className="flex items-center gap-2 text-[13px] font-semibold"><Cloud size={15} className="text-[var(--accent-ink)] shrink-0" /> {t('home.demo.pool', 'Your storage pool')}</div>
                <div className="mt-3 h-8 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] overflow-hidden flex" aria-hidden>
                  {[['40%', 'var(--primary)'], ['24%', 'color-mix(in srgb, var(--primary) 60%, var(--surface-2))'], ['16%', 'color-mix(in srgb, var(--primary-2) 45%, var(--surface-2))']].map(([w, bg]) => (
                    <i key={w} className="block h-full" style={{ width: w, background: bg, marginInlineEnd: 2 }} />
                  ))}
                </div>
                <div className="mt-2 text-[12px] text-[var(--muted)]">{t('home.demo.pool.d', 'Two repos and a catalogue, sharing one space, with room left.')}</div>
              </div>
              <ul className="mt-3 flex flex-col gap-2 text-[12.5px]">
                <li className="flex items-center gap-2"><Link2 size={14} className="text-[var(--accent-ink)] shrink-0" /> <span className="min-w-0">{t('home.demo.h1', 'A stable address anything can sync from')}</span></li>
                <li className="flex items-center gap-2"><Globe size={14} className="text-[var(--accent-ink)] shrink-0" /> <span className="min-w-0">{t('home.demo.h2', 'Your own domain, on a paid pool')}</span></li>
              </ul>
              <div className="mt-3 flex justify-end">
                <HandNote arrow="up">{t('home.demo.note3', 'Split it however you like')}</HandNote>
              </div>
            </>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3 border-t border-[var(--line)] bg-[var(--surface-2)]">
          <figcaption className="text-[11.5px] text-[var(--muted)] min-w-0">{t('home.demo.caption', 'An illustration of the interface, not live data.')}</figcaption>
          <Link to={tab === 'host' ? '/hosting' : '/catalog'} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--accent-ink)] hover:underline min-h-[24px] max-lg:min-h-[44px]">
            {tab === 'host' ? t('home.demo.go3', 'See the hosting plans') : t('home.demo.go1', 'Open the catalogue')} <ArrowRight size={14} className="rtl-mirror" />
          </Link>
        </div>
      </div>
    </figure>
  );
}
