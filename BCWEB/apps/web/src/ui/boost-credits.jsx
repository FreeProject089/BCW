// The boosts your plan includes, and what to point one at.
//
// Deliberately one card listing BOTH repos and catalogues, rather than a button on each thing.
// A credit is not attached to anything until it is spent, so the question is "which of my
// things should go in front of more people this month" — and answering that means seeing them
// side by side. A per-item button would ask the same question once per item, with the count
// repeated on each and no way to compare.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Rocket, Boxes, Server, CheckCircle2, Plus } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast, Button, Card, Badge, Spinner } from './ui.jsx';
import { useI18n } from '../i18n.jsx';

export default function BoostCredits() {
  const { t } = useI18n(); const toast = useToast();
  const [data, setData] = useState(undefined);
  const [busy, setBusy] = useState('');

  const load = () => api.get('/me/boosts').then(setData).catch(() => setData(null));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const spend = async (kind, id, name) => {
    setBusy(id);
    try {
      const r = await api.post('/me/boosts/spend', { kind, id });
      toast.success(t('boost.done', '“{n}” is featured until {d}.')
        .replace('{n}', name).replace('{d}', new Date(r.featuredUntil).toLocaleDateString()));
      load();
    } catch (x) {
      toast.error(x.data?.error === 'no_credit'
        ? t('boost.none', 'No boost left to spend.')
        : t('repos.failed', 'Failed.'));
    } finally { setBusy(''); }
  };

  if (data === undefined) return null;          // nothing to say while loading
  // No plan includes any, and none was ever handed out: the card would be an advert for a
  // feature this account does not have, in a dashboard.
  if (!data || (!data.available && !(data.credits || []).length)) return null;

  const targets = [
    ...(data.targets?.repos || []).map((r) => ({ ...r, kind: 'repo' })),
    ...(data.targets?.catalogs || []).map((c) => ({ ...c, kind: 'catalog' })),
  ];

  return (
    <Card className="p-5 mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 font-semibold text-[15px]">
          <Rocket size={16} className="text-warning" /> {t('boost.t', 'Boosts included with your plan')}
        </div>
        <Badge tone={data.available ? 'success' : ''}>
          {t('boost.n', '{n} available').replace('{n}', data.available)}
        </Badge>
      </div>
      <p className="text-[13px] text-[var(--muted)] leading-relaxed mt-2">
        {data.available
          ? t('boost.s', 'One boost puts a repo or a catalogue at the top of its public listing. Spending one on something already featured adds to the time left rather than replacing it.')
          : t('boost.s0', 'You have spent them all for now. The next ones arrive with your plan’s next period.')}
        {data.nextExpiry && data.available
          ? ` ${t('boost.exp', 'Use them before {d}, they do not carry over.').replace('{d}', new Date(data.nextExpiry).toLocaleDateString())}`
          : ''}
      </p>

      {data.available > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {targets.length === 0 && (
            <div className="text-center py-3">
              <div className="text-[13px] font-semibold">{t('boost.notargets', 'Nothing to boost yet')}</div>
              <div className="text-[12.5px] text-[var(--muted)] mt-1">{t('boost.notargets.s', 'A boost is spent on a repository or a catalogue of yours, and you do not have one yet. Your boosts wait until you do.')}</div>
              <div className="mt-3 flex justify-center">
                <Link to="/submit"><Button size="sm" variant="primary"><Plus size={14} /> {t('boost.notargets.a', 'Publish something')}</Button></Link>
              </div>
            </div>
          )}
          {targets.map((x) => (
            <div key={`${x.kind}-${x.id}`} className="flex items-center gap-2.5 rounded-lg border border-[var(--line)] px-3 py-2.5">
              {x.kind === 'repo'
                ? <Server size={14} className="text-[var(--primary-2)] shrink-0" />
                : <Boxes size={14} className="text-[var(--primary-2)] shrink-0" />}
              <span className="flex-1 min-w-0 truncate text-[13.5px]" title={x.name}>{x.name}</span>
              {x.featured && (
                <span className="text-[11px] text-success flex items-center gap-1 shrink-0">
                  <CheckCircle2 size={12} /> {t('boost.until', 'until {d}').replace('{d}', new Date(x.featuredUntil).toLocaleDateString())}
                </span>
              )}
              <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => spend(x.kind, x.id, x.name)}>
                {busy === x.id ? <Spinner /> : (x.featured ? t('boost.extend', 'Extend') : t('boost.apply', 'Boost'))}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
