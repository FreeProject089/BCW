import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle, ChevronDown, Search, Settings2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from './auth.jsx';
import Markdown from '../ui/md.jsx';
import { PageHeader, Card, Input, Spinner, EmptyState } from '../ui/ui.jsx';

// Public FAQ — questions grouped by category, each an accordion whose answer is rendered
// with the BetterCommunity doc-block markdown. Editing lives in Admin → FAQ (link shown to
// editors). The whole thing is filterable.
export default function Faq() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(() => new Set());
  useEffect(() => { api.get('/faq').then(setData).catch(() => setData(null)).finally(() => setLoading(false)); }, []);
  const canEdit = data?.canEdit || (user && ['ADMIN', 'SUPERADMIN'].includes(user.role));
  const answerOf = (it) => (lang === 'fr' && it.answerFr && it.answerFr.trim()) ? it.answerFr : it.answer;

  // Filter by question/answer text, then group by category (preserving admin order).
  const groups = useMemo(() => {
    const items = (data?.items || []).filter((it) => {
      if (!q.trim()) return true;
      const n = q.trim().toLowerCase();
      return it.question.toLowerCase().includes(n) || (answerOf(it) || '').toLowerCase().includes(n) || it.category.toLowerCase().includes(n);
    });
    const map = new Map();
    for (const it of items) { if (!map.has(it.category)) map.set(it.category, []); map.get(it.category).push(it); }
    return [...map.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, q, lang]);

  const toggle = (id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader icon={HelpCircle} title={t('faq.title', 'FAQ')} subtitle={t('faq.sub', 'Answers to the most common questions.')}
        actions={canEdit && <Link to="/admin?s=faq" className="btn btn-sm"><Settings2 size={15} /> {t('faq.manage', 'Manage')}</Link>} />

      <div className="relative mb-6"><Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
        <Input className="!pl-10" placeholder={t('faq.searchph', 'Search the FAQ…')} value={q} onChange={(e) => setQ(e.target.value)} /></div>

      {loading ? <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> {t('common.loading', 'Loading…')}</div>
        : groups.length ? <div className="space-y-7">
          {groups.map(([cat, items]) => (
            <section key={cat}>
              <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--faint)] mb-2 px-1">{cat}</h2>
              <div className="space-y-2">
                {items.map((it) => { const isOpen = open.has(it.id); return (
                  <Card key={it.id} className="overflow-hidden">
                    <button onClick={() => toggle(it.id)} className="w-full flex items-center gap-3 text-left p-4 hover:bg-[var(--surface-2)]/40 transition">
                      <span className="flex-1 font-medium">{it.question}{!it.published && <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-400">{t('faq.draft', 'draft')}</span>}</span>
                      <ChevronDown size={17} className={`text-[var(--faint)] shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && <div className="px-4 pb-4 pt-1 border-t border-[var(--line)] text-sm"><Markdown>{answerOf(it) || t('faq.empty', '*No answer yet.*')}</Markdown></div>}
                  </Card>
                ); })}
              </div>
            </section>
          ))}
        </div>
        : <EmptyState icon={HelpCircle} title={q ? t('faq.nomatch', 'No matching questions') : t('faq.none', 'No questions yet')} sub={q ? t('faq.nomatch.s', 'Try a different search.') : (canEdit ? t('faq.none.admin', 'Add the first one from Admin → FAQ.') : t('faq.none.s', 'Check back soon.'))} />}
    </div>
  );
}
