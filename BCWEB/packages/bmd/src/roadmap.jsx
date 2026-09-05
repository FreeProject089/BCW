// `:::roadmap`, drawn by B.MD itself.
//
// This block used to be one of two that the kit could not draw: it rendered a dashed box
// reading "no roadmap component was provided" until the host app passed one in. That is a
// reasonable design for a component that needs a charting library, and this one needs
// nothing — a percentage is a div with a width — so the honest box was really a missing
// feature with a polite label on it.
//
// It reads the shape the parser already produces from `:::stage` children, and the richer
// one a `src=` JSON can carry:
//
//   { categories: [ { name, items: [ { label, status, percent, eta } ] } ], art, code, lastUpdate }
//
// plus the flat legacy array `[ { title, status, percent, eta } ]`, because documents using
// it exist and a renderer that drops them is a renderer that lost somebody's page.
//
// A host with a better tracker still passes `roadmap={Mine}` — nothing here takes that away.
import { CheckCircle2, Clock, Circle, CalendarDays, ListTodo } from 'lucide-react';

const STATUS = {
  done: { icon: CheckCircle2, cls: 'doc-rm-done' },
  progress: { icon: Clock, cls: 'doc-rm-progress' },
  'in-progress': { icon: Clock, cls: 'doc-rm-progress' },
  planned: { icon: Circle, cls: 'doc-rm-planned' },
};

/** `{ en, fr }` → the reader's language; anything else through unchanged. */
const pick = (v, lang) => (v && typeof v === 'object' && !Array.isArray(v))
  ? (v[lang] ?? v.en ?? Object.values(v)[0])
  : v;

const pctOf = (it) => (it.status === 'done' ? 100 : Math.max(0, Math.min(100, Number(it.percent) || 0)));

function Bar({ pct, small }) {
  return (
    // `aria-hidden`: the number is printed next to every bar, so a screen reader that also
    // announced the bar would read each figure twice.
    <div aria-hidden className={small ? 'doc-rm-bar doc-rm-bar-sm' : 'doc-rm-bar'}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function Roadmap({ data, title, lang = 'en' }) {
  const fr = lang === 'fr';
  const legacy = Array.isArray(data?.legacy) ? data.legacy : (Array.isArray(data) ? data : null);
  const cats = legacy
    ? [{ name: title, items: legacy.map((it) => ({ label: it.title, status: it.status === 'in-progress' ? 'progress' : it.status, percent: it.percent, eta: it.eta })) }]
    : (data?.categories || []);
  const all = cats.flatMap((c) => c.items || []);
  if (!all.length) return null;

  const overall = Math.round(all.reduce((a, it) => a + pctOf(it), 0) / all.length);
  const done = all.filter((i) => i.status === 'done').length;
  const active = all.filter((i) => i.status === 'progress' || i.status === 'in-progress').length;
  const planned = all.length - done - active;

  return (
    <section className="doc-rm">
      <header className="doc-rm-head">
        <h3 className="doc-rm-title"><ListTodo size={16} aria-hidden /> {title}</h3>
        {/* The summary is one sentence rather than four chips: it is read once, and four
            boxes of numbers at the top of a roadmap compete with the roadmap. */}
        <p className="doc-rm-sum">
          <b>{overall}%</b> {fr ? 'global' : 'overall'} · {done} {fr ? 'faits' : 'done'} · {active} {fr ? 'en cours' : 'active'} · {planned} {fr ? 'prévus' : 'planned'}
        </p>
      </header>

      {(data?.art != null || data?.code != null || data?.lastUpdate) && (
        <div className="doc-rm-meters">
          {data.art != null && <div className="doc-rm-meter"><span>{fr ? 'Art' : 'Art'}</span><Bar pct={Number(data.art) || 0} /><b>{Number(data.art) || 0}%</b></div>}
          {data.code != null && <div className="doc-rm-meter"><span>{fr ? 'Code' : 'Code'}</span><Bar pct={Number(data.code) || 0} /><b>{Number(data.code) || 0}%</b></div>}
          {data.lastUpdate && <div className="doc-rm-updated"><CalendarDays size={12} aria-hidden /> {pick(data.lastUpdate, lang)}</div>}
        </div>
      )}

      {cats.map((c, ci) => (
        <div key={ci} className="doc-rm-cat">
          {c.name && <div className="doc-rm-catname">{pick(c.name, lang)}</div>}
          <ul className="doc-rm-items">
            {(c.items || []).map((it, i) => {
              const st = STATUS[it.status] || STATUS.planned;
              const pct = pctOf(it);
              return (
                <li key={i} className={`doc-rm-item ${st.cls}`}>
                  <st.icon size={15} aria-hidden className="doc-rm-ico" />
                  <span className="doc-rm-label">{pick(it.label ?? it.title, lang)}</span>
                  {it.eta && <span className="doc-rm-eta"><CalendarDays size={11} aria-hidden /> {it.eta}</span>}
                  <Bar pct={pct} small />
                  {/* The figure, as text, is what makes the bar accessible — and it is also
                      the thing anybody actually reads. */}
                  <span className="doc-rm-pct">{pct}%</span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
