import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileJson, Activity, ArrowLeft, CheckCircle2, AlertTriangle, XCircle, FlaskConical } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Input, Textarea, Badge, Field, Spinner, EmptyState, useToast } from '../ui/ui.jsx';
import { useAuth } from './auth.jsx';
import { ApiConsole } from './dev.jsx';

// /dev/tools — the two things a developer wants that are not "call an endpoint".
//
// The validator exists because the only way to find out whether a feed was well-formed was to
// publish it and watch BMM refuse: a loop with a human, a deploy and somebody else's app in
// it. The call log exists because the owner of a key was the only person who could not see
// what it had been doing — which is backwards, since they are the one who can fix a 403.

function Validator() {
  const { t } = useI18n(); const toast = useToast();
  const [mode, setMode] = useState('url');
  const [url, setUrl] = useState('');
  const [body, setBody] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true); setRes(null);
    try { setRes(await api.post('/dev/validate-feed', mode === 'url' ? { url: url.trim() } : { body })); }
    catch { toast.error(t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };

  const errors = (res?.problems || []).filter((p) => p.level === 'error');
  const warns = (res?.problems || []).filter((p) => p.level === 'warn');

  return (
    <Card className="p-5">
      <div className="text-sm font-semibold flex items-center gap-2"><FileJson size={15} className="text-[var(--primary-2)]" /> {t('dvt.val', 'Check a catalog feed')}</div>
      <p className="text-xs text-[var(--muted)] mt-0.5 mb-3">
        {t('dvt.val.s', 'Everything wrong with it in one pass, before you publish. Stricter than the reader on purpose: the reader has to keep working with feeds published years ago, so a check as forgiving as the reader would tell you nothing.')}
      </p>

      <div className="inline-flex rounded-[10px] bg-[var(--surface-2)] p-0.5 mb-2">
        {[['url', t('dvt.byurl', 'By URL')], ['paste', t('dvt.paste', 'Paste it')]].map(([k, l]) => (
          <button key={k} onClick={() => { setMode(k); setRes(null); }}
            className={`px-2.5 py-1 rounded-[8px] text-[12px] ${mode === k ? 'bg-[var(--bg-solid)] font-medium' : 'text-[var(--muted)]'}`}>{l}</button>
        ))}
      </div>

      {mode === 'url'
        ? <Field label={t('dvt.url', 'Feed URL')}><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/catalog.json" /></Field>
        : <Field label={t('dvt.json', 'The JSON')}><Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} placeholder='{ "apps": [ … ] }' /></Field>}

      <Button className="mt-2" variant="primary" disabled={busy} onClick={run}>{busy ? <Spinner /> : t('dvt.check', 'Check it')}</Button>

      {res && (
        <div className="mt-4 pt-3 border-t border-[var(--line)]">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            {res.ok
              ? <span className="flex items-center gap-1.5 text-success text-sm font-medium"><CheckCircle2 size={15} /> {t('dvt.ok', 'Nothing wrong with it.')}</span>
              : <span className="flex items-center gap-1.5 text-error text-sm font-medium"><XCircle size={15} /> {t('dvt.bad', '{n} problem(s) to fix').replace('{n}', String(errors.length))}</span>}
            {warns.length > 0 && <Badge tone="amber">{t('dvt.warns', '{n} worth looking at').replace('{n}', String(warns.length))}</Badge>}
            {res.fetched && <span className="text-[11px] text-[var(--faint)]">HTTP {res.fetched.status} · {res.fetched.bytes} B</span>}
            {res.counts && Object.entries(res.counts).map(([k, n]) => (
              <span key={k} className="text-[11px] text-[var(--muted)]">{n} {k}{n === 1 ? '' : 's'}</span>
            ))}
          </div>
          <div className="space-y-1">
            {(res.problems || []).map((pb, i) => (
              <div key={i} className="flex items-start gap-2 text-[12px] rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/50 px-2.5 py-1.5">
                {pb.level === 'error'
                  ? <XCircle size={13} className="text-error shrink-0 mt-0.5" />
                  : <AlertTriangle size={13} className="text-warning shrink-0 mt-0.5" />}
                <div className="min-w-0">
                  {pb.path && <code className="font-mono text-[11px] text-[var(--muted)]">{pb.path}</code>}
                  <div className="break-words">{pb.message}</div>
                  {/* The hint is the half that stops this being a linter nobody argues with:
                      it says WHY the rule exists, so a developer can tell a real problem from
                      a preference. */}
                  {pb.hint && <div className="text-[11px] text-[var(--faint)]">{pb.hint}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function CallLog() {
  const { t } = useI18n();
  const [hours, setHours] = useState(24);
  const [d, setD] = useState(null);
  useEffect(() => { setD(null); api.get(`/me/api-calls?hours=${hours}`).then(setD).catch(() => setD({ calls: [], totals: {} })); }, [hours]);

  const tone = (s) => (s >= 500 ? 'red' : s >= 400 ? 'amber' : 'green');

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-sm font-semibold flex items-center gap-2"><Activity size={15} className="text-[var(--primary-2)]" /> {t('dvt.calls', 'What your keys did')}</div>
        <div className="inline-flex rounded-[10px] bg-[var(--surface-2)] p-0.5 ml-auto">
          {[[24, '24h'], [24 * 7, '7d'], [24 * 30, '30d']].map(([h, l]) => (
            <button key={h} onClick={() => setHours(h)}
              className={`px-2.5 py-1 rounded-[8px] text-[12px] ${hours === h ? 'bg-[var(--bg-solid)] font-medium' : 'text-[var(--muted)]'}`}>{l}</button>
          ))}
        </div>
      </div>

      {!d ? <div className="py-6"><Spinner /></div> : (<>
        <div className="grid grid-cols-3 gap-3 my-3 pb-3 border-b border-[var(--line)]">
          {[[t('dvt.t.calls', 'Calls'), d.totals?.count ?? 0], [t('dvt.t.refused', 'Refused or failed'), d.totals?.errors ?? 0], [t('dvt.t.sandbox', 'Sandbox'), d.totals?.sandbox ?? 0]].map(([l, v]) => (
            <div key={l}>
              <div className="text-[11px] text-[var(--faint)]">{l}</div>
              <div className="text-lg font-bold tabular-nums">{Number(v).toLocaleString()}</div>
            </div>
          ))}
        </div>
        {/* Two datasets, and never blurred: the numbers above are exact counts, the list is a
            sample. A number that is quietly a sample is worse than no number, because it gets
            quoted. */}
        <p className="text-[11px] text-[var(--muted)] mb-2">
          {t('dvt.calls.s', 'The totals are exact and cover 30 days. The list below is a sample of individual calls, kept for a few days — refusals are always kept.')}
          {d.sampleRate < 1 ? ' ' + t('dvt.rate', 'Sample rate {r}.').replace('{r}', String(d.sampleRate)) : ''}
        </p>

        {!d.calls?.length ? (
          <EmptyState icon={Activity} title={t('dvt.nocalls', 'Nothing yet')} sub={t('dvt.nocalls.s', 'Calls made with one of your API keys show up here — including the ones we refused, which are the useful half.')} />
        ) : (
          <div className="space-y-0.5 max-h-96 overflow-auto">
            {d.calls.map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-[12px] py-1">
                <Badge tone={tone(c.status)}>{c.status}</Badge>
                <code className="font-mono min-w-0 flex-1 truncate">{c.method} {c.path}</code>
                {c.sandbox && <FlaskConical size={12} className="text-[var(--faint)]" title={t('dvt.sandboxcall', 'Sandbox — nothing was written')} />}
                {c.key && <span className="text-[10px] text-[var(--faint)] truncate max-w-[120px]">{c.key.label || c.key.prefix}{c.key.testMode ? ' · test' : ''}</span>}
                <span className="text-[var(--faint)] tabular-nums">{c.ms}ms</span>
                <span className="text-[var(--faint)]">{new Date(c.at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </>)}
    </Card>
  );
}

export default function DevTools() {
  const { t } = useI18n();
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) {
    return (
      <div className="max-w-lg mx-auto py-12">
        <Card className="p-7 text-center">
          <p className="text-sm text-[var(--muted)] mb-4">{t('dvt.signin', 'These read your own keys and calls — sign in first.')}</p>
          <Link to="/auth?next=/dev/tools"><Button variant="primary">{t('nav.signin', 'Sign in')}</Button></Link>
        </Card>
      </div>
    );
  }
  return (
    <div className="max-w-3xl mx-auto py-8 space-y-4">
      <Link to="/dev" className="text-xs text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1"><ArrowLeft size={13} /> {t('devc.back', 'Developer area')}</Link>
      <div>
        <h1 className="text-2xl font-bold">{t('dvt.title', 'Tools')}</h1>
        <p className="text-[13px] text-[var(--muted)] mt-1">
          {t('dvt.sub', 'Three things you would otherwise write yourself: make a real call, check a feed before publishing it, and see what your keys have been doing.')}
        </p>
      </div>

      {/* Jump links. The page is three tall tools stacked, and it was one h1 with no
          structure under it — nothing to anchor to, nothing to scan, and no way to get
          back to a tool you had scrolled past. Real anchors also mean a link to a
          specific tool can be shared, which is what people do with a page like this. */}
      <nav className="flex flex-wrap gap-1.5" aria-label={t('dvt.jump', 'Jump to a tool')}>
        {[
          // The same keys the cards themselves use, so a link can never say one thing and
          // the section it lands on another.
          ['try', t('dev.console.title', 'Try a call')],
          ['validate', t('dvt.val', 'Check a catalog feed')],
          ['calls', t('dvt.calls', 'What your keys did')],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`}
             className="text-xs px-2.5 py-1 rounded-full border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--primary)] transition">
            {label}
          </a>
        ))}
      </nav>

      {/* Wrapped here rather than given ids inside the components: ApiConsole is shared
          with /dev, and an id baked into it would appear twice on any page rendering both.
          scroll-mt keeps a jumped-to section clear of the sticky header instead of landing
          under it. */}
      <section id="try" className="scroll-mt-20"><ApiConsole /></section>
      <section id="validate" className="scroll-mt-20"><Validator /></section>
      <section id="calls" className="scroll-mt-20"><CallLog /></section>
    </div>
  );
}
