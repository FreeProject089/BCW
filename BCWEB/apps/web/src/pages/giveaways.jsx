import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Gift, Clock, Users, Ticket, CheckCircle2, LogIn } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { api } from '../lib/api.js';
import { useAuth } from './auth.jsx';
import { Button, Card, Badge, Spinner, PageHeader, EmptyState, useToast } from '../ui/ui.jsx';
import { useAsync, Loading } from './pages.jsx';

// The public giveaways page (login required to enter). Lists the giveaways whose audience
// includes the site; entering is the account, and a win lands in the inventory (dashboard →
// Shop & inventory) to reveal. Discord-only giveaways don't appear here.
// Exported BOTH ways on purpose. App.jsx loads this route with
// `named(() => import('./pages/giveaways.jsx'), 'Giveaways')`, which reads the NAMED export —
// and this file only had a default one, so the lazy component resolved to `{ default:
// undefined }` and React rendered undefined: "Minified React error #306 … args[]=undefined".
// Every visit to /giveaways hit it. The other 21 named() routes all export their component by
// name; this one is now consistent with them.
export function Giveaways() {
  const { t } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const { data, loading, reload } = useAsync(() => (user ? api.get('/me/giveaways') : Promise.resolve({ giveaways: [] })), [user?.id]);
  const [busy, setBusy] = useState('');

  const header = <PageHeader icon={Gift} title={t('gwp.title', 'Giveaways')} subtitle={t('gwp.sub', 'Enter a community giveaway, a win lands in your inventory to claim.')} />;

  if (!user) {
    return (
      <div>
        {header}
        <Card className="p-8 text-center max-w-md mx-auto">
          <Gift size={30} className="mx-auto text-[var(--accent-ink)] mb-3" />
          <div className="font-semibold">{t('gwp.signin.t', 'Sign in to enter')}</div>
          <p className="text-sm text-[var(--muted)] mt-1">{t('gwp.signin.s', 'Giveaways are entered with your BetterCommunity account, so the prize can reach your inventory.')}</p>
          <Link to="/auth"><Button variant="primary" className="mt-4"><LogIn size={15} /> {t('gwp.signin.btn', 'Sign in')}</Button></Link>
        </Card>
      </div>
    );
  }

  const enter = async (g) => {
    setBusy(g.id);
    try {
      const r = await api.post(`/me/giveaways/${g.id}/enter`);
      toast.success(r.already ? t('gwp.already', 'You are already entered, good luck!') : t('gwp.in', 'You are in! Good luck 🍀'));
      reload();
    } catch (x) {
      toast.error(x?.data?.error === 'need_creator' ? t('gwp.needcreator2', 'This one needs a linked BMM creator id on your account.') : x?.data?.error === 'not_active' ? t('gwp.over', 'This giveaway has ended.') : t('common.failed', 'Failed.'));
    } finally { setBusy(''); }
  };

  const list = data?.giveaways || [];
  const prizeLine = (g) => g.prizeKind === 'promo' ? t('gwp.pk.promo', 'Prize: a promo code') : g.prizeKind === 'custom' ? t('gwp.pk.custom', 'Prize: a custom reward') : t('gwp.pk.none', 'Bragging rights');

  return (
    <div>
      {header}
      {loading ? <Loading /> : !list.length ? (
        <EmptyState icon={Gift} title={t('gwp.none', 'No giveaways right now')} sub={t('gwp.none.s', 'Check back soon, or watch the Discord.')} />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {list.map((g) => {
            const ended = new Date(g.endsAt).getTime() < Date.now();
            return (
              <Card key={g.id} className="p-4">
                <div className="flex items-start gap-3">
                  <span className="grid place-items-center w-10 h-10 rounded-xl bg-[var(--surface-2)] shrink-0"><Gift size={18} className="text-[var(--accent-ink)]" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold break-words">{g.prize}</div>
                    <div className="text-[12px] text-[var(--muted)] flex items-center gap-x-3 gap-y-0.5 flex-wrap mt-0.5">
                      <span className="inline-flex items-center gap-1"><Clock size={11} /> {ended ? t('gwp.ending', 'ending…') : t('gwp.ends', 'ends {d}').replace('{d}', new Date(g.endsAt).toLocaleString())}</span>
                      <span className="inline-flex items-center gap-1"><Users size={11} /> {t('gwp.entrants', '{n} entered').replace('{n}', g.entrantCount)}</span>
                      <span>{g.winnersCount} {t('gwp.winners', 'winner(s)')}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[var(--faint)]">{prizeLine(g)}</span>
                  {g.entered ? (
                    <Badge tone="green"><CheckCircle2 size={11} /> {t('gwp.entered', 'Entered')}</Badge>
                  ) : g.requiresCreator && !g.meetsCreator ? (
                    <Link to="/profile" className="text-[11px] text-warning hover:underline">{t('gwp.needcreator', 'Link a creator id to enter')}</Link>
                  ) : (
                    <Button size="sm" variant="primary" disabled={busy === g.id || ended} onClick={() => enter(g)}>{busy === g.id ? <Spinner /> : <><Ticket size={13} /> {t('gwp.enter', 'Enter')}</>}</Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Giveaways;
