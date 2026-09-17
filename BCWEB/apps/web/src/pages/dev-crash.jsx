// BMM crash bundles, explained — a /dev/tools tool.
//
// BMM writes a zip every time it dies (src-tauri/src/commands/crash.rs) and the only way to
// read one was to download it, unzip it, open eight files and hold them in your head. This
// opens it and says what happened: the version, the machine, the panic, the last thing the
// app logged, the configuration that was in effect, and the things that look wrong.
//
// IT NEVER LEAVES THE MACHINE. Not a preference: a bundle carries somebody's home directory,
// their game library, their logged API calls and now and then a token BMM printed. Uploading
// one to be read would create a second copy of a stranger's crash on our disk, and the line
// on the drop zone has to be literally true. zip-read.js reads the archive's index from its
// tail and inflates one entry at a time with the platform's own DecompressionStream, so there
// is no library to load and no request to make. The parsing and the limits live in
// lib/crash-bundle.js, which is unit-tested against the exact bytes BMM writes.
//
// The tool follows ui/bmm-inspector.jsx rather than competing with it: same drop zone, same
// local reading, same refusal to render an entry as anything but text. The inspector answers
// "what is this file"; this answers "why did it crash", which is a different question over a
// format the inspector has no opinion about.
import { useState } from 'react';
import { Bug, Upload, AlertTriangle, XCircle, Info, ShieldAlert, Cpu, FileText, Settings2, ScrollText } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Badge, Input, Spinner, Explain, useToast } from '../ui/ui.jsx';
import { analyseBundle, LIMITS } from '../lib/crash-bundle.js';

const fmtKB = (n) => `${Math.max(1, Math.round((n || 0) / 1024))} KB`;

/**
 * The stack, with BMM's own frames standing out.
 *
 * A `backtrace::Backtrace` dump is mostly other people's code, and the crash machinery is at
 * the TOP of it: BMM captures the trace inside its panic hook, so the first six frames of
 * every BMM crash are the backtrace crate, std::panicking and crash.rs. Dimmed, not hidden,
 * for the same reason the error dashboard dims vendor frames: a dimmed line is still
 * selectable, still copied, and still there when the answer turns out to be in it.
 */
const NOISE = /backtrace::|std::panicking|core::panicking|rust_begin_unwind|__rust_|commands::crash|panic_hook|\.cargo[\\/]registry|[\\/]rustc[\\/]/;
function Backtrace({ text, t }) {
  const lines = String(text || '').split('\n');
  return (
    <pre className="text-[11px] font-mono panel rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-[60vh]">
      {lines.map((ln, i) => (
        <div key={i} className={NOISE.test(ln)
          ? 'opacity-45 text-[var(--muted)]'
          : /^\s*(?:\d+:|at\s)/.test(ln) ? 'text-[var(--text)] border-s-2 b-primary ps-2 -ms-2' : 'text-[var(--muted)]'}>
          {ln || ' '}
        </div>
      ))}
      {!lines.length && <div className="text-[var(--muted)]">{t('dcr.nostackbody', 'This bundle carries no stacktrace.txt.')}</div>}
    </pre>
  );
}

/** One key/value row. The value is never clipped without a `title`: a truncated path is a
 *  path nobody can act on. */
function Row({ k, v }) {
  const s = v === null || v === undefined || v === '' ? '-' : String(v);
  return (
    <div className="flex items-baseline gap-2 text-[12px] min-w-0">
      <span className="text-[var(--faint)] shrink-0">{k}</span>
      <span className="font-mono truncate min-w-0" title={s}>{s}</span>
    </div>
  );
}

export default function CrashBundleTool() {
  const { t } = useI18n(); const toast = useToast();
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [b, setB] = useState(null);
  const [tab, setTab] = useState('stack');
  const [logQ, setLogQ] = useState('');

  // The words for every finding `bundleFindings` can produce. Written out one literal `t()`
  // per key on purpose: a key built from a template is invisible to i18n-check, which is
  // exactly how seven rows once shipped in English with every gate green.
  const FINDING = {
    nometa: t('dcr.f.nometa', 'No metadata.txt. This is not a BMM crash bundle, or it was repacked by something that dropped it.'),
    zipslip: t('dcr.f.zipslip', 'An entry points outside the archive. Nothing here extracts anything, but an archive shaped like this was not written by BMM.'),
    nostack: t('dcr.f.nostack', 'A crash bundle with no stacktrace.txt. BMM only writes one when it catches the panic itself.'),
    dirty: t('dcr.f.dirty', 'BMM did not catch this one as it happened: it found the leftover session log on the next start. There is no stack, and the reason is a guess made afterwards.'),
    clean: t('dcr.f.clean', 'This is a clean exit, not a crash. It is the bundle BMM writes when you close it normally.'),
    shutdowninCrash: t('dcr.f.shutdownincrash', 'The log contains a clean shutdown, yet this is filed as a crash. The zip and the log disagree.'),
    noshutdownInSession: t('dcr.f.noshutdown', 'Filed as a clean exit, but the log never reached its shutdown line.'),
    logerrors: t('dcr.f.logerrors', 'Error lines in the log before the end.'),
    lowmem: t('dcr.f.lowmem', 'The machine was nearly out of memory.'),
    bigproc: t('dcr.f.bigproc', 'BMM itself was holding a lot of memory.'),
    earlycrash: t('dcr.f.earlycrash', 'It died within seconds of starting, so the cause is in startup rather than in anything the person did.'),
    previouscrash: t('dcr.f.previouscrash', 'The session before this one did not end cleanly either. This is at least the second in a row.'),
    fsmode: t('dcr.f.fsmode', 'File-system protection was not on strict.'),
    tokeninstate: t('dcr.f.tokeninstate', 'The settings snapshot carries a GitHub token. Treat this bundle as a secret and tell the sender to rotate it.'),
    plugins: t('dcr.f.plugins', 'Plugins were installed. A crash in a profile with plugins is not necessarily BMM.'),
    pluginexec: t('dcr.f.pluginexec', 'A plugin was allowed to run programs or scripts.'),
    secret: t('dcr.f.secret', 'Something shaped like a credential is in the logs. Do not paste this into a ticket as is.'),
    extraentries: t('dcr.f.extra', 'Entries BMM does not write.'),
  };
  const TONE = { bad: 'red', warn: 'amber', info: '' };
  const ICON = { bad: XCircle, warn: AlertTriangle, info: Info };

  const load = async (file) => {
    if (!file) return;
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer().catch(() => new ArrayBuffer(0)));
    if (!(head[0] === 0x50 && head[1] === 0x4b)) {
      return toast.error(t('dcr.notzip', 'That is not a zip. A BMM crash bundle is the crash_….zip or session_….zip from the Crashes folder.'));
    }
    setBusy(true); setB(null); setName(file.name); setTab('stack'); setLogQ('');
    try {
      setB(await analyseBundle(file, { name: file.name }));
    } catch (e) {
      toast.error(String(e?.message || '').includes('not a zip')
        ? t('dcr.notzip', 'That is not a zip. A BMM crash bundle is the crash_….zip or session_….zip from the Crashes folder.')
        : `${t('dcr.readfail', 'The archive could not be read')}: ${e?.message || e}`);
    } finally { setBusy(false); }
  };

  const logs = b?.logs || [];
  const q = logQ.trim().toLowerCase();
  const shown = (q ? logs.filter((l) => l.text.toLowerCase().includes(q)) : logs).slice(-LIMITS.logTail);

  const TABS = [
    ['stack', t('dcr.tab.stack', 'Stack'), FileText],
    ['logs', t('dcr.tab.logs', 'Log'), ScrollText],
    ['system', t('dcr.tab.system', 'Machine'), Cpu],
    ['config', t('dcr.tab.config', 'Configuration'), Settings2],
    ['files', t('dcr.tab.files', 'Files'), Upload],
  ];

  return (
    <Card className="p-5">
      <div className="text-sm font-semibold flex items-center gap-2">
        <Bug size={15} className="text-[var(--accent-ink)]" /> {t('dcr.title', 'Read a BMM crash bundle')}
      </div>
      <p className="text-xs text-[var(--muted)] mt-0.5 mb-2">
        {t('dcr.sub', 'Drop the crash_….zip BMM wrote and get the panic, the machine, the last thing it logged and the settings that were in effect, without unzipping anything by hand.')}
      </p>

      <Explain summary={t('dcr.local', 'The bundle is read in your browser. It is never uploaded.')} className="mb-3">
        <p>{t('dcr.x.1', 'A crash bundle is somebody’s machine in a bottle: their home directory in every path, their game library, the API calls BMM logged and, now and then, a token that got printed. Sending one to a server to be read would put a copy of a stranger’s crash on our disk, so this reads it where it already is. The archive’s index sits at its end, so listing it costs two small reads whatever the size, and one entry is decompressed at a time.')}</p>
        <p>{t('dcr.x.2', 'A file dropped here can also be hostile, so it is read against fixed limits: at most {e} entries, at most {mb} MB of declared contents across the archive, at most {em} MB for any single entry, and a refusal when the whole archive claims to expand more than {r} times, which is the shape of a zip bomb. An entry whose name is absolute or climbs out with .. is listed and never read. Nothing is rendered as markup: an entry is text and appears as text.')
          .replace('{e}', String(LIMITS.entries)).replace('{mb}', String(LIMITS.totalBytes / 1024 / 1024))
          .replace('{em}', String(LIMITS.entryBytes / 1024 / 1024)).replace('{r}', String(LIMITS.ratio))}</p>
        <p>{t('dcr.x.3', 'What it cannot tell you: BMM captures its backtrace inside the panic hook, so the top frames are always the hook itself, and a bundle written after the fact (BMM noticing a leftover session log on the next start) has no stack at all. In both cases the panic REASON in metadata.txt is the real evidence and the trace is context.')}</p>
      </Explain>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); load(e.dataTransfer?.files?.[0]); }}
        className={`rounded-lg border border-dashed p-3 mb-3 text-[12px] text-center ${dragOver ? 'border-[var(--primary-2)] text-[var(--accent-ink)]' : 'border-[var(--line)] text-[var(--muted)]'}`}
      >
        {t('dcr.drop', 'Drop a crash bundle here, or')}{' '}
        <label className="underline cursor-pointer">
          {t('dcr.choose', 'choose one')}
          <input type="file" className="hidden" accept=".zip,application/zip"
            onChange={(e) => { load(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {name && <div className="mt-1 text-[var(--faint)] break-all">{name}</div>}
      </div>

      {busy && <div className="text-[12px] text-[var(--muted)] flex items-center gap-2"><Spinner /> {t('dcr.reading', 'Reading the archive…')}</div>}

      {b?.refused && (
        <div className="rounded-lg border border-[var(--error)] p-3 text-[12px]">
          <div className="font-medium text-error flex items-center gap-1.5"><ShieldAlert size={14} /> {t('dcr.refused', 'Refused before anything was decompressed')}</div>
          <p className="text-[var(--muted)] mt-1">
            {b.refused.why === 'entries' && t('dcr.ref.entries', 'It declares {n} entries and the limit is {m}.').replace('{n}', String(b.refused.got)).replace('{m}', String(b.refused.limit))}
            {b.refused.why === 'size' && t('dcr.ref.size', 'It declares {n} MB of contents and the limit is {m} MB.').replace('{n}', String(Math.round(b.refused.got / 1024 / 1024))).replace('{m}', String(Math.round(b.refused.limit / 1024 / 1024)))}
            {b.refused.why === 'ratio' && t('dcr.ref.ratio', 'It claims to expand {n} times its packed size, and the limit is {m}. That is the shape of a decompression bomb, not of a crash bundle.').replace('{n}', String(b.refused.got)).replace('{m}', String(b.refused.limit))}
          </p>
          <p className="text-[var(--faint)] mt-1">{t('dcr.ref.why', 'The sizes are read out of the archive’s own index, so this happens before a single byte is inflated.')}</p>
        </div>
      )}

      {b && !b.refused && <div className="space-y-3">
        {/* What it is, in one row. */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={b.kind === 'crash' ? 'red' : b.kind === 'session' ? 'green' : 'amber'}>
            {b.kind === 'crash' ? t('dcr.k.crash', 'crash') : b.kind === 'session' ? t('dcr.k.session', 'clean exit') : t('dcr.k.unknown', 'unrecognised')}
          </Badge>
          {b.meta.version && <Badge>v{b.meta.version}</Badge>}
          {b.system.flat['OS Name'] && <Badge>{b.system.flat['OS Name']} {b.system.flat['OS Version'] || ''}</Badge>}
          <span className="text-[11px] text-[var(--faint)] ms-auto">{t('dcr.nfiles', '{n} file(s), {kb}').replace('{n}', String(b.total)).replace('{kb}', fmtKB(b.declaredBytes))}</span>
        </div>

        <div className="rounded-lg border border-[var(--line)] p-3 space-y-1">
          <Row k={t('dcr.m.reason', 'Reason')} v={b.meta.reason} />
          <Row k={t('dcr.m.when', 'Written at')} v={b.meta.timestamp} />
          <Row k={t('dcr.m.version', 'BMM version')} v={b.meta.version} />
          <Row k={t('dcr.m.runtime', 'Alive for')} v={b.system.flat['Process Runtime']} />
          {b.frontend?.reason && <Row k={t('dcr.m.frontend', 'Webview said')} v={b.frontend.reason} />}
          {b.hasReplay && <Row k={t('dcr.m.replay', 'Session recording')} v={fmtKB(b.replaySize)} />}
        </div>

        {/* The judgement. Worst first: a reviewer who reads one line should read the worst. */}
        {b.findings.length > 0 && (
          <div className="space-y-1">
            {['bad', 'warn', 'info'].flatMap((lv) => b.findings.filter((x) => x.level === lv)).map((x, i) => {
              const I = ICON[x.level];
              return (
                <div key={i} className={`flex items-start gap-2 text-[12px] rounded-lg border p-2 ${
                  x.level === 'bad' ? 'border-[var(--error)]' : x.level === 'warn' ? 'border-[var(--warning)]' : 'border-[var(--line)]'}`}>
                  <I size={13} className={`shrink-0 mt-0.5 ${x.level === 'bad' ? 'text-error' : x.level === 'warn' ? 'text-warning' : 'text-[var(--faint)]'}`} />
                  <span className="min-w-0">
                    <span>{FINDING[x.key] || x.key}</span>
                    {x.detail && <span className="text-[var(--muted)] font-mono break-all"> {x.detail}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-1 flex-wrap">
          {TABS.map(([k, label, I]) => (
            <button key={k} type="button" onClick={() => setTab(k)} aria-current={tab === k ? 'true' : undefined}
              className={`px-2.5 py-1 rounded-lg text-[12px] border inline-flex items-center gap-1.5 ${
                tab === k ? 'border-[var(--primary)] bg-[var(--surface-2)]' : 'border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-2)]'}`}>
              <I size={12} /> {label}
            </button>
          ))}
        </div>

        {tab === 'stack' && <div>
          {b.stackTooBig && <p className="text-[12px] text-warning mb-1">{t('dcr.stacktoobig', 'stacktrace.txt is larger than a single entry may be, so it was not inflated.')}</p>}
          {!b.hasStack && <p className="text-[12px] text-[var(--muted)] mb-1">{t('dcr.nostackhint', 'No stacktrace.txt. Read the reason above instead: it is the panic message and its source location, which is the part that names the bug.')}</p>}
          <Backtrace text={b.stack} t={t} />
        </div>}

        {tab === 'logs' && <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input value={logQ} onChange={(e) => setLogQ(e.target.value)} placeholder={t('dcr.logfilter', 'Filter the log')} aria-label={t('dcr.logfilter', 'Filter the log')} />
            <span className="text-[11px] text-[var(--faint)] whitespace-nowrap">{t('dcr.logcount', '{n} of {all}').replace('{n}', String(shown.length)).replace('{all}', String(logs.length))}</span>
          </div>
          <p className="text-[11px] text-[var(--faint)]">{t('dcr.logtail', 'The last {n} matching lines. BMM keeps the last 500 lines of the session, so this is the end of what it saw, not the whole run.').replace('{n}', String(LIMITS.logTail))}</p>
          <pre className="text-[11px] font-mono panel rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-[50vh]">
            {shown.map((l, i) => (
              <div key={i} className={/\b(ERROR|PANIC|FATAL)\b/.test(l.text) ? 'text-error' : /\bWARN/.test(l.text) ? 'text-warning' : ''}>
                <span className="text-[var(--faint)]">{l.ts ? `${l.ts} ` : ''}</span>{l.text}
              </div>
            ))}
            {!shown.length && <div className="text-[var(--muted)]">{t('dcr.nolog', 'No log lines.')}</div>}
          </pre>
        </div>}

        {tab === 'system' && <div className="space-y-3">
          {b.system.sections.map((s, i) => (
            <div key={i} className="rounded-lg border border-[var(--line)] p-3">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{s.title}</div>
              <div className="grid sm:grid-cols-2 gap-x-5 gap-y-1">{s.rows.map(([k, v], j) => <Row key={j} k={k} v={v} />)}</div>
            </div>
          ))}
          {!b.system.sections.length && <p className="text-[12px] text-[var(--muted)]">{t('dcr.nosys', 'No system_info.txt in this archive.')}</p>}
          {b.dxdiag && <details className="text-[12px]">
            <summary className="cursor-pointer text-[var(--muted)]">{t('dcr.dxdiag', 'dxdiag report (Windows crashes only)')}</summary>
            <pre className="mt-1 text-[11px] font-mono panel rounded-lg p-3 overflow-auto max-h-[40vh] whitespace-pre-wrap break-words">{b.dxdiag}</pre>
          </details>}
        </div>}

        {tab === 'config' && <div className="space-y-3">
          {!b.state && <p className="text-[12px] text-[var(--muted)]">{t('dcr.nostate', 'No state_snapshot.json. BMM only writes one on a clean exit, so a real crash almost never carries the configuration. What it was doing has to come from the log instead.')}</p>}
          {b.state && <>
            <div className="grid sm:grid-cols-2 gap-x-5 gap-y-1 rounded-lg border border-[var(--line)] p-3">
              <Row k={t('dcr.c.profiles', 'Profiles')} v={Array.isArray(b.state.profiles) ? b.state.profiles.length : '-'} />
              <Row k={t('dcr.c.mods', 'Mods')} v={Array.isArray(b.state.mods) ? b.state.mods.length : '-'} />
              <Row k={t('dcr.c.active', 'Active profile')} v={b.state.active_profile_id} />
              <Row k={t('dcr.c.packs', 'Modpacks')} v={Array.isArray(b.state.modpacks) ? b.state.modpacks.length : '-'} />
              <Row k={t('dcr.c.plugins', 'Plugins')} v={Array.isArray(b.state.installed_plugins) ? b.state.installed_plugins.length : '-'} />
              <Row k={t('dcr.c.lang', 'Language')} v={b.state.settings?.language} />
            </div>
            <details className="text-[12px]">
              <summary className="cursor-pointer text-[var(--muted)]">{t('dcr.c.settings', 'Every setting that was in effect')}</summary>
              <pre className="mt-1 text-[11px] font-mono panel rounded-lg p-3 overflow-auto max-h-[45vh] whitespace-pre-wrap break-words">{JSON.stringify(b.state.settings ?? {}, null, 2)}</pre>
            </details>
          </>}
          {b.frontend && <details className="text-[12px]">
            <summary className="cursor-pointer text-[var(--muted)]">{t('dcr.c.frontend', 'What the webview recorded (calls, actions, metrics)')}</summary>
            <pre className="mt-1 text-[11px] font-mono panel rounded-lg p-3 overflow-auto max-h-[45vh] whitespace-pre-wrap break-words">{JSON.stringify(b.frontend, null, 2).slice(0, 200000)}</pre>
          </details>}
        </div>}

        {tab === 'files' && <div className="rounded-lg border border-[var(--line)] overflow-hidden">
          {b.entries.map((e) => (
            <div key={e.name} className="px-2.5 py-1.5 text-[11px] border-b border-[var(--line)] last:border-0 flex items-center gap-2">
              <span className="font-mono truncate min-w-0" title={e.name}>{e.name}</span>
              <span className="text-[var(--faint)] ms-auto whitespace-nowrap">{fmtKB(e.size)}</span>
              {e.unsafe && <Badge tone="red">{e.unsafe}</Badge>}
            </div>
          ))}
          {b.truncated && <div className="px-2.5 py-1.5 text-[11px] text-[var(--muted)]">{t('dcr.listtrunc', 'The listing is cut; the count above is the real one.')}</div>}
        </div>}
      </div>}
    </Card>
  );
}
