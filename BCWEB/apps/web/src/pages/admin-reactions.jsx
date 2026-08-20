import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, MessageSquare, ArrowUpRight } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, EmptyState } from '../ui/ui.jsx';
import { useAsync, Loading } from './pages.jsx';

// Admin tab for reader feedback. Gated by `manage_announcements` — the capability that already
// covers the writing this measures.

/**
 * What readers thought of the writing.
 *
 * Blog posts carry emoji reactions; docs pages carry a three-face helpful vote. Two different
 * mechanisms, shown on one screen, because they answer the same question — an admin asking
 * "how is the writing landing" should not have to know that one is a table of rows and the
 * other three integers on the page.
 */
export function AdminReactions() {
  const { t } = useI18n();
  const [days, setDays] = useState(90);
  const { data, loading } = useAsync(() => api.get(`/admin/reactions?days=${days}`), [days]);

  if (loading && !data) return <Loading />;
  const d = data || {};
  const blog = d.blog || [];
  const docs = d.docs || [];
  const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2">
          <Heart size={16} className="text-[var(--primary-2)]" /> {t('adm.react.title', 'Reader feedback')}
        </h2>
        {/* The window applies to blog reactions only. Doc votes are running totals on the page
            itself — there is no per-vote row to filter — and saying so beats letting somebody
            read a lifetime number as "this quarter". */}
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="input !py-1.5 !text-sm !w-auto">
          {[[30, '30d'], [90, '90d'], [365, '1y'], [3650, t('adm.react.all', 'All time')]].map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>

      <Card className="p-4">
        <div className="text-sm font-semibold mb-1">{t('adm.react.blog', 'Blog reactions')}</div>
        <p className="text-[12px] text-[var(--muted)] mb-3">
          {t('adm.react.blogsub', 'One reaction per person per post — a total is people, not clicks.')}
        </p>
        {!blog.length ? (
          <EmptyState icon={Heart} title={t('adm.react.none', 'No reactions in this window.')} />
        ) : (
          <div className="divide-y divide-[var(--line)]">
            {blog.map((b) => (
              <div key={b.id} className="py-2 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  {/* The point of this screen is to decide what to go and fix, and the next
                      action is always "open it". The slug has been in the payload since this
                      endpoint was written; the row simply never used it. */}
                  {b.slug ? (
                    <Link to={`/blog/${b.slug}`} className="text-sm truncate hover:underline flex items-center gap-1 group">
                      <span className="truncate">{b.title}</span>
                      <ArrowUpRight size={12} className="shrink-0 opacity-0 group-hover:opacity-100 transition" />
                    </Link>
                  ) : <div className="text-sm truncate">{b.title}</div>}
                  {b.projectKey && <div className="text-[11px] text-[var(--faint)]">{b.projectKey}</div>}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {Object.entries(b.types).sort((x, y) => y[1] - x[1]).map(([type, n]) => (
                    <span key={type} className="text-[12px] px-1.5 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] tabular-nums">
                      {type} {n}
                    </span>
                  ))}
                </div>
                <div className="text-sm font-semibold tabular-nums w-10 text-right">{b.total}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="text-sm font-semibold mb-1">{t('adm.react.docs', 'Was this helpful? — docs')}</div>
        {/* Sorted by the share who said NO, not by how many voted. The most-voted page is
            usually just the most-visited one; the page a third of readers marked unhelpful is
            the one somebody has to go and rewrite. */}
        <p className="text-[12px] text-[var(--muted)] mb-3">
          {t('adm.react.docssub', 'Worst-rated first, and only pages with at least five votes are ranked as a problem — one unhappy reader is not a signal. Running totals, not affected by the window above.')}
        </p>
        {!docs.length ? (
          <EmptyState icon={MessageSquare} title={t('adm.react.nodocs', 'Nobody has rated a docs page yet.')} />
        ) : (
          <div className="divide-y divide-[var(--line)]">
            {docs.map((x) => (
              <div key={x.slug} className="py-2 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <Link to={`/docs/${x.slug}`} className="text-sm truncate hover:underline flex items-center gap-1 group">
                    <span className="truncate">{x.title}</span>
                    <ArrowUpRight size={12} className="shrink-0 opacity-0 group-hover:opacity-100 transition" />
                  </Link>
                  <div className="text-[11px] text-[var(--faint)]">{x.category} · {x.slug}</div>
                </div>
                <div className="flex items-center gap-2 text-[12px] tabular-nums shrink-0">
                  <span className="text-[var(--success)]">🙂 {x.yes}</span>
                  <span className="text-[var(--muted)]">😐 {x.ok}</span>
                  <span className={x.votes >= 5 && x.negRatio >= 0.33 ? 'text-[var(--error)] font-semibold' : 'text-[var(--muted)]'}>🙁 {x.no}</span>
                </div>
                <div className="w-24 shrink-0">
                  <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden flex">
                    <span className="bg-[var(--success)]" style={{ width: `${pct(x.yes, x.votes)}%` }} />
                    <span className="bg-[var(--muted)]" style={{ width: `${pct(x.ok, x.votes)}%` }} />
                    <span className="bg-[var(--error)]" style={{ width: `${pct(x.no, x.votes)}%` }} />
                  </div>
                  <div className="text-[10px] text-[var(--faint)] text-right mt-0.5 tabular-nums">
                    {t('adm.react.votes', '{n} votes').replace('{n}', String(x.votes))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

