// The React half of B.MD: one component per block the parser emits.
//
// Each is reached through the component map in index.jsx, never imported by a page. They read
// their inputs off `node.properties`, in both the camelCased hast form and the dashed form,
// because which one arrives depends on whether the value survived sanitising.
import { useContext, useState, useEffect, useMemo, useId, useRef, Children } from 'react';
import { MarkdownConfig } from './config.js';
import { IconGlyph } from './icons.jsx';

/* kit:injected:start */
/** A block whose component was not supplied. Says which, rather than rendering nothing. */
export function MissingBlock({ name }) {
  return (
    <div className="doc-roadmap doc-roadmap-empty text-sm text-[var(--faint)] rounded-xl border border-dashed border-[var(--line)] p-4">
      {`This page uses a :::${name} block, and no ${name} component was provided to <Markdown>.`}
    </div>
  );
}
/* kit:injected:end */

// Keyboard shortcut: "Ctrl+Shift+S" → styled <kbd> keys.
export function DocKbd({ node }) {
  const p = node?.properties || {};
  const keys = String(p.dataKeys || p['data-keys'] || '').split(/[+\s]+/).filter(Boolean);
  return <span className="doc-kbd">{keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</span>;
}
// Inline comment/annotation: dashed-underline text that reveals a card (text +
// optional image + link) on hover/focus. Authored via the selection toolbar.
export function DocComment({ node, children }) {
  const p = node?.properties || {};
  const text = p.dataComment || p['data-comment'] || '';
  const link = p.dataLink || p['data-link'] || '';
  const img = p.dataImg || p['data-img'] || '';
  const video = p.dataVideo || p['data-video'] || '';
  const [open, setOpen] = useState(false);
  return (
    // `role="button"` and `aria-expanded` because this IS a disclosure and only looked like
    // one: it was a focusable span with a hover handler, so a screen reader announced the
    // words and nothing about there being anything behind them. Escape closes it, which is
    // what every other popover on a page does.
    <span className="doc-comment" tabIndex={0} role="button" aria-expanded={open}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); }
      }}
      onClick={() => setOpen((v) => !v)}>
      {children}
      {open && (text || img || video || link) && (
        <span className="doc-comment-card" onClick={(e) => e.stopPropagation()}>
          {img && <img src={img} alt="" className="doc-comment-img" />}
          {video && <video src={video} controls className="doc-comment-img" />}
          {text && <span className="doc-comment-text">{text}</span>}
          {link && <a href={link} target="_blank" rel="noopener noreferrer" className="doc-comment-link">{link.replace(/^https?:\/\//, '').slice(0, 40)}</a>}
        </span>
      )}
    </span>
  );
}

export function matchesLang(name, lang) {
  const n = (name || '').toLowerCase();
  const other = lang === 'fr' ? '_en' : '_fr';
  if (n.replace(/\.md$/, '').endsWith(other)) return false;
  return true;
}

/* kit:injected:start */
// Roadmap / progress tracker embedded in blog & docs. Data comes from a remote
// `.json` (data-src, fetched client-side) or an inline JSON block (data-json) —
// both render the same customisable ProgressTracker used on the project pages.
export function DocRoadmap({ node }) {
  const { lang, Roadmap } = useContext(MarkdownConfig);
  const p = node?.properties || {};
  const src = p.dataSrc || p['data-src'] || '';
  const rawJson = p.dataJson || p['data-json'] || '';
  const title = p.dataTitle || p['data-title'] || (lang === 'fr' ? 'Feuille de route' : 'Roadmap');
  const inline = useMemo(() => {
    if (!rawJson) return null;
    try { return { data: JSON.parse(rawJson) }; } catch { return { error: true }; }
  }, [rawJson]);
  const [remote, setRemote] = useState(null);
  const [fetchErr, setFetchErr] = useState(false);
  useEffect(() => {
    if (!src) return;
    let alive = true; setFetchErr(false);
    fetch(src).then((r) => { if (!r.ok) throw new Error('http'); return r.json(); })
      .then((j) => { if (alive) setRemote(j); })
      .catch(() => { if (alive) setFetchErr(true); });
    return () => { alive = false; };
  }, [src]);
  const data = remote ?? inline?.data ?? null;
  if (!Roadmap) return <MissingBlock name="roadmap" />;
  if (data) return <div className="doc-roadmap">{<Roadmap data={data} title={title} lang={lang} />}</div>;
  const msg = fetchErr ? (lang === 'fr' ? 'Impossible de charger la feuille de route.' : 'Could not load the roadmap.')
    : inline?.error ? (lang === 'fr' ? 'JSON de feuille de route invalide.' : 'Invalid roadmap JSON.')
    : src ? (lang === 'fr' ? 'Chargement…' : 'Loading…')
    : (lang === 'fr' ? 'Feuille de route vide — fournis un « src » ou un bloc JSON.' : 'Empty roadmap — provide a "src" or a JSON block.');
  return <div className="doc-roadmap doc-roadmap-empty text-sm text-[var(--faint)] rounded-xl border border-dashed border-[var(--line)] p-4">{msg}</div>;
}

// The `:::replay` directive, wired to the shared player.
//
// The player itself used to live here, ~120 lines of rrweb wiring reachable only through this
// directive. It now lives in ui/ReplayPlayer.jsx so the moderation inspector can show the same
// thing: one player means a format either plays everywhere or nowhere, never "works in docs,
// looks broken in review".
export function DocReplay({ node }) {
  const { Replay } = useContext(MarkdownConfig);
  const p = node?.properties || {};
  if (!Replay) return <MissingBlock name="replay" />;
  return (
    <Replay
      src={p.dataSrc || p['data-src'] || ''}
      title={p.dataTitle || p['data-title'] || ''}
      autoplay={(p.dataAutoplay || p['data-autoplay']) === 'true'}
      loop={(p.dataLoop || p['data-loop']) === 'true'}
    />
  );
}
/* kit:injected:end */

/* ── Times and timezones ──────────────────────────────────────────────────────
   Two shapes, because two questions get asked and only one has an exact answer. */

/** The reader's own zone, or a sensible answer when the browser will not say. */
function readerZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/**
 * What a wall-clock time in `tz` is in UTC, on a given date.
 *
 * There is no built-in for this. The trick is the standard one: format the instant IN the
 * zone, read back what the clock there said, and the difference between that and the input is
 * the offset. Done for a SPECIFIC date, which is what makes daylight saving come out right —
 * the same wall-clock time has two different offsets in a year.
 */
function zoneOffsetMs(dateUtcMs, tz) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = Object.fromEntries(dtf.formatToParts(new Date(dateUtcMs)).map((x) => [x.type, x.value]));
    // `hour` comes back as 24 at midnight in some engines, which Date.UTC reads as the next
    // day — correct arithmetic, wrong day, and a silent one-day error.
    const h = p.hour === '24' ? 0 : Number(p.hour);
    const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), h, Number(p.minute), Number(p.second));
    return asUtc - dateUtcMs;
  } catch { return 0; }
}

/**
 * One instant, in the reader's own zone.
 *
 *   :time[2026-09-01T20:00]{tz=Europe/Paris}
 *
 * The date is what makes this exact: it settles which side of a daylight-saving change the
 * time falls on. That is precisely why a weekly `:::schedule` row is NOT converted.
 *
 * A time that cannot be parsed is shown as written rather than as "Invalid Date". Somebody
 * reading a page should see what the author typed, not the failure of a parser.
 */
export function DocTime(props) {
  const raw = String(props['data-at'] || props.dataAt || '').trim();
  const tz = String(props['data-tz'] || props.dataTz || '').trim();
  if (!raw) return null;

  // Parsed as a wall-clock time in `tz`, not as whatever the browser's zone happens to be:
  // `new Date('2026-09-01T20:00')` is LOCAL time, so without this the answer would be right
  // only for readers who already live in the author's zone.
  const naive = Date.parse(raw.includes('T') ? `${raw}Z` : `${raw.replace(' ', 'T')}Z`);
  if (Number.isNaN(naive)) return <span className="doc-time">{raw}</span>;
  const instant = tz ? naive - zoneOffsetMs(naive, tz) : naive;

  const here = readerZone();
  let shown;
  try {
    shown = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium', timeStyle: 'short', timeZone: here,
    }).format(new Date(instant));
  } catch { return <span className="doc-time">{raw}</span>; }

  return (
    <time className="doc-time" dateTime={new Date(instant).toISOString()}
      title={tz ? `${raw} ${tz}` : raw}>
      {shown}
      <span className="doc-time-zone">{here}</span>
    </time>
  );
}

/**
 * A repeating schedule, stated in one zone.
 *
 * The rows are shown AS WRITTEN. Converting them would be a lie: "Monday 09:00 Europe/Paris"
 * is 09:00 in Paris every week of the year, and what moves across a daylight-saving boundary
 * is how far that is from the reader — so a converted row would be right today and wrong in
 * March, with nothing on the page admitting it.
 *
 * What IS computed is the difference, right now, said out loud as being for right now.
 */
export function DocSchedule({ children, ...props }) {
  const tz = String(props['data-tz'] || props.dataTz || '').trim();
  const title = String(props['data-title'] || props.dataTitle || '').trim();
  const here = readerZone();

  let note = null;
  if (tz && tz !== here) {
    const now = Date.now();
    const diffMin = Math.round((zoneOffsetMs(now, here) - zoneOffsetMs(now, tz)) / 60000);
    if (diffMin !== 0) {
      const h = Math.floor(Math.abs(diffMin) / 60);
      const m = Math.abs(diffMin) % 60;
      const span = m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
      note = `${here} is ${span} ${diffMin > 0 ? 'ahead of' : 'behind'} ${tz} right now`;
    } else {
      note = `${here} is on the same clock as ${tz} right now`;
    }
  }

  return (
    <div className="doc-schedule">
      <div className="doc-schedule-head">
        <span className="doc-schedule-title">{title || 'Hours'}</span>
        {tz && <span className="doc-schedule-tz">{tz}</span>}
      </div>
      <div className="doc-schedule-body">{children}</div>
      {/* "right now" is not hedging — it is the only true form of this sentence, because the
          difference changes twice a year and this page does not re-render when it does. */}
      {note && <p className="doc-schedule-note">{note}</p>}
    </div>
  );
}

/**
 * Tabs, with the open one in this component and nothing in the markdown.
 *
 * Titles are read off the panels rather than declared twice, so a tab's label and its content
 * cannot drift apart. A panel with no title gets a number: better than an empty tab strip, and
 * it says which one to go and name.
 */
export function DocTabs({ children }) {
  const panels = Children.toArray(children)
    .filter((c) => c?.props?.className?.includes?.('doc-tab'));
  const [open, setOpen] = useState(0);
  // One id per instance, so two `:::tabs` on a page do not both claim `#doc-tab-0`. A
  // duplicated id makes `aria-controls` point at whichever came first, which is the shape of
  // accessibility bug that is invisible to everyone who is not using it.
  const uid = useId();
  const bar = useRef(null);
  if (!panels.length) return null;
  const titleOf = (p, i) => {
    const t = p.props?.['data-title'] || p.props?.dataTitle;
    return (t && String(t).trim()) || `${i + 1}`;
  };
  const tabId = (i) => `${uid}-tab-${i}`;
  const panelId = (i) => `${uid}-panel-${i}`;

  /**
   * The arrow keys, because a tab strip that only answers to Tab is a list of buttons.
   *
   * Roving tabindex: exactly one tab is in the tab order and the arrows move between them,
   * which is what a screen-reader user is told to expect the moment `role="tablist"` is
   * announced. Without it the role is a promise the widget does not keep.
   */
  const onKeyDown = (e) => {
    const last = panels.length - 1;
    const to = e.key === 'ArrowRight' ? (open === last ? 0 : open + 1)
      : e.key === 'ArrowLeft' ? (open === 0 ? last : open - 1)
        : e.key === 'Home' ? 0
          : e.key === 'End' ? last
            : null;
    if (to === null) return;
    e.preventDefault();
    setOpen(to);
    bar.current?.querySelectorAll('.doc-tabs-btn')[to]?.focus();
  };

  return (
    <div className="doc-tabs">
      <div className="doc-tabs-bar" role="tablist" ref={bar} onKeyDown={onKeyDown}>
        {panels.map((p, i) => (
          <button key={i} type="button" role="tab" id={tabId(i)} aria-controls={panelId(i)}
            aria-selected={i === open} tabIndex={i === open ? 0 : -1}
            className={`doc-tabs-btn${i === open ? ' is-on' : ''}`} onClick={() => setOpen(i)}>
            {titleOf(p, i)}
          </button>
        ))}
      </div>
      {panels.map((p, i) => (
        // Rendered and hidden rather than unmounted: a code block's highlighting and an
        // image's download are paid once, and switching back is instant.
        //
        // `tabIndex={0}` on the panel so a keyboard can scroll a long one — it holds
        // arbitrary content, and content you cannot reach is content you cannot read.
        <div key={i} role="tabpanel" id={panelId(i)} aria-labelledby={tabId(i)}
          tabIndex={i === open ? 0 : -1} hidden={i !== open}>{p}</div>
      ))}
    </div>
  );
}

