// The BMM file inspector — every format BMM writes, read and summarised.
//
// EXTRACTED from admin.jsx so it can serve two audiences without two copies: moderators
// (Admin → moderation, POST /admin/inspect) and developers (/dev/tools, POST /dev/inspect).
// The component is identical; only the endpoint differs, and it is a prop so the day the two
// need to diverge the divergence is visible in the caller, not hidden in a fork of 400 lines.
//
// The reader never executes, fetches or writes anything — documents travel as parsed JSON,
// archives are read IN THE BROWSER (zip-read.js) and only entry names + hashes go to the
// server. That is what makes it safe to hand to developers, not just staff.
import { useEffect, useRef, useState } from 'react';
import { FileJson, Upload, ShieldCheck, ShieldAlert, ShieldQuestion, X, ChevronRight, FolderOpen } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Textarea, Badge, Spinner, useToast } from './ui.jsx';
import { listZip, readZipEntry, hashEntries } from '../lib/zip-read.js';
import ReplayPlayer from './ReplayPlayer.jsx';
// Left behind by the extraction from admin.jsx, which had it in scope from its own
// imports. A bare function call to an unbound name is a RUNTIME fact, not a compile
// one, so the build shipped a panel that threw the moment somebody opened a file.
import { highlightCode } from '../pages/pages.jsx';

/** A file name to a Prism language. Unknown extensions fall through to plain text, which is
 *  what an unhighlighted <pre> already was — never a wrong grammar, which mis-colours a file
 *  and makes it read as something it is not. */
function langOfName(name = '') {
  const ext = String(name).split('.').pop()?.toLowerCase();
  return ({
    json: 'json', js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'javascript',
    jsx: 'javascript', tsx: 'javascript', py: 'python', sh: 'bash', bash: 'bash',
    bmmpa: 'json', bmmnav: 'json', bmmreplay: 'json', mm: 'json',
  })[ext] || 'plain';
}


// Moved here WITH the inspector rather than left behind in admin.jsx. JSX resolves a
// component identifier at render, not at build, so the extraction shipped a page that
// parsed cleanly and crashed the moment it drew — once per format: SignatureVerdict on
// any file, BmmpaStep on a .bmmpa, ReplayPlayer on a recording.
function BmmpaStep({ node, depth = 0, t }) {
  const params = node.params ? Object.entries(node.params) : [];
  return (
    <>
      <div className="border-s-2 border-[var(--line)] ps-2 py-0.5" style={{ marginLeft: depth * 14 }}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[12px]">{node.type || node.kind}</span>
          {/* A glyph, not colour alone: a faint red word is easy to skim past on a light
              theme, and this is the thing not to skim. */}
          {node.note && <span className="text-[10px] font-bold text-[var(--error)] border border-[var(--error)] rounded px-1">!</span>}
          {node.refId && (node.refName
            ? <span className="text-[11px] text-[var(--muted)]">→ {node.refName}</span>
            : <span className="text-[11px] text-[var(--warning)]">→ {t('bmi.notIncluded', 'not in this file')}: <code>{node.refId}</code></span>)}
        </div>
        {params.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
            {params.map(([k, v]) => (
              <span key={k} className="text-[10px] text-[var(--muted)] break-all">
                <span className="text-[var(--faint)] me-1">{k}</span>{v}
              </span>
            ))}
          </div>
        )}
      </div>
      {(node.children || []).map((c, i) => <BmmpaStep key={i} node={c} depth={depth + 1} t={t} />)}
    </>
  );
}

function SignatureVerdict({ v, t }) {
  if (!v || v.state === 'unsigned') {
    return (
      <div className="text-[12px] rounded-lg border border-[var(--line)] text-[var(--muted)] p-2 mb-2">
        {t('bmi.sig.unsigned', 'Unsigned — this file makes no claim about who wrote it. Not a fault: files written before BMM signed anything, and files written by other tools, look like this.')}
      </div>
    );
  }
  if (v.state === 'valid') {
    return (
      <div className="text-[12px] rounded-lg border border-[var(--success)] p-2 mb-2">
        <div className="text-[var(--success)] font-medium">
          {t('bmi.sig.valid', 'Intact, unchanged since it was signed.')}
        </div>
        <div className="text-[var(--muted)] mt-0.5 break-all">
          {t('bmi.sig.key', 'Signing key')} <code>{String(v.authorId).slice(0, 16)}…</code>
          {v.signedAt ? ` · ${new Date(v.signedAt).toLocaleString()}` : ''}
        </div>
        <div className="text-[var(--faint)] mt-0.5">
          {t('bmi.sig.notidentity', 'A key is not a person: this says the file has not changed, not that its author is trustworthy.')}
        </div>
      </div>
    );
  }
  if (v.state === 'tampered') {
    return (
      <div className="text-[12px] rounded-lg border border-[var(--error)] p-2 mb-2">
        <div className="text-[var(--error)] font-medium">
          {t('bmi.sig.tampered', 'ALTERED, this file carries a signature, and it does not match its contents.')}
        </div>
        <div className="text-[var(--muted)] mt-0.5">
          {t('bmi.sig.tamperedwhy', 'Either it was edited after signing, or the signature block was copied from another file.')}
        </div>
      </div>
    );
  }
  return (
    <div className="text-[12px] rounded-lg border border-[var(--warning)] text-[var(--warning)] p-2 mb-2">
      {t('bmi.sig.malformed', 'The signature block is not readable')}: {v.reason}
    </div>
  );
}

export default function BmmInspector({ endpoint = '/admin/inspect' }) {
  const { t } = useI18n(); const toast = useToast();
  // Its own drag state. It read `dragOver` for the drop zone's highlight while the only
  // declaration lived in AdminProjects, 1700 lines away — so opening the inspector threw
  // ReferenceError: dragOver is not defined. React state is per component; a name that
  // resolves in the editor does not mean it resolves at runtime.
  //
  // `fileName` was the same borrowed name and was NOT fixed with it: the crash simply moved
  // one line down and the panel still would not open. Fixing the symptom that was reported
  // instead of the class is why this happened twice — check-undefined-names.mjs now covers it.
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState('');
  // An archive dropped here: the file itself (so one entry can be fetched later), its listing,
  // and whichever entry is open.
  const [zipFile, setZipFile] = useState(null);
  const [arch, setArch] = useState(null);
  const [entry, setEntry] = useState(null);
  const [busyZip, setBusyZip] = useState(false);
  // The verdict on the ARCHIVE as a whole, which is a different question from the verdict on
  // any single document inside it.
  const [archSig, setArchSig] = useState(null);
  // The API returns codes; the words are ours. An unknown code falls back to itself rather
  // than to a blank — a moderator seeing "app.frobnicate" learns something, a moderator
  // seeing nothing does not.
  const PERM = {
    command: t('bmi.p.command', 'Runs external programs'),
    script: t('bmi.p.script', 'Runs scripts (PowerShell / CMD / Bash / Python)'),
    deeplink: t('bmi.p.deeplink', 'Fires bmm:// deeplinks'),
    stopProcess: t('bmi.p.stop', 'Stops running programs'),
    delete: t('bmi.p.delete', 'Deletes profiles, modpacks or mod folders'),
  };
  const REACH = {
    'custom.command': t('bmi.r.command', 'Runs an external program'),
    'custom.script': t('bmi.r.script', 'Runs a script'),
    'app.stop': t('bmi.r.stop', 'Stops a program'),
    'app.launch': t('bmi.r.launch', 'Launches an app'),
    'file.open': t('bmi.r.file', 'Opens a file or program'),
    'folder.open': t('bmi.r.folder', 'Opens a folder'),
    'open.url': t('bmi.r.url', 'Opens a URL'),
    restart: t('bmi.r.restart', 'Restarts BMM'),
    'task.run': t('bmi.r.task', 'Runs another scheduled task'),
  };
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [rep, setRep] = useState(null);
  // The document as parsed, kept alongside the server's report. The report DESCRIBES the file;
  // playing a replay needs the file itself, and it is already here — re-reading or re-fetching
  // it would be asking for something the browser is already holding.
  const [parsed, setParsed] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    let doc;
    // Parsed here first so a typo is answered instantly and locally, and so the server is
    // never asked to make sense of something that is not JSON at all.
    try { doc = JSON.parse(text); }
    catch { return toast.error(t('bmi.badjson', 'That is not valid JSON, paste the whole .bmmpa file.')); }
    setBusy(true); setRep(null); setParsed(null);
    try { setRep(await api.post(endpoint, { doc })); setParsed(doc); }
    catch (x) { toast.error(x?.data?.detail || t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };

  /**
   * Read a dropped or chosen file INTO THE TEXTAREA. The file itself is never uploaded.
   *
   * That is the same rule the route was built on — the parsed value in the body, never a URL
   * — for the same reason: a tool for inspecting untrusted content must not become a way to
   * make the server fetch or store it. Reading it in the browser keeps the server's job to
   * "make sense of this JSON somebody already has".
   *
   * A ZIP is answered here rather than by a JSON parse error. .bmmplug and .bmmtheme are
   * archives, and "Unexpected token PK" tells nobody what to do next.
   */
  /**
   * List an archive, from the archive — nothing is uploaded.
   *
   * This used to base64 the whole file into a JSON body against a 32 MB limit, and repeat the
   * upload for every entry a reviewer clicked. A `.DATABMM` — BMM's "everything I have"
   * export, carrying session recordings and crash reports — is routinely hundreds of
   * megabytes, so the file most worth looking inside was the one file the tool refused.
   *
   * A ZIP's index sits at its END, so listing costs two small reads whatever the size, and
   * opening an entry decompresses that entry alone. It also makes the line on the drop zone
   * literally true: the archive never leaves this machine.
   */
  const loadArchive = async (file) => {
    setBusyZip(true);
    setArchSig(null);
    try {
      const listing = await listZip(file);
      setArch(listing);
      setEntry(null);
      void summarise(file, listing);
    } catch (e) {
      toast.error(String(e?.message || '').includes('not a zip')
        ? t('bmi.badzip2', 'That file is not a readable archive.')
        : t('common.failed', 'Failed.'));
    } finally { setBusyZip(false); }
  };

  /**
   * Every BMM document inside, summarised — the reason the moderator opened the file.
   *
   * Only the small JSON entries travel, one at a time, and only to the reader that already
   * exists for a pasted document. The archive itself still does not move.
   */
  const summarise = async (file, listing) => {
    // An archive's signature is an ENTRY, not a block: bmm_signature.json lists every other
    // file and its hash. Verifying it means hashing the archive here — it never moves — and
    // sending the list, which is exactly what was signed.
    const sigRow = listing.entries.find((e) => e.name === 'bmm_signature.json');
    if (sigRow) {
      try {
        const got = await readZipEntry(file, sigRow);
        const doc = JSON.parse(got.text);
        const hashes = await hashEntries(file, listing);
        if (!hashes) {
          setArchSig({ state: 'toobig' });
        } else {
          const r = await api.post(endpoint, { doc, archive: hashes });
          setArchSig(r.archiveSignature || { state: 'unsigned' });
        }
      } catch { setArchSig({ state: 'malformed', reason: 'bmm_signature.json could not be read' }); }
    } else {
      setArchSig({ state: 'unsigned' });
    }

    const known = [];
    for (const row of listing.entries) {
      if (known.length >= 12) break;
      // .bmp entries too: a .cbmp modpack catalogue carries its packs as packs/*.bmp, and
      // those ARE JSON documents — skipping them showed a reviewer the catalogue's index and
      // hid exactly the entries whose download links need reviewing.
      // .bmmpa too: a catalogue BUNDLE carries its automations as *.bmmpa beside the
      // catalog.json, and those ARE JSON documents. Skipping them showed a reviewer the
      // catalogue's index and hid every automation it is actually shipping — which is the
      // only part with permissions and deeplinks in it.
      const lname = row.name.toLowerCase();
      // .mm too: a bundle of MOD LISTS carries them, and they are JSON documents the
      // reader already knows ('mm'). Skipping them showed the catalogue and hid every
      // list it ships — which is where the download links are.
      const readable = lname.endsWith('.json') || lname.endsWith('.bmp')
        || lname.endsWith('.bmmpa') || lname.endsWith('.mm');
      if (!readable || row.size > 512 * 1024) continue;
      try {
        const got = await readZipEntry(file, row);
        if (got.binary || got.truncated) continue;
        const rep = await api.post(endpoint, { doc: JSON.parse(got.text) });
        if (rep.ok) known.push({ name: row.name, ...rep });
      } catch { /* not a BMM document — the listing already says what it is */ }
    }
    // A BUNDLE promises things. Whether it carries them is the review question, and it is
    // one only this side can answer: the reader is handed one document at a time and has
    // never seen the archive around it.
    //
    // Cross-checked case-insensitively and on the base name, because a zip written on
    // Windows and read on Linux disagrees about neither of those but a reviewer would be
    // told "missing" for a file plainly in the list.
    const cat = known.find((k) => k.format === 'bmmcat');
    let bundle = null;
    if (cat && Array.isArray(cat.packedNames)) {
      const have = new Set(listing.entries.map((e) => e.name.toLowerCase().replace(/^.*[/\\]/, '')));
      const missing = cat.packedNames.filter((n) => !have.has(String(n).toLowerCase().replace(/^.*[/\\]/, '')));
      bundle = { promised: cat.packedNames.length, missing };
    }
    if (known.length || bundle) setArch((prev) => (prev ? { ...prev, known, ...(bundle ? { bundle } : {}) } : prev));
  };

  const openEntry = async (row) => {
    if (!zipFile) return;
    setEntry({ name: row.name, loading: true });
    try {
      setEntry({ name: row.name, ...(await readZipEntry(zipFile, row)) });
    } catch (e) {
      setEntry({ name: row.name, error: String(e?.message || e) });
    }
  };

  const loadFile = async (file) => {
    if (!file) return;
    // The FIRST FOUR BYTES decide, not the whole file: an archive is answered without ever
    // reading it, and only a document that really is text gets read into the box. Reading a
    // 400 MB export with file.text() to find out it starts with PK is how this hung before
    // refusing. Archives have no size limit any more — nothing is uploaded.
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer().catch(() => new ArrayBuffer(0)));
    const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
    if (!isZip && file.size > 8 * 1024 * 1024) {
      return toast.error(t('bmi.toobig', 'That file is over 8 MB, larger than the inspector accepts.'));
    }
    const raw = isZip ? '' : await file.text().catch(() => null);
    if (raw == null) return toast.error(t('bmi.readfail', 'Could not read that file.'));
    if (isZip) {
      // A ZIP used to be refused here — "open it and drop the manifest from inside" — which is
      // the moment a review stops. It is read as what it is now: a list of entries, any of
      // which can be opened, with every recognised BMM document inside already summarised.
      setRep(null); setParsed(null); setText(''); setFileName(file.name); setZipFile(file);
      return loadArchive(file);
    }
    setRep(null); setParsed(null);
    setText(raw);
    setFileName(file.name);
  };

  if (!open) {
    return (
      <Button size="sm" className="mb-3" onClick={() => setOpen(true)}>
        <FileJson size={14} /> {t('bmi.openAny', 'Inspect a BMM file')}
      </Button>
    );
  }
  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-sm font-semibold flex items-center gap-2"><FileJson size={15} className="text-[var(--accent-ink)]" /> {t('bmi.titleAny', 'Inspect a BMM file')}</div>
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setRep(null); setParsed(null); setText(''); setFileName(''); }}>{t('common.close', 'Close')}</Button>
      </div>
      <p className="text-[12px] text-[var(--muted)] mb-2">
        {t('bmi.subAny', 'Paste any BMM file, automation, mod list, session replay, navbar config. It is read, never run: nothing is imported and nothing is fetched.')}
      </p>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); loadFile(e.dataTransfer?.files?.[0]); }}
        className={`rounded-lg border border-dashed p-3 mb-2 text-[12px] text-center ${dragOver ? 'border-[var(--primary-2)] text-[var(--accent-ink)]' : 'border-[var(--line)] text-[var(--muted)]'}`}
      >
        {t('bmi.drop', 'Drop a file here, or')}{' '}
        <label className="underline cursor-pointer">
          {t('bmi.choose', 'choose one')}
          <input type="file" className="hidden" accept=".bmmpa,.bmmreplay,.mm,.json,.bmmnav,.DATABMM,.bmmplug,.bmmtheme,.zip,.cbmp,.bmp,.mmlist,application/json"
            onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {fileName && <div className="mt-1 text-[var(--faint)] break-all">{fileName}</div>}
        <div className="mt-1 text-[var(--faint)]">{t('bmi.local', 'The file is read in your browser. Only its contents are sent, and only when you press Read it.')}</div>
      </div>
      {/* An archive: what is inside it, and any one entry opened. Shown INSTEAD of the paste
          box while one is loaded — the two answer different questions and stacking both puts
          a reviewer in front of an empty textarea below a file they are reading. */}
      {busyZip && <div className="text-[12px] text-[var(--muted)] mb-2"><Spinner /> {t('bmi.zipreading', 'Reading the archive…')}</div>}
      {arch ? (
        <div className="mb-2">
          {/* Whether the ARCHIVE is intact — above its file list, because it changes how the
              list should be read. */}
          {archSig && archSig.state !== 'toobig' && <SignatureVerdict v={archSig} t={t} />}
          {archSig?.state === 'toobig' && (
            <div className="text-[12px] rounded-lg border border-[var(--line)] text-[var(--muted)] p-2 mb-2">
              {t('bmi.sig.toobig', 'Too large to verify in the browser, every entry would have to be hashed. The listing below is still exact.')}
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap text-[12px] text-[var(--muted)] mb-1">
            <span>{t('bmi.zipn', '{n} file(s), {kb} KB').replace('{n}', String(arch.total)).replace('{kb}', String(Math.round(arch.bytes / 1024)))}</span>
            {arch.truncated && <Badge tone="amber">{t('bmi.ziptrunc', 'showing the first {n}').replace('{n}', String(arch.listed))}</Badge>}
            <Button size="sm" variant="ghost" className="ms-auto"
              onClick={() => { setArch(null); setEntry(null); setZipFile(null); setFileName(''); }}>
              {t('common.clear', 'Clear')}
            </Button>
          </div>

          {/* Raised above the list on purpose: a path that climbs out of the archive is the one
              thing a reviewer must not have to scroll for. */}
          {(arch.warnings || []).length > 0 && (
            <div className="rounded-lg border border-[var(--error)] p-2 mb-2 text-[12px]">
              <div className="font-medium text-[var(--error)] mb-0.5">{t('bmi.zipwarn', 'Paths that leave the archive')}</div>
              {arch.warnings.map((w, i) => <div key={i} className="text-[var(--muted)] break-all">{w}</div>)}
            </div>
          )}

          {/* A catalogue BUNDLE: does it carry what it lists?
              The one thing a reviewer cannot see from the entry list, because it means
              reading the catalogue and the listing against each other. A complete bundle is
              a self-contained thing; an incomplete one is a promise its author has not
              noticed breaking. */}
          {arch.bundle && (
            <div className={`rounded-lg border p-2 mb-2 text-[12px] ${arch.bundle.missing.length ? 'border-[var(--warning)]' : 'border-[var(--line)]'}`}>
              <div className={`font-medium mb-0.5 ${arch.bundle.missing.length ? 'text-warning' : ''}`}>
                {arch.bundle.missing.length
                  ? t('bmi.bundleShort', 'This catalogue names files the archive does not hold')
                  : t('bmi.bundleOk', 'Self-contained, every file this catalogue names is in the archive')}
              </div>
              <div className="text-[var(--muted)]">
                {t('bmi.bundleCount', '{n} packed entr(y/ies)').replace('{n}', String(arch.bundle.promised))}
                {arch.bundle.missing.length > 0 && (
                  <> · <span className="break-all">{arch.bundle.missing.slice(0, 8).join(', ')}</span></>
                )}
              </div>
            </div>
          )}

          {/* Every BMM document inside, already read. This is what the reviewer opened the
              file for, so it does not wait for a second click. */}
          {(arch.known || []).length > 0 && (
            <div className="mb-2 space-y-1">
              {arch.known.map((k) => (
                <div key={k.name} className="text-[12px] flex items-center gap-2">
                  <Badge tone="primary">{k.format}</Badge>
                  <span className="break-all">{k.name}</span>
                </div>
              ))}
            </div>
          )}

          <div className="grid sm:grid-cols-[220px_1fr] gap-2">
            <div className="rounded-lg border border-[var(--line)] max-h-[320px] overflow-auto">
              {arch.entries.map((e) => (
                <button key={e.name} type="button"
                  onClick={() => openEntry(e)}
                  className={`w-full text-start px-2 py-1 text-[11px] border-b border-[var(--line)] last:border-0 hover:bg-[var(--surface-2)] ${
                    entry?.name === e.name ? 'bg-[var(--surface-2)]' : ''}`}>
                  <div className="break-all">{e.name}</div>
                  <div className="text-[var(--faint)]">
                    {/* Every entry is clickable now. The extension is only a guess here — the
                        bytes decide when it is opened, which is how an .exe called .txt gets
                        caught instead of being greyed out and skipped. */}
                    {Math.max(1, Math.round(e.size / 1024))} KB{e.text ? '' : ` · ${t('bmi.zipbin', 'probably binary')}`}
                    {e.unsafe ? ` · ${e.unsafe}` : ''}
                  </div>
                </button>
              ))}
            </div>
            <div className="rounded-lg border border-[var(--line)] p-2 max-h-[320px] overflow-auto">
              {entry?.loading ? <div className="text-[12px] text-[var(--muted)]"><Spinner /> {t('bmi.zipopening', 'Opening…')}</div>
                : entry?.error ? <div className="text-[12px] text-[var(--warning)] break-all">{entry.error}</div>
                : entry?.tooBig ? <div className="text-[12px] text-[var(--muted)]">{t('bmi.ziphuge', 'This entry is {mb} MB, too large to open in a panel. Everything about it that a review needs is in the listing.').replace('{mb}', String(Math.round(entry.size / 1048576)))}</div>
                : entry ? (entry.binary
                ? <div className="text-[12px] text-[var(--muted)]">{t('bmi.zipbinmsg', 'Binary: {kb} KB. Nothing here renders it, and rendering it as text would be noise.').replace('{kb}', String(Math.round(entry.size / 1024)))}</div>
                : <>
                    {entry.truncated && <div className="text-[11px] text-[var(--warning)] mb-1">{t('bmi.ziptrunctext', 'Showing the first 256 KB of {kb} KB.').replace('{kb}', String(Math.round(entry.size / 1024)))}</div>}
                    {/* Highlighted with the same Prism setup the JSON editor uses. A moderator
                        reading somebody's plugin script needs strings to look like strings —
                        an unhighlighted wall of JS is where a `fetch` to somewhere unexpected
                        hides. `whitespace-pre-wrap` and not `break-all`: breaking mid-token
                        makes a URL unreadable, which is the one thing worth reading closely. */}
                    <pre className="text-[11px] whitespace-pre-wrap break-words prism-bmm"
                      dangerouslySetInnerHTML={{ __html: highlightCode(entry.text, langOfName(entry.name)) }} />
                  </>)
                : <div className="text-[12px] text-[var(--muted)]">{t('bmi.zippick', 'Pick a file on the left to read it.')}</div>}
            </div>
          </div>
        </div>
      ) : (
      <Textarea rows={5} value={text} onChange={(e) => { setText(e.target.value); setFileName(''); }} placeholder='{"magic":"BMMPA","version":1,"tasks":[…]}' />
      )}
      <div className="flex gap-2 mt-2">
        <Button size="sm" variant="primary" disabled={busy || !text.trim()} onClick={run}>{busy ? <Spinner /> : t('bmi.read', 'Read it')}</Button>
        {text.trim() && <Button size="sm" variant="ghost" onClick={() => { setText(''); setFileName(''); setRep(null); }}>{t('common.clear', 'Clear')}</Button>}
      </div>

      {rep && (
        <div className="mt-3">
          {/* Not a format we know. The keys it DID see are in the message, because the next
              question is always "then what is this", and a refusal that does not say makes
              somebody open the file in a text editor to answer it. */}
          {rep.ok === false && (
            <div className="text-[12px] rounded-lg border border-[var(--warning)] text-[var(--warning)] p-2.5 mb-2">
              <div className="break-all">{rep.error}</div>
              {rep.hint && <div className="text-[var(--muted)] mt-1">{rep.hint}</div>}
            </div>
          )}

          {/* Everything that is not an automation: mod lists, replays, navbar configs. One
              renderer, because every reader returns the same summary shape — a per-format
              panel would be four screens to keep consistent instead of one. */}
          {/* Is this still what its author wrote? Above everything else, because a reviewer
              reads the rest differently once they know. "Unsigned" is shown too — a blank
              space where a verdict would go reads as "fine", and it is not the same answer. */}
          {rep.ok && <SignatureVerdict v={rep.signature} t={t} />}

          {/* A session replay is the one format whose summary cannot answer the question.
              "1 240 events, 3m12s, 2 console errors" tells a moderator nothing about what the
              person was actually DOING — and that is the entire reason a replay was attached
              to a report. So it plays, here, in the same player the docs use.

              `parsed` and not a URL: the file was read off the reviewer's machine and never
              uploaded, so there is nothing to fetch. Nothing is executed either — rrweb
              rebuilds a DOM from recorded mutations, it does not run the recorded page. */}
          {rep.ok && rep.format === 'bmmreplay' && parsed && (
            <div className="mb-2">
              <ReplayPlayer doc={parsed} title={fileName || t('bmi.replay', 'Session replay')} />
            </div>
          )}

          {rep.ok && rep.format && rep.format !== 'bmmpa' && (
            <div className="rounded-lg border border-[var(--line)] p-2.5 mb-2">
              <div className="flex items-baseline gap-2 flex-wrap">
                <b className="text-[13px]">{rep.title}</b>
                <span className="text-[11px] text-[var(--accent-ink)]">{rep.format}</span>
              </div>
              <div className="mt-1.5 flex flex-col gap-0.5">
                {(rep.summary || []).map((r, i) => (
                  <div key={i} className={`text-[12px] break-all ${r.tone === 'warn' ? 'text-[var(--warning)]' : ''}`}>
                    <span className="text-[var(--faint)] me-1.5">{r.label}</span>{r.value}
                  </div>
                ))}
              </div>
              {(rep.detail || []).length > 0 && (
                <details className="mt-2">
                  <summary className="text-[12px] cursor-pointer text-[var(--accent-ink)]">{t('bmi.entries', 'Entries')} ({rep.detail.length})</summary>
                  <div className="mt-1.5 flex flex-col gap-0.5 max-h-64 overflow-auto">
                    {rep.detail.map((d, i) => (
                      <div key={i} className="text-[11px] break-all">
                        <span className="me-1.5">{d.name}</span>
                        <span className="text-[var(--muted)]">{d.note}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* The verdict first. The question is "can I approve this", and an answer under a
              step list is an answer nobody reads. */}
          {rep.format === 'bmmpa' && (<>
          <div className={`text-[12px] rounded-lg border p-2.5 mb-2 ${rep.bmmpa.needsReview ? 'border-[var(--warning)] text-[var(--warning)]' : 'border-[var(--line)] text-[var(--muted)]'}`}>
            {rep.bmmpa.needsReview
              ? t('bmi.review', 'This file grants itself permissions or reaches outside BMM. Read it before approving.')
              : t('bmi.clean', 'Nothing here asks for a permission or touches anything outside BMM.')}
          </div>
          {/* What else is in the file, and what it names but does not carry. Both belong
              above the tasks: "12 automations" means something different when three of
              them call a fourth that is not here. */}
          {(rep.bmmpa.includes?.launchpacks > 0 || rep.bmmpa.includes?.modpacks > 0) && (
            <div className="text-[11px] text-[var(--muted)] mb-2">
              {t('bmi.alsoCarries', 'Also in this file:')}{' '}
              {[rep.bmmpa.includes.launchpacks && `${rep.bmmpa.includes.launchpacks} ${t('bmi.launchpacks', 'launch pack(s)')}`,
                rep.bmmpa.includes.modpacks && `${rep.bmmpa.includes.modpacks} ${t('bmi.modpacks', 'modpack(s)')}`].filter(Boolean).join(' · ')}
            </div>
          )}
          {rep.bmmpa.unresolved?.length > 0 && (
            <div className="text-[12px] text-[var(--warning)] rounded-lg border border-[var(--warning)] p-2 mb-2 break-all">
              {t('bmi.unresolved', 'Names {n} thing(s) it does not include, these import cleanly and fail on the user\'s machine:').replace('{n}', String(rep.bmmpa.unresolved.length))}{' '}
              {rep.bmmpa.unresolved.slice(0, 8).map((u) => `${u.kind}:${u.id}`).join('  ·  ')}
            </div>
          )}
          {rep.bmmpa.tasks.map((tk, i) => (
            <div key={i} className="rounded-lg border border-[var(--line)] p-2.5 mb-2">
              <div className="flex items-baseline gap-2 flex-wrap">
                <b className="text-[13px]">{tk.name}</b>
                <span className="text-[11px] text-[var(--accent-ink)]">{tk.trigger}</span>
                <span className="text-[11px] text-[var(--muted)] ms-auto">{tk.stepCount} {t('bmi.steps', 'steps')}</span>
              </div>
              {tk.description && <div className="text-[12px] text-[var(--muted)] mt-1">{tk.description}</div>}
              {tk.perms.length > 0 && <div className="text-[12px] text-[var(--warning)] mt-1.5"><b>{t('bmi.asks', 'Grants itself:')}</b> {tk.perms.map((k) => PERM[k] || k).join(' · ')}</div>}
              {tk.reaching.length > 0 && <div className="text-[12px] text-[var(--warning)] mt-1"><b>{t('bmi.reaches', 'Reaches outside BMM:')}</b> {tk.reaching.map((k) => REACH[k] || k).join(' · ')}</div>}
              {tk.targets.length > 0 && <div className="text-[11px] text-[var(--muted)] mt-1 break-all"><b>{t('bmi.names', 'Names:')}</b> {tk.targets.join('  ·  ')}</div>}
              {tk.scripts.map((sc, j) => (
                <details key={j} className="mt-2">
                  <summary className="text-[12px] cursor-pointer text-[var(--accent-ink)]">{t('bmi.script', 'Script')} — {sc.engine}</summary>
                  {/* whitespace-pre and its own scroll: reflowed code is code you cannot judge. */}
                  <pre className="mt-1.5 p-2 rounded-lg text-[11px] overflow-auto max-h-64 whitespace-pre" style={{ background: 'var(--bg-solid)', border: '1px solid var(--line)' }}>{sc.code}</pre>
                </details>
              ))}
              {tk.steps?.length > 0 && (
                <details className="mt-2" open>
                  <summary className="text-[12px] cursor-pointer text-[var(--accent-ink)]">{t('bmi.tree', 'Every step, in order')}</summary>
                  <div className="mt-1.5 flex flex-col gap-0.5">
                    {tk.steps.map((n, j) => <BmmpaStep key={j} node={n} depth={0} t={t} />)}
                  </div>
                </details>
              )}
            </div>
          ))}
          </>)}
        </div>
      )}
    </Card>
  );
}
