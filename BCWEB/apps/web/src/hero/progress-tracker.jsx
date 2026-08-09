// Shared progress / roadmap tracker. Extracted from project.jsx so it can be reused
// both on the project pages AND inside blog/docs Markdown (the `:::roadmap` block) —
// project.jsx imports md.jsx, so md.jsx can't import back from project.jsx without a
// cycle. Renders the rich bilingual progress.json shape:
//   { lastUpdate, art, code, categories: [{ name, items:[{ label, status, percent, eta }] }] }
// and the legacy flat array [{ title, status, percent, eta }].
import { CheckCircle2, Clock, Circle, CalendarDays, ListTodo } from 'lucide-react';
import { Card } from '../ui/ui.jsx';

const PROG_STATUS = {
  done: { tone: 'green', icon: CheckCircle2, label: 'Done', color: 'text-success' },
  'in-progress': { tone: 'amber', icon: Clock, label: 'In progress', color: 'text-warning' },
  progress: { tone: 'amber', icon: Clock, label: 'In progress', color: 'text-warning' },
  planned: { tone: '', icon: Circle, label: 'Planned', color: 'text-[var(--faint)]' },
};
// Bilingual value picker: { en, fr } → the active language (fallback en); plain → as-is.
const pickLang = (v, lang) => (v && typeof v === 'object' && !Array.isArray(v)) ? (v[lang] ?? v.en ?? Object.values(v)[0]) : v;

function Meter({ label, pct }) {
  return (
    <div className="flex-1 min-w-[140px]">
      <div className="flex items-center justify-between mb-1 text-sm"><span className="text-[var(--muted)]">{label}</span><b>{pct}%</b></div>
      <div className="h-2.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-brand to-brand-2 transition-all" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
    </div>
  );
}
function ProgressItem({ it, lang }) {
  const m = PROG_STATUS[it.status] || PROG_STATUS.planned;
  const pct = it.status === 'done' ? 100 : (it.percent || 0);
  return (
    <div className="flex items-center gap-3 py-2">
      <m.icon size={15} className={`${m.color} shrink-0`} />
      <div className="flex-1 min-w-0 text-sm truncate">{pickLang(it.label ?? it.title, lang)}</div>
      {it.eta && <span className="text-xs text-[var(--faint)] hidden sm:flex items-center gap-1"><CalendarDays size={11} /> {it.eta}</span>}
      <div className="w-24 sm:w-32 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-brand to-brand-2" style={{ width: `${pct}%` }} /></div>
      <span className="text-xs text-[var(--muted)] w-9 text-right tabular-nums">{pct}%</span>
    </div>
  );
}
export function ProgressTracker({ data, title, lang }) {
  const legacy = Array.isArray(data?.legacy) ? data.legacy : (Array.isArray(data) ? data : null);
  const cats = legacy
    ? [{ name: title, items: legacy.map((it) => ({ label: it.title, status: it.status === 'in-progress' ? 'progress' : it.status, percent: it.percent, eta: it.eta })) }]
    : (data?.categories || []);
  const all = cats.flatMap((c) => c.items || []);
  const avg = (its) => its.length ? Math.round(its.reduce((a, it) => a + (it.status === 'done' ? 100 : (it.percent || 0)), 0) / its.length) : 0;
  const overall = avg(all);
  const counts = {
    done: all.filter((i) => i.status === 'done').length,
    prog: all.filter((i) => i.status === 'progress' || i.status === 'in-progress').length,
    plan: all.filter((i) => !i.status || i.status === 'planned').length,
  };
  return (
    <section>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-semibold flex items-center gap-2"><ListTodo size={16} className="text-[var(--primary-2)]" /> {title}</h2>
        <span className="text-sm text-[var(--muted)]"><b className="text-[var(--text)]">{overall}%</b> {lang === 'fr' ? 'global' : 'overall'} · {counts.done} {lang === 'fr' ? 'faits' : 'done'} · {counts.prog} {lang === 'fr' ? 'en cours' : 'active'} · {counts.plan} {lang === 'fr' ? 'prévus' : 'planned'}</span>
      </div>
      {(data?.art != null || data?.code != null || data?.lastUpdate) && (
        <Card className="p-4 mb-5">
          <div className="flex flex-col sm:flex-row gap-4">
            {data?.code != null && <Meter label="Code" pct={data.code} />}
            {data?.art != null && <Meter label={lang === 'fr' ? 'Art / Visuel' : 'Art / Visual'} pct={data.art} />}
          </div>
          {data?.lastUpdate && <div className="text-xs text-[var(--faint)] mt-3 flex items-center gap-1.5"><CalendarDays size={12} /> {lang === 'fr' ? 'Dernière mise à jour' : 'Last update'} · {pickLang(data.lastUpdate, lang)}</div>}
        </Card>
      )}
      <div className="space-y-4">
        {cats.map((c, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center justify-between mb-1.5">
              <div className="font-medium">{pickLang(c.name, lang)}</div>
              <span className="text-xs text-[var(--muted)] tabular-nums">{avg(c.items || [])}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden mb-1"><div className="h-full bg-gradient-to-r from-brand to-brand-2" style={{ width: `${avg(c.items || [])}%` }} /></div>
            <div className="divide-y divide-[var(--line)]">
              {(c.items || []).map((it, k) => <ProgressItem key={k} it={it} lang={lang} />)}
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
