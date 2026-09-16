// A request you can actually run, on the page that is trying to convince you to write one.
//
// The developer landing said what the API can do and offered four links to places where you
// could go and read about it. That is a brochure. The question a developer arrives with is
// "does this work, and what does it give me", and it is answerable in about 200ms because
// these three endpoints are public: no key, no account, no consent screen.
//
// Deliberately GET-only and deliberately public. A "try it" that needs a key first is a
// sign-up form wearing a console, and one that can write is a button that changes somebody's
// site because they were curious.
import { useState } from 'react';
import { Play, Copy, Check, Loader2 } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { copyText } from '../ui/ui.jsx';

/** The three public reads, in the order somebody would try them. */
const CALLS = [
  { path: '/projects', label: 'projects' },
  { path: '/stats', label: 'stats' },
  { path: '/catalogs.json?scope=official', label: 'catalogs' },
];

const LANGS = [['curl', 'curl'], ['fetch', 'JavaScript'], ['python', 'Python']];

function snippet(lang, path, origin) {
  const url = `${origin}/api${path}`;
  if (lang === 'curl') return `curl '${url}'`;
  if (lang === 'fetch') return `const res = await fetch('${url}');\nconsole.log(await res.json());`;
  return `import requests\nprint(requests.get("${url}").json())`;
}

/** Enough of the answer to recognise it, without pasting a 200 KB catalogue into the page. */
function preview(value) {
  const text = JSON.stringify(value, null, 2);
  const LIMIT = 1400;
  return text.length > LIMIT ? `${text.slice(0, LIMIT)}\n… ${text.length - LIMIT} more characters` : text;
}

export default function DevTryIt() {
  const { t } = useI18n();
  const [call, setCall] = useState(CALLS[0]);
  const [lang, setLang] = useState('curl');
  const [state, setState] = useState(null); // null | 'running' | { ms, status, body } | { error }
  const [copied, setCopied] = useState(false);
  const origin = typeof location !== 'undefined' ? location.origin : 'https://bettercommunity.ch';

  const run = async () => {
    setState('running');
    // Timed here rather than reported from the server: the number that matters to somebody
    // deciding whether to build on this is what THEIR machine waited, not what ours spent.
    const t0 = performance.now();
    try {
      const res = await fetch(`/api${call.path}`, { headers: { Accept: 'application/json' } });
      const body = await res.json();
      setState({ ms: Math.round(performance.now() - t0), status: res.status, body });
    } catch (e) {
      // A failed request is still an answer, and pretending otherwise on a page about an API
      // would be the least convincing thing on it.
      setState({ error: String(e?.message || e) });
    }
  };

  const code = snippet(lang, call.path, origin);

  return (
    <div className="rounded-2xl border border-[var(--line)] overflow-hidden" style={{ background: 'var(--surface)' }}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--line)] flex-wrap">
        <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 text-[var(--accent-ink)]"
          style={{ background: 'color-mix(in srgb, currentColor 14%, transparent)' }}>GET</span>
        <div className="flex gap-1 flex-wrap min-w-0">
          {CALLS.map((c) => (
            <button key={c.path} type="button" onClick={() => { setCall(c); setState(null); }}
              aria-pressed={call.path === c.path}
              className={`font-mono text-[11px] px-2 py-1 rounded-md transition ${
                call.path === c.path ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}>/api{c.path}</button>
          ))}
        </div>
        <div className="ms-auto flex items-center gap-1.5 shrink-0">
          <div className="flex rounded-lg border border-[var(--line)] overflow-hidden">
            {LANGS.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setLang(k)}
                className={`px-2 py-1 text-[11px] ${lang === k ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{label}</button>
            ))}
          </div>
          <button type="button" title={t('common.copy', 'Copy')} aria-label={t('common.copy', 'Copy')}
            onClick={() => { copyText(code); setCopied(true); setTimeout(() => setCopied(false), 1400); }}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)]">
            {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
          </button>
        </div>
      </div>

      <pre className="text-[11.5px] font-mono leading-relaxed p-4 overflow-x-auto m-0">{code}</pre>

      <div className="flex items-center gap-2 px-4 py-2.5 border-t border-[var(--line)] flex-wrap">
        <button type="button" onClick={run} disabled={state === 'running'}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[var(--primary)] text-white disabled:opacity-60">
          {state === 'running' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          {t('dtry.run', 'Run it')}
        </button>
        <span className="text-[11px] text-[var(--muted)]">{t('dtry.note', 'Public endpoint, no key, no account.')}</span>
        {state && state !== 'running' && !state.error && (
          <span className="ms-auto text-[11px] tabular-nums text-[var(--faint)]">
            <span className={state.status < 300 ? 'text-success font-semibold' : 'text-error font-semibold'}>{state.status}</span> · {state.ms} ms
          </span>
        )}
      </div>

      {state && state !== 'running' && (
        <pre className="text-[11px] font-mono leading-relaxed p-4 pt-0 overflow-auto max-h-64 m-0 text-[var(--muted)]">
          {state.error ? `# ${state.error}` : preview(state.body)}
        </pre>
      )}
    </div>
  );
}
