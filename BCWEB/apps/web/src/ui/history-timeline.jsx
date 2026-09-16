// What changed here, and what it was before.
//
// The activity list this sits next to answers "something happened": a row per action, with a
// free-text detail that for the commonest action on the platform read "sandbox settings
// updated". This answers the question that was actually being asked — WHICH setting, and from
// what to what — because the server now records a diff alongside the action.
//
// Rendering rule, and it is the only one that matters here: a row shows exactly what the
// server sent. The from/to values were summarised server-side (a list becomes its length, a
// secret never leaves at all), and re-deriving anything from them in the client would be a
// second opinion about what is safe to display.
import { useEffect, useState } from 'react';
import {
  History, UploadCloud, Trash2, Settings2, KeyRound, Wifi, WifiOff, Globe, FilePlus2,
  ArrowRight, Loader2,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Card, EmptyState, Spinner } from './ui.jsx';
import { useI18n } from '../i18n.jsx';

/** Icon and tone per action. An action with no entry falls back to the neutral one rather
 *  than rendering nothing — a new action type must never make a row invisible. */
const LOOK = {
  'file.add': [FilePlus2, 'text-success'],
  'file.update': [UploadCloud, 'text-[var(--primary-2)]'],
  'file.remove': [Trash2, 'text-error'],
  settings: [Settings2, 'text-[var(--muted)]'],
  access: [KeyRound, 'text-warning'],
  publish: [Wifi, 'text-success'],
  unpublish: [WifiOff, 'text-[var(--faint)]'],
  domain: [Globe, 'text-[var(--primary-2)]'],
  created: [FilePlus2, 'text-success'],
};

function actionLabel(action, t) {
  const M = {
    'file.add': t('hist.a.fileadd', 'File added'),
    'file.update': t('hist.a.fileup', 'File replaced'),
    'file.remove': t('hist.a.filerm', 'File removed'),
    settings: t('hist.a.settings', 'Settings'),
    access: t('hist.a.access', 'Access'),
    publish: t('hist.a.publish', 'Published'),
    unpublish: t('hist.a.unpublish', 'Taken offline'),
    domain: t('hist.a.domain', 'Domain'),
    created: t('hist.a.created', 'Created'),
  };
  return M[action] || action;
}

/** One `{ field, from, to }`. Absent on either side is rendered as a word, not as a blank —
 *  an empty cell reads as a rendering bug rather than as "there was nothing there". */
function Change({ row }) {
  const { t } = useI18n();
  const none = <span className="text-[var(--faint)] italic">{t('hist.none', 'nothing')}</span>;
  return (
    <div className="flex items-center gap-2 text-[12px] flex-wrap">
      <code className="text-[var(--muted)]">{row.field}</code>
      <span className="text-[var(--faint)]">{row.from == null ? none : row.from}</span>
      <ArrowRight size={11} className="text-[var(--faint)] shrink-0" />
      <span className="font-medium">{row.to == null ? none : row.to}</span>
    </div>
  );
}

export default function HistoryTimeline({ url }) {
  const { t } = useI18n();
  const [events, setEvents] = useState(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = (before) => {
    setBusy(true);
    const q = before ? `${url}${url.includes('?') ? '&' : '?'}before=${encodeURIComponent(before)}` : url;
    api.get(q)
      .then((d) => { setEvents((cur) => (before ? [...(cur || []), ...(d.events || [])] : (d.events || []))); setMore(!!d.more); })
      .catch(() => setEvents((cur) => cur || []))
      .finally(() => setBusy(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [url]);

  if (events === null) return <Card className="p-5 flex justify-center"><Spinner /></Card>;
  if (!events.length) {
    // Shared by several dashboards, so there is no one button that fills it — the action is
    // whatever the surrounding page does, and this component cannot know it. Name the thing
    // and say what will land here instead of guessing.
    return <EmptyState icon={History} title={t('hist.empty.t', 'No changes recorded')} sub={t('hist.empty.s', 'Nothing has been changed here yet. Every edit is logged from now on: what changed, when, and by whom.')} />;
  }

  return (
    <div className="flex flex-col gap-2">
      {events.map((e) => {
        const [Icon, tone] = LOOK[e.action] || [History, 'text-[var(--muted)]'];
        const rows = Array.isArray(e.changes) ? e.changes : [];
        return (
          <Card key={e.id} className="p-4">
            <div className="flex items-start gap-3">
              <Icon size={16} className={`shrink-0 mt-0.5 ${tone}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-semibold text-[14px]">{actionLabel(e.action, t)}</span>
                  {e.summary && <span className="text-[13px] text-[var(--muted)] break-all">{e.summary}</span>}
                </div>
                <div className="text-[11.5px] text-[var(--faint)] mt-0.5">
                  {e.actorLabel || t('hist.system', 'system')} · {new Date(e.createdAt).toLocaleString()}
                </div>
                {rows.length > 0 && (
                  <div className="mt-2.5 flex flex-col gap-1.5 border-s-2 border-[var(--line)] ps-3">
                    {rows.map((r, i) => <Change key={`${r.field}-${i}`} row={r} />)}
                  </div>
                )}
              </div>
            </div>
          </Card>
        );
      })}
      {more && (
        <div className="flex justify-center pt-1">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => load(events[events.length - 1]?.createdAt)}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : t('hist.more', 'Load older')}
          </Button>
        </div>
      )}
    </div>
  );
}
