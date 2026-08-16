import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileJson, Activity, ArrowLeft, CheckCircle2, AlertTriangle, XCircle, FlaskConical , Link2 as LinkIcon, ShieldCheck, Copy, Network } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Input, Textarea, Badge, Field, Spinner, EmptyState, useToast , Select } from '../ui/ui.jsx';
// useAsync lives in pages.jsx. It was USED before it was imported here and the build still
// passed — esbuild does not resolve free identifiers, so a missing import is a runtime
// ReferenceError, not a build error. A green build says nothing about this.
import { useAsync } from './pages.jsx';
import { useAuth } from './auth.jsx';
import { ApiConsole } from './dev.jsx';
import CodeMap from '../ui/code-map.jsx';

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

/**
 * Build a bmm:// deeplink without hand-encoding a URL.
 *
 * Every integration that sends someone into BMM does it with one of these, and getting it
 * wrong is silent: a deeplink with an unencoded `&` in its url parameter loses everything
 * after it, opens BMM, and adds half a source. Nothing reports that — the app did what the
 * link said.
 *
 * Entirely client-side. It builds a string; there is nothing to send anywhere.
 */
function DeeplinkBuilder() {
  const { t } = useI18n(); const toast = useToast();
  const [action, setAction] = useState('');
  const [values, setValues] = useState({});

  // The action list is FETCHED, never typed here.
  //
  // It used to be four entries hand-copied from another repository; BMM handles 43, and the
  // parameters are not guessable — repo/sync takes seven of them. A hand-kept copy is wrong
  // the first time somebody adds a deeplink in BMM, silently, and a builder that offers an
  // action the app does not handle produces a link that opens BMM and does nothing. That
  // looks like a broken app rather than a stale list.
  //
  // BMM derives frontend/deeplinks.json from its own handler (npm run map:deeplinks, checked
  // in its CI) and publishes it as a platform asset, the same way links.json is published.
  // If it has not been uploaded, this says so instead of falling back to a shorter list that
  // would look authoritative and be wrong.
  const { data, loading, error } = useAsync(() => api.get('/assets/deeplinks.json'), []);
  const ACTIONS = Array.isArray(data) ? data : [];
  const spec = ACTIONS.find((a) => a.action === action) || ACTIONS[0];
  const params = spec?.params || [];

  const query = params
    .filter((p) => (values[p] ?? '').trim())
    .map((p) => `${p}=${encodeURIComponent(values[p].trim())}`)
    .join('&');
  const link = spec ? `bmm://${spec.action}${query ? `?${query}` : ''}` : '';

  if (loading) return <Card className="p-5"><Spinner /></Card>;
  if (error || !ACTIONS.length) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-1 font-medium">
          <LinkIcon size={16} className="text-[var(--primary-2)]" /> {t('dvt.dl.title', 'Build a bmm:// link')}
        </div>
        <p className="text-[12px] text-[var(--muted)]">
          {t('dvt.dl.noassets', 'The action list has not been published yet. In BMM run `npm run map:deeplinks --json`, then upload frontend/deeplinks.json as the platform asset `deeplinks.json`. This builder reads it rather than keeping its own copy, which would go stale the next time a deeplink is added.')}
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-1 font-medium">
        <LinkIcon size={16} className="text-[var(--primary-2)]" /> {t('dvt.dl.title', 'Build a bmm:// link')}
      </div>
      <p className="text-[12px] text-[var(--muted)] mb-3">
        {t('dvt.dl.sub', 'An unencoded & in the address loses everything after it — BMM opens and adds half a source, and nothing reports it. This encodes for you.')}
      </p>
      <Select value={spec.action} onChange={(e) => { setAction(e.target.value); setValues({}); }} className="mb-2">
        {ACTIONS.map((a) => (
          <option key={a.action} value={a.action}>
            {a.action}{a.params.length ? ` — ${a.params.join(', ')}` : ''}
          </option>
        ))}
      </Select>
      {/* One field per parameter the action actually reads. Every field is optional: several
          actions take none, and some take seven of which most are optional in BMM too — a
          builder that demanded all of them would refuse to write links that work. */}
      {params.length === 0 ? (
        <p className="text-[12px] text-[var(--faint)]">{t('dvt.dl.noparams', 'This action takes no parameters.')}</p>
      ) : params.map((p) => (
        <Input key={p} className="mb-2" value={values[p] || ''}
          onChange={(e) => setValues((v) => ({ ...v, [p]: e.target.value }))}
          placeholder={p === 'url' ? `${p} — https://example.com/catalog.json` : p} />
      ))}
      <div className="mt-3 p-2 rounded-lg text-[11px] break-all" style={{ background: 'var(--bg-solid)', border: '1px solid var(--line)' }}>
        {link}
      </div>
      <div className="flex gap-2 mt-2">
        <Button size="sm" variant="ghost" disabled={!link}
          onClick={() => { navigator.clipboard?.writeText(link); toast.success(t('dvt.dl.copied', 'Link copied.')); }}>
          <Copy size={13} /> {t('dvt.dl.copy', 'Copy')}
        </Button>
      </div>
    </Card>
  );
}

/**
 * Check a webhook signature, without the secret leaving the browser.
 *
 * "Why is my endpoint rejecting this" is the most common webhook question and the hardest
 * to answer from logs: the payload has to be byte-identical, and a body that was parsed and
 * re-serialised no longer is. Computing the expected value beside the received one turns a
 * guess into a comparison.
 *
 * Web Crypto in the page. The secret is never sent to us — which matters, because a tool
 * that asked you to paste a signing secret into a server would be teaching a bad habit
 * regardless of what that server promised to do with it.
 */
function SignatureChecker() {
  const { t } = useI18n();
  const [secret, setSecret] = useState('');
  const [payload, setPayload] = useState('');
  const [ts, setTs] = useState('');
  const [received, setReceived] = useState('');
  const [computed, setComputed] = useState(null);

  const compute = async () => {
    try {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      // `${timestamp}.${body}` — the exact string signWebhook builds. The timestamp is
      // INSIDE the signed value on purpose: signing the body alone would let anyone who
      // saw one delivery replay it for ever. Computing it the other way would have made
      // this tool disagree with the server every single time and blame the developer.
      const signed = `${ts}.${payload}`;
      const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signed));
      setComputed([...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join(''));
    } catch { setComputed(null); }
  };

  // Compared case-insensitively and with any `sha256=` prefix stripped, because both forms
  // are in the wild and a mismatch on formatting reads as a mismatch on the signature.
  const norm = (x) => String(x || '').trim().toLowerCase().replace(/^sha256=/, '');
  const verdict = computed && received ? (norm(computed) === norm(received)) : null;

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-1 font-medium">
        <ShieldCheck size={16} className="text-[var(--primary-2)]" /> {t('dvt.sig.title', 'Check a webhook signature')}
      </div>
      <p className="text-[12px] text-[var(--muted)] mb-3">
        {t('dvt.sig.sub', 'HMAC-SHA256 over `timestamp.body`, computed in your browser — the secret is never sent to us. Paste the RAW body: one that was parsed and re-serialised will not match.')}
      </p>
      <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={t('dvt.sig.secret', 'signing secret')} className="mb-2" />
      <Input value={ts} onChange={(e) => setTs(e.target.value)} placeholder={t('dvt.sig.ts', 'timestamp from the X-BCW-Timestamp header')} className="mb-2" />
      <Textarea rows={4} value={payload} onChange={(e) => setPayload(e.target.value)} placeholder={t('dvt.sig.body', 'raw request body')} />
      <Input value={received} onChange={(e) => setReceived(e.target.value)} placeholder={t('dvt.sig.received', 'signature you received (optional)')} className="mt-2" />
      <div className="flex gap-2 mt-2 items-center flex-wrap">
        <Button size="sm" variant="primary" disabled={!secret || !payload || !ts} onClick={compute}>{t('dvt.sig.go', 'Compute')}</Button>
        {verdict === true && <Badge tone="green">{t('dvt.sig.match', 'matches')}</Badge>}
        {verdict === false && <Badge tone="red">{t('dvt.sig.nomatch', 'does not match')}</Badge>}
      </div>
      {computed && (
        <div className="mt-2 p-2 rounded-lg text-[11px] break-all" style={{ background: 'var(--bg-solid)', border: '1px solid var(--line)' }}>
          {computed}
        </div>
      )}
    </Card>
  );
}


/**
 * Does this installer.toml say what you think it says?
 *
 * The failure it exists for is silent: nothing in the installer engine uses
 * `deny_unknown_fields`, so a mistyped key is DISCARDED. Write `[[componentss]]` and the
 * installer builds perfectly with no components — no error, no warning, and the mistake
 * surfaces as a missing feature in something already shipped.
 *
 * The schema is the artifact the engine derives from its own Rust types, never a copy kept
 * here. A copy would be wrong the first time somebody added a field, and wrong quietly.
 */
// Read a repository and draw what imports what.
//
// Every line in the picture is a real import statement — see lib/code-graph.mjs. It fetches a
// few hundred files, so it is behind a button rather than run on arrival.
function CodeMapTool() {
  const { t } = useI18n(); const toast = useToast();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [graph, setGraph] = useState(null);
  // The maps a webhook has already built. Reading a repository from GitHub takes a minute and
  // these are current as of the last push, so they are offered first.
  const [saved, setSaved] = useState([]);
  const [pick, setPick] = useState('');
  useEffect(() => { api.get('/admin/projects/code-graphs').then((r) => setSaved(r.items || [])).catch(() => {}); }, []);

  const open = async (key) => {
    setPick(key);
    if (!key) return;
    setBusy(true); setGraph(null);
    try { setGraph(await api.get(`/admin/projects/${key}/code-graph/snapshot`)); }
    catch { toast.error(t('dvt.cm.nosnap', 'That map could not be opened.')); }
    finally { setBusy(false); }
  };

  const run = async () => {
    setBusy(true); setGraph(null); setPick('');
    try {
      const r = await api.post('/admin/projects/code-graph', { url: url.trim(), maxFiles: 150 });
      if (!r.nodes?.length) {
        toast.error(t('dvt.cm.none', 'No JavaScript or TypeScript found in that repository.'));
        return;
      }
      setGraph(r);
    } catch (x) {
      toast.error(
        x?.data?.error === 'not_a_github_repo' ? t('dvt.cm.notrepo', 'That is not a GitHub repository URL.')
          : x?.data?.error === 'incomplete_fetch' ? t('dvt.cm.partial', 'Only part of the repository could be read, so the result would be misleading. Try again in a minute.')
            : x?.data?.error === 'github_unreachable' ? t('dvt.cm.unreachable', 'Could not read that repository — check it is public.')
              : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  return (
    <div>
      <p className="text-[12px] text-[var(--muted)] mb-2">
        {t('dvt.cm.desc', 'Draws a repository as folders and files, with a line for every import that really exists in the source. JavaScript and TypeScript only — anything else is named rather than guessed at.')}
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <Input className="flex-1 min-w-[220px]" value={url} onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && url.trim() && run()}
          placeholder="https://github.com/owner/repo" />
        <Button variant="primary" disabled={busy || !url.trim()} onClick={run}>
          {busy ? <Spinner /> : <><Network size={14} /> {t('dvt.cm.go', 'Read it')}</>}
        </Button>
      </div>
      {saved.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-[12px] text-[var(--muted)]">{t('dvt.cm.saved', 'Or open a map a webhook already built:')}</span>
          <Select value={pick} onChange={(e) => open(e.target.value)} className="min-w-[220px]">
            <option value="">{t('dvt.cm.saved.pick', 'Choose a project…')}</option>
            {saved.map((s2) => (
              <option key={s2.key} value={s2.key}>
                {s2.key}{s2.generatedAt ? ` — ${new Date(s2.generatedAt).toLocaleDateString()}` : ''}
                {s2.files != null ? ` (${s2.files})` : ''}
              </option>
            ))}
          </Select>
        </div>
      )}
      {busy && <div className="text-[12px] text-[var(--faint)]">{t('dvt.cm.busy', 'Reading the source — a few hundred files takes a moment.')}</div>}
      {graph?.source === 'snapshot' && (
        <div className="text-[12px] text-[var(--muted)] mb-2">
          {t('dvt.cm.asof', 'Saved map, as of')} {graph.generatedAt ? new Date(graph.generatedAt).toLocaleString() : '—'}
          {graph.url ? ` · ${graph.url}` : ''}
        </div>
      )}
      {graph && <CodeMap graph={graph} t={t} />}
    </div>
  );
}

function RecipeChecker() {
  const { t } = useI18n(); const toast = useToast();
  const [body, setBody] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true); setRes(null);
    try { setRes(await api.post('/dev/validate-recipe', { body })); }
    catch { toast.error(t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };

  return (
    <Card className="p-5">
      <div className="text-sm font-semibold flex items-center gap-2">
        <FileJson size={15} className="text-[var(--primary-2)]" /> {t('dvt.rec', 'Check an installer.toml')}
      </div>
      <p className="text-xs text-[var(--muted)] mt-0.5 mb-3">
        {t('dvt.rec.s', 'The installer discards any key it does not recognise — silently. A mistyped section builds perfectly and does nothing, and you find out from a shipped installer. This compares your recipe against the schema the engine derives from its own types.')}
      </p>

      <Field label={t('dvt.rec.toml', 'Paste the installer.toml')}>
        <Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)}
          className="font-mono text-xs" placeholder={'[app]\nid = "com.example.app"\nname = "Example"'} />
      </Field>
      <Button className="mt-2" variant="primary" disabled={busy || !body.trim()} onClick={run}>
        {busy ? <Spinner /> : t('dvt.rec.check', 'Check it')}
      </Button>

      {res?.error === 'schema_missing' && (
        <div className="mt-4 text-[12px] rounded-lg border border-[var(--warning)] p-3">
          <div className="font-medium mb-1">{t('dvt.rec.noschema', 'No schema has been uploaded yet.')}</div>
          <div className="text-[var(--muted)]">{res.hint}</div>
        </div>
      )}
      {res?.error === 'bad_toml' && (
        <div className="mt-4 text-[12px] rounded-lg border border-[var(--danger)] p-3">
          <div className="font-medium mb-1">{t('dvt.rec.badtoml', 'That is not valid TOML.')}</div>
          <code className="text-[11px] break-words">{res.message}</code>
        </div>
      )}

      {res && !res.error && (
        <div className="mt-4 pt-3 border-t border-[var(--line)] text-[12px]">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            {res.ok
              ? <span className="flex items-center gap-1.5 text-success text-sm font-medium"><CheckCircle2 size={15} /> {t('dvt.rec.ok', 'Every key is one the engine reads.')}</span>
              : <span className="flex items-center gap-1.5 text-error text-sm font-medium"><XCircle size={15} /> {t('dvt.rec.bad', '{n} key(s) the installer will discard').replace('{n}', String(res.dropped.length))}</span>}
            <span className="text-[11px] text-[var(--faint)] ml-auto">
              {t('dvt.rec.against', 'against {n} keys, bpkg {v}').replace('{n}', String(res.schema?.keys ?? 0)).replace('{v}', res.schema?.version || '?')}
            </span>
          </div>

          {res.dropped.map((d) => (
            <div key={d.path} className="flex items-start gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/50 px-2.5 py-1.5 mb-1">
              <XCircle size={13} className="text-error shrink-0 mt-0.5" />
              <div className="min-w-0">
                <code className="font-mono text-[11px]">{d.path}</code>
                {/* Naming the word it meant is the point of reporting a typo. */}
                {d.key && <span className="text-[var(--muted)]"> — {t('dvt.rec.meant', 'did you mean')} <code className="font-mono">{d.key}</code>?</span>}
              </div>
            </div>
          ))}

          {res.dead?.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] uppercase tracking-wider text-[var(--faint)] mb-1">{t('dvt.rec.dead', 'Parses, and nothing reads it')}</div>
              {res.dead.map((k) => <div key={k}><code className="font-mono text-[11px] text-[var(--warning)]">{k}</code></div>)}
            </div>
          )}

          {res.unset?.length > 0 && (
            <details className="mt-3">
              <summary className="text-[11px] text-[var(--muted)] cursor-pointer">
                {t('dvt.rec.unset', '{n} key(s) you have not set').replace('{n}', String(res.unset.length))}
              </summary>
              <div className="mt-1 grid sm:grid-cols-2 gap-x-4">
                {res.unset.map((k) => <code key={k} className="font-mono text-[11px] text-[var(--faint)]">{k}</code>)}
              </div>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}

export default function DevTools() {
  const { t } = useI18n();
  const { user, loading } = useAuth();

  // One list, grouped by purpose. The jump nav and the sections both read it, so a link can
  // never point at a section that moved, and adding a tool — or a whole category like
  // BetterInstaller — is an entry here, not an edit in three places.
  const GROUPS = [
    {
      id: 'general', k: 'dvt.grp.general', label: 'API & keys',
      tools: [
        { id: 'try', label: t('dev.console.title', 'Try a call'), el: <ApiConsole /> },
        { id: 'signature', label: t('dvt.sig.title', 'Check a webhook signature'), el: <SignatureChecker /> },
        { id: 'calls', label: t('dvt.calls', 'What your keys did'), el: <CallLog />, wide: true },
      ],
    },
    {
      id: 'installer', k: 'dvt.grp.installer', label: 'BetterInstaller',
      tools: [
        { id: 'recipe', label: t('dvt.rec', 'Check an installer.toml'), el: <RecipeChecker /> },
      ],
    },
    {
      id: 'code', k: 'dvt.grp.code', label: 'Code',
      tools: [
        { id: 'codemap', label: t('dvt.cm', 'Map a repository'), el: <CodeMapTool />, wide: true },
      ],
    },
    {
      id: 'bmm', k: 'dvt.grp.bmm', label: 'BMM',
      tools: [
        { id: 'validate', label: t('dvt.val', 'Check a catalog feed'), el: <Validator /> },
        { id: 'deeplink', label: t('dvt.dl.title', 'Build a bmm:// link'), el: <DeeplinkBuilder /> },
      ],
    },
  ];
  const ALL_TOOLS = GROUPS.flatMap((g) => g.tools);
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
    <div className="max-w-6xl mx-auto py-8 space-y-4">
      <Link to="/dev" className="text-xs text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1"><ArrowLeft size={13} /> {t('devc.back', 'Developer area')}</Link>
      <div>
        <h1 className="text-2xl font-bold">{t('dvt.title', 'Tools')}</h1>
        {/* Counted, not stated. It said "three things" while seven tools sat underneath —
            the sentence was written when there were three and nothing made it age. */}
        <p className="text-[13px] text-[var(--muted)] mt-1">
          {t('dvt.sub2', '{n} things you would otherwise write yourself — make a real call, check a feed before you publish it, read a repository, see what your keys have been doing.')
            .replace('{n}', String(ALL_TOOLS.length))}
        </p>
      </div>

      {/* Sticky jump bar over every tool of every group — tall tools, so a bar you must
          scroll up to reach is used once. Reads ALL_TOOLS, the same list the sections do. */}
      {/* Grouped in the bar too. Seven unlabelled chips in a row is a list you read twice;
          with the category in front, "the installer one" is found without reading any of the
          others. */}
      <nav className="flex flex-wrap items-center gap-x-3 gap-y-1.5 sticky top-16 z-10 py-2" style={{ background: 'var(--bg)' }}
        aria-label={t('dvt.jump', 'Jump to a tool')}>
        {GROUPS.map((g) => (
          <span key={g.id} className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-[var(--faint)]">{t(g.k, g.label)}</span>
            {g.tools.map((tl) => (
              <a key={tl.id} href={`#${tl.id}`}
                 className="text-xs px-2.5 py-1 rounded-full border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--primary)] transition">
                {tl.label}
              </a>
            ))}
          </span>
        ))}
      </nav>

      {/* Grouped by what a tool is FOR, in one structure that drives both the jump nav and
          the sections below — so a new tool is one entry in one place, and a category (e.g.
          BetterInstaller) is one more group rather than an edit in three spots. Each tool's
          `wide` flag keeps the call log full width, because it is a table. */}
      {GROUPS.map((g) => (
        <div key={g.id}>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mt-4 mb-2">{t(g.k, g.label)}</div>
          {/* Sticky jump bar per group is overkill; one bar covering everything is not, so
              the nav below lists every tool of every group. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            {g.tools.map((tl) => (
              <section key={tl.id} id={tl.id} className={`scroll-mt-24 ${tl.wide ? 'lg:col-span-2' : ''}`}>{tl.el}</section>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
