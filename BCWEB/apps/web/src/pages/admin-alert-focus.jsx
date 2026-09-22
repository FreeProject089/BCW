// Server → Performance, opened on ONE alert: `/admin?s=serverperf&alert=<id>`.
//
// The bot's alert posts link here with the alert's id (apps/bot alerts-plan). Without this the
// link landed on a screen of forty rows and left the reader to find theirs. GET
// /admin/server/alerts/:id (requireRole ADMIN, server-perf.mjs) answers the alert, its
// duration, the earlier alerts with the same key and, for a service outage, the outage.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, X, History } from 'lucide-react';
import { Card, Badge, Button, Spinner } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';

const fmtDur = (sec) => {
  const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : m ? `${m} min` : `${sec} s`;
};
const TONE = { critical: 'red', warning: 'amber', info: '' };

export function AlertFocus() {
  const { t } = useI18n();
  const [sp, setSp] = useSearchParams();
  const id = sp.get('alert');
  const [state, setState] = useState({ data: null, error: null });
  const ref = useRef(null);
  useEffect(() => {
    if (!id) return undefined;
    let on = true;
    setState({ data: null, error: null });
    api.get(`/admin/server/alerts/${encodeURIComponent(id)}`)
      .then((d) => { if (on) { setState({ data: d, error: null }); ref.current?.scrollIntoView?.({ block: 'start' }); } })
      .catch((x) => on && setState({ data: null, error: x?.status || 'failed' }));
    return () => { on = false; };
  }, [id]);
  if (!id) return null;
  const close = () => setSp((p) => { const n = new URLSearchParams(p); n.delete('alert'); return n; }, { replace: true });
  const a = state.data?.alert;
  return (
    <Card className="p-4 mb-4 border-[var(--primary)]" data-alert-focus>
      <div ref={ref} className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {state.error ? (
            <div className="text-sm text-[var(--muted)]">{state.error === 404 ? t('af.gone', 'This alert no longer exists; the history may have been cleared.') : t('af.failed', 'Could not load this alert.')}</div>
          ) : !a ? <Spinner /> : (
            <>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                {a.ongoing ? <AlertTriangle size={15} className="text-error shrink-0" /> : <CheckCircle2 size={15} className="text-success shrink-0" />}
                <span className="font-semibold break-words min-w-0">{a.message}</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap text-xs text-[var(--muted)]">
                {a.severity && <Badge tone={TONE[a.severity] || ''}>{a.severity}</Badge>}
                <span>{new Date(a.createdAt).toLocaleString()}</span>
                <span>· {a.ongoing ? t('af.ongoing', 'ongoing for {d}').replace('{d}', fmtDur(a.durationSec)) : t('af.lasted', 'lasted {d}').replace('{d}', fmtDur(a.durationSec))}</span>
                {state.data.outage && <span>· {t('af.outage', 'outage: {s}').replace('{s}', state.data.outage.label)}</span>}
              </div>
              {state.data.history?.length > 0 && (
                <div className="mt-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--faint)] mb-1 flex items-center gap-1"><History size={11} /> {t('af.before', 'The same alert before')}</div>
                  <div className="space-y-0.5 max-h-40 overflow-auto">
                    {state.data.history.map((h) => (
                      <div key={h.id} className="text-xs flex gap-2 min-w-0">
                        <span className="text-[var(--faint)] tabular-nums shrink-0">{new Date(h.createdAt).toLocaleString()}</span>
                        <span className="truncate min-w-0 text-[var(--muted)]" title={h.message}>{h.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={close} title={t('common.close', 'Close')}><X size={14} /></Button>
      </div>
    </Card>
  );
}
