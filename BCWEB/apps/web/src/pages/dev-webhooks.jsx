import { useState, useEffect } from 'react';
import { Webhook, Plus, Trash2, Send, RefreshCw, RotateCw, Copy, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Input, Badge, Field, Spinner, EmptyState, useToast, useDialog, copyText } from '../ui/ui.jsx';

// Webhooks, from the developer's side.
//
// The thing this screen has to get across, and the reason for most of the copy on it: a
// webhook is a promise we make to a server the developer runs. So it shows what we sent,
// what came back, and whether we are going to try again — because "did it fire?" is the
// question every webhook integration is built by answering, over and over.

const STATUS = { ok: { tone: 'green', icon: CheckCircle2 }, failed: { tone: 'red', icon: XCircle }, pending: { tone: 'amber', icon: Clock } };

function Deliveries({ id }) {
  const { t } = useI18n(); const toast = useToast();
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const load = () => api.get(`/me/webhooks/${id}/deliveries`).then((r) => setRows(r.deliveries || [])).catch(() => setRows([]));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const replay = async (d) => {
    try {
      const r = await api.post(`/me/webhooks/${id}/deliveries/${d.id}/replay`, {});
      toast[r.delivery.status === 'ok' ? 'success' : 'error'](
        r.delivery.status === 'ok' ? t('wh.replayed', 'Delivered.') : t('wh.replayfail', 'Still failing: {e}').replace('{e}', r.delivery.error || `HTTP ${r.delivery.httpStatus}`),
      );
      load();
    } catch { toast.error(t('common.failed', 'Failed.')); }
  };

  if (!rows) return <div className="p-3"><Spinner /></div>;
  if (!rows.length) return <p className="text-[12px] text-[var(--muted)] p-3">{t('wh.nodel', 'Nothing sent yet.')}</p>;

  return (
    <div className="divide-y divide-[var(--line)]">
      {rows.map((d) => {
        const st = STATUS[d.status] || STATUS.pending;
        const Ico = st.icon;
        return (
          <div key={d.id} className="px-3 py-2">
            <div className="flex items-center gap-2 text-[12px]">
              <Ico size={13} className={d.status === 'ok' ? 'text-success' : d.status === 'failed' ? 'text-error' : 'text-warning'} />
              <code className="font-mono">{d.event}</code>
              {d.httpStatus ? <Badge tone={st.tone}>{d.httpStatus}</Badge> : null}
              {d.attempts > 1 && <span className="text-[var(--faint)]">{t('wh.attempts', '{n} attempts').replace('{n}', String(d.attempts))}</span>}
              <span className="text-[var(--faint)] ml-auto">{new Date(d.createdAt).toLocaleString()}</span>
              <button onClick={() => setOpen(open === d.id ? null : d.id)} className="text-[var(--primary-2)] hover:underline">{t('wh.payload', 'payload')}</button>
              <button onClick={() => replay(d)} className="text-[var(--primary-2)] hover:underline">{t('wh.replay', 'replay')}</button>
            </div>
            {d.error && <div className="text-[11px] text-error mt-0.5 break-all">{d.error}</div>}
            {/* The retry is stated, not implied: a developer staring at a failed delivery
                needs to know whether to fix and wait, or fix and replay. */}
            {d.nextAt && d.status === 'pending' && (
              <div className="text-[11px] text-[var(--muted)] mt-0.5">{t('wh.next', 'Next attempt {d}').replace('{d}', new Date(d.nextAt).toLocaleString())}</div>
            )}
            {open === d.id && (
              <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-[var(--surface-2)] rounded-lg p-2 mt-1 max-h-52 overflow-auto">{JSON.stringify(d.payload, null, 2)}</pre>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function WebhooksPanel() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ url: '', label: '', events: [] });
  const [secret, setSecret] = useState(null);
  const [openId, setOpenId] = useState(null);

  const load = () => api.get('/me/webhooks').then(setData).catch(() => setData({ webhooks: [], events: {} }));
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    if (!f.events.length) return toast.error(t('wh.needevent', 'Pick at least one event — a subscription to nothing is silence.'));
    try {
      const r = await api.post('/me/webhooks', { url: f.url.trim(), label: f.label.trim() || undefined, events: f.events });
      setSecret({ id: r.webhook.id, secret: r.secret });
      setF({ url: '', label: '', events: [] }); setAdding(false); load();
    } catch (x) {
      toast.error(x?.data?.error === 'https_required' ? t('wh.https', 'The URL must be https (localhost aside, for development).')
        : x?.data?.error === 'too_many' ? t('wh.toomany', 'Ten endpoints is the limit.')
          : t('common.failed', 'Failed.'));
    }
  };

  const toggle = async (w) => {
    try { await api.patch(`/me/webhooks/${w.id}`, { enabled: !w.enabled }); load(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };

  const remove = async (w) => {
    if (!await dialog.confirm({
      title: t('wh.del.t', 'Delete this endpoint?'),
      message: t('wh.del.m', 'We stop calling {u}. Its delivery history goes with it.').replace('{u}', w.url),
      okLabel: t('common.delete', 'Delete'), danger: true,
    })) return;
    try { await api.del(`/me/webhooks/${w.id}`); toast.success(t('common.deleted', 'Deleted.')); load(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };

  const rotate = async (w) => {
    if (!await dialog.confirm({
      title: t('wh.rot.t', 'New signing secret?'),
      message: t('wh.rot.m', 'The old one stops verifying the moment this returns — deliveries keep arriving, but your receiver will reject them until you deploy the new secret.'),
      okLabel: t('wh.rot.ok', 'Rotate'), danger: true,
    })) return;
    try { const r = await api.post(`/me/webhooks/${w.id}/rotate`, {}); setSecret({ id: w.id, secret: r.secret }); load(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };

  const test = async (w) => {
    try {
      const r = await api.post(`/me/webhooks/${w.id}/test`, {});
      toast[r.delivery.status === 'ok' ? 'success' : 'error'](
        r.delivery.status === 'ok' ? t('wh.testok', 'Your server answered {n}.').replace('{n}', String(r.delivery.httpStatus))
          : t('wh.testfail', 'No good: {e}').replace('{e}', r.delivery.error || `HTTP ${r.delivery.httpStatus}`),
      );
      load();
    } catch { toast.error(t('common.failed', 'Failed.')); }
  };

  if (!data) return <Card className="p-5"><Spinner /></Card>;
  const events = Object.entries(data.events || {});

  return (
    <Card className="p-5">
      <div className="flex items-start gap-2 mb-1">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold flex items-center gap-2"><Webhook size={15} className="text-[var(--primary-2)]" /> {t('wh.title', 'Webhooks')}</div>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            {t('wh.sub', 'We call your server when something happens, so you stop asking. Every delivery is signed — check the signature before you act on one.')}
          </p>
        </div>
        {!adding && <Button size="sm" onClick={() => setAdding(true)}><Plus size={13} /> {t('wh.add', 'Add')}</Button>}
      </div>

      {/* The secret, once. Same rule as an API key: we keep it to sign with, never to show
          again. */}
      {secret && (
        <div className="rounded-lg border border-success/40 bg-success/10 p-3 my-3">
          <div className="text-[12px] font-semibold mb-1">{t('wh.secret', 'Your signing secret — copy it now, it is not shown again')}</div>
          <div className="flex items-center gap-2">
            <code className="font-mono text-[12px] break-all flex-1">{secret.secret}</code>
            <Button size="sm" variant="ghost" onClick={() => { copyText(secret.secret); toast.success(t('common.copied', 'Copied.')); }}><Copy size={12} /></Button>
            <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>{t('common.close', 'Close')}</Button>
          </div>
          <p className="text-[11px] text-[var(--muted)] mt-1.5">
            {t('wh.verify', 'Verify: HMAC-SHA256 over “{timestamp}.{body}” with this secret, compared against X-BCW-Signature (v1=…). Reject anything whose X-BCW-Timestamp is more than a few minutes old — that is what stops a delivery being replayed at you.')}
          </p>
        </div>
      )}

      {adding && (
        <form onSubmit={create} className="rounded-lg border border-[var(--line)] p-3 my-3 space-y-2">
          <Field label={t('wh.url', 'Where we should POST')}>
            <Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://example.com/bcw-hook" />
          </Field>
          <Field label={t('wh.label', 'What it is (optional)')}>
            <Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder={t('wh.label.ph', 'My sync service')} />
          </Field>
          <Field label={t('wh.events', 'What to send')}>
            <div className="space-y-1 max-h-52 overflow-auto">
              {events.map(([k, desc]) => (
                <label key={k} className="flex items-start gap-2 text-[12px]">
                  <input type="checkbox" className="mt-0.5" checked={f.events.includes(k)}
                    onChange={(e) => setF((v) => ({ ...v, events: e.target.checked ? [...v.events, k] : v.events.filter((x) => x !== k) }))} />
                  <span><code className="font-mono">{k}</code> <span className="text-[var(--muted)]">— {desc}</span></span>
                </label>
              ))}
            </div>
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="primary">{t('wh.create', 'Create')}</Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>{t('common.cancel', 'Cancel')}</Button>
          </div>
        </form>
      )}

      {!data.webhooks.length ? (
        <EmptyState icon={Webhook} title={t('wh.none', 'No endpoints')}
          sub={t('wh.none.s', 'Without one, the only way to know something changed is to keep asking. Add an address and we will tell you instead.')} />
      ) : (
        <div className="space-y-2 mt-2">
          {data.webhooks.map((w) => (
            <div key={w.id} className="rounded-lg border border-[var(--line)] overflow-hidden">
              <div className="p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {!w.enabled && <Badge tone="red">{t('wh.off', 'off')}</Badge>}
                  <span className="font-medium text-[13px]">{w.label || t('wh.untitled', 'Endpoint')}</span>
                  {w.lastStatus ? <Badge tone={w.lastStatus < 300 ? 'green' : 'red'}>{w.lastStatus}</Badge> : null}
                  {w.failures > 0 && <Badge tone="amber">{t('wh.fails', '{n} failing').replace('{n}', String(w.failures))}</Badge>}
                </div>
                <code className="text-[11px] font-mono text-[var(--muted)] break-all">{w.url}</code>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {w.events.map((e) => <span key={e} className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[var(--muted)]">{e}</span>)}
                </div>
                {w.disabledReason && <div className="text-[11px] text-error mt-1">{w.disabledReason}</div>}
                <div className="flex flex-wrap gap-2 mt-2">
                  <Button size="sm" variant="ghost" onClick={() => test(w)}><Send size={12} /> {t('wh.test', 'Send a test')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setOpenId(openId === w.id ? null : w.id)}><RefreshCw size={12} /> {t('wh.hist', 'Deliveries')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle(w)}>{w.enabled ? t('wh.disable', 'Turn off') : t('wh.enable', 'Turn on')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => rotate(w)}><RotateCw size={12} /> {t('wh.rotate', 'New secret')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(w)}><Trash2 size={12} className="text-error" /></Button>
                </div>
              </div>
              {openId === w.id && <div className="border-t border-[var(--line)] bg-[var(--surface-2)]/40"><Deliveries id={w.id} /></div>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
