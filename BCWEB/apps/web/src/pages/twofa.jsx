// A fully-LOCAL TOTP authenticator (RFC 6238). Nothing here ever touches the
// network: secrets are generated/entered on the device, codes are computed with
// the Web Crypto API, and the vault is stored in localStorage — optionally
// encrypted at rest with a passphrase (AES-GCM + PBKDF2) so a leaked disk / shared
// browser profile doesn't expose the seeds (CWE-312). QR import uses jsQR (local).
// TOTP/vault primitives live in twofa-lib.js (shared with the inline quick-fill).
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { ShieldCheck, KeyRound, QrCode, Camera, Download, Upload, Plus, Trash2, Copy, Lock, Unlock, History as HistoryIcon, X, Clock, KeyRound as KeyIcon } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Input, Select, Field, useToast, useDialog, PageHeader, EmptyState } from '../ui/ui.jsx';
import { base32Decode, totp, parseOtpauth, sanitizeAccount, encryptVault, decryptVault, rid, takePending, LS_KEY } from '../lib/twofa-lib.js';

export function TwoFactor() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [accounts, setAccounts] = useState([]);
  const [history, setHistory] = useState([]);
  const [codes, setCodes] = useState({});
  const [now, setNow] = useState(Date.now());
  const [encrypted, setEncrypted] = useState(false); // vault on disk is passphrase-encrypted
  const [locked, setLocked] = useState(false);       // encrypted + not yet unlocked this session
  const passRef = useRef(null);                        // active passphrase (memory only)
  const [showHistory, setShowHistory] = useState(false);
  const [pendingImport, setPendingImport] = useState(null); // account handed off from Profile, waiting for an unlock

  // ── Load once (+ consume any account handed off from Profile's 2FA setup) ──
  useEffect(() => {
    let accts = [], hist = [], enc = false;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) { const parsed = JSON.parse(raw); if (parsed.enc) enc = true; else { accts = parsed.accounts || []; hist = parsed.history || []; } }
    } catch { /* corrupt vault — start fresh */ }
    const pend = takePending();
    const pendAcct = pend ? sanitizeAccount(pend) : null;
    if (enc) { setEncrypted(true); setLocked(true); if (pendAcct) setPendingImport(pendAcct); return; }
    if (pendAcct && !accts.some((a) => a.secret === pendAcct.secret)) { accts = [...accts, pendAcct]; persist(accts, hist); toast.success(t('tfa.added', 'Added “{n}”.').replace('{n}', pendAcct.issuer || pendAcct.label)); }
    setAccounts(accts); setHistory(hist);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist (encrypt if a passphrase is set) ──
  const persist = async (accts, hist) => {
    try {
      if (passRef.current) localStorage.setItem(LS_KEY, JSON.stringify(await encryptVault({ accounts: accts, history: hist }, passRef.current)));
      else localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, enc: false, accounts: accts, history: hist }));
    } catch { toast.error(t('tfa.savefail', 'Could not save the vault.')); }
  };
  const commit = (accts, hist = history) => { setAccounts(accts); setHistory(hist); persist(accts, hist); };

  // ── Live codes + countdown, once per second ──
  useEffect(() => {
    if (locked) return;
    let alive = true;
    const tick = async () => {
      const out = {};
      for (const a of accounts) { try { out[a.id] = await totp(a.secret, a, Date.now()); } catch { out[a.id] = null; } }
      if (alive) { setCodes(out); setNow(Date.now()); }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); };
  }, [accounts, locked]);

  // ── Add / import ──
  const addAccount = (a) => {
    const acct = { id: rid(), label: a.label || 'Account', issuer: a.issuer || '', secret: a.secret, digits: a.digits || 6, period: a.period || 30, algorithm: a.algorithm || 'SHA1', backupCodes: Array.isArray(a.backupCodes) ? a.backupCodes : [], addedAt: Date.now() };
    commit([...accounts, acct]);
    toast.success(t('tfa.added', 'Added “{n}”.').replace('{n}', acct.issuer || acct.label));
  };
  const handleOtpauth = (uri) => { try { addAccount(parseOtpauth(uri)); return true; } catch (e) { toast.error(t('tfa.badqr', 'Not a valid TOTP QR/URI ({e}).').replace('{e}', e.message)); return false; } };
  const del = async (a) => {
    if (!(await dialog.confirm({ title: t('tfa.del.t', 'Remove account?'), message: t('tfa.del.m', 'This deletes the secret from this device. If you don’t have it backed up elsewhere you’ll lose access to the codes.'), okLabel: t('tfa.del.ok', 'Remove'), danger: true }))) return;
    commit(accounts.filter((x) => x.id !== a.id));
  };
  const copyCode = (a) => {
    const code = codes[a.id]; if (!code) return;
    navigator.clipboard?.writeText(code);
    const entry = { id: rid(), accountId: a.id, label: a.issuer || a.label, code, at: Date.now() };
    commit(accounts, [entry, ...history].slice(0, 200));
    toast.success(t('tfa.copied', 'Code copied.'));
  };

  // ── Manual add form ──
  const [mf, setMf] = useState({ issuer: '', label: '', secret: '', digits: 6, period: 30, algorithm: 'SHA1' });
  const [manualOpen, setManualOpen] = useState(false);
  const submitManual = () => {
    try { base32Decode(mf.secret); } catch { return toast.error(t('tfa.badsecret', 'The secret isn’t valid Base32.')); }
    addAccount({ ...mf, digits: Number(mf.digits) || 6, period: Number(mf.period) || 30 });
    setMf({ issuer: '', label: '', secret: '', digits: 6, period: 30, algorithm: 'SHA1' }); setManualOpen(false);
  };

  // ── QR scanning (jsQR — pure JS, works in every browser incl. Windows desktop
  // Chrome where the native BarcodeDetector is unavailable). Everything is decoded
  // locally from a canvas; no upload, no network. ──
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef(null); const streamRef = useRef(null); const canvasRef = useRef(null);
  const getCanvas = () => (canvasRef.current ||= document.createElement('canvas'));
  const decodeFromSource = (src, w, h) => {
    if (!w || !h) return null;
    const cv = getCanvas(); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const res = jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
    return res?.data && res.data.startsWith('otpauth:') ? res.data : null;
  };
  const stopScan = () => { setScanning(false); streamRef.current?.getTracks().forEach((tr) => tr.stop()); streamRef.current = null; };
  const startScan = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return toast.error(t('tfa.nocam', 'Couldn’t access the camera.'));
    try { streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); setScanning(true); }
    catch { toast.error(t('tfa.nocam', 'Couldn’t access the camera.')); }
  };
  useEffect(() => {
    if (!scanning) return;
    const v = videoRef.current; if (!v) return;
    v.srcObject = streamRef.current; v.play().catch(() => {});
    let alive = true;
    const loop = () => {
      if (!alive) return;
      if (v.readyState >= 2 && v.videoWidth) {
        const uri = decodeFromSource(v, v.videoWidth, v.videoHeight);
        if (uri && handleOtpauth(uri)) { stopScan(); return; }
      }
      if (alive) setTimeout(loop, 350);
    };
    const id = setTimeout(loop, 500);
    return () => { alive = false; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);
  useEffect(() => () => stopScan(), []); // stop camera on unmount
  const scanImage = async (file) => {
    if (!file) return;
    try {
      const bmp = await createImageBitmap(file);
      const uri = decodeFromSource(bmp, bmp.width, bmp.height);
      if (uri) handleOtpauth(uri); else toast.error(t('tfa.noqrfound', 'No TOTP QR code found in that image.'));
    } catch { toast.error(t('tfa.imgfail', 'Couldn’t read that image.')); }
  };

  // ── Export / import JSON ──
  // The export can be encrypted with a passphrase (AES-GCM), so the file never has to
  // hold secrets in the clear. If the vault already has a passphrase we reuse it;
  // otherwise we offer to set one for the file.
  const download = (obj) => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `bcw-2fa-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const exportJson = async () => {
    if (!accounts.length) return toast.error(t('tfa.empty.t', 'No accounts yet'));
    let pass = passRef.current; // reuse the active vault passphrase if there is one
    if (!pass) {
      const wantEnc = await dialog.confirm({ title: t('tfa.exp.enc.t', 'Encrypt the export?'), message: t('tfa.exp.enc.m', 'Protect the file with a passphrase (AES-256) so your secrets aren’t written in plain text. Strongly recommended.'), okLabel: t('tfa.exp.enc.ok', 'Encrypt'), cancelLabel: t('tfa.exp.enc.no', 'Plain text') });
      if (wantEnc) {
        pass = await dialog.prompt({ title: t('tfa.exp.pass', 'Export passphrase'), label: t('tfa.pass.l', 'Passphrase'), type: 'password' });
        if (!pass) return;
        if (String(pass).length < 6) return toast.error(t('tfa.pass.short', 'Use at least 6 characters.'));
      }
    }
    if (pass) {
      const blob = await encryptVault({ accounts, history }, String(pass));
      download({ type: 'bcw-2fa-export', version: 1, exportedAt: new Date().toISOString(), ...blob });
      toast.success(t('tfa.exported.enc', 'Exported (encrypted) — you’ll need the passphrase to import it.'));
    } else {
      download({ type: 'bcw-2fa-export', version: 1, enc: false, exportedAt: new Date().toISOString(), accounts, history });
      toast.success(t('tfa.exported', 'Exported — keep this file somewhere safe; it contains your secrets.'));
    }
  };
  const importJson = async (file) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      let data = parsed;
      if (parsed.enc) {
        const pass = await dialog.prompt({ title: t('tfa.imp.pass', 'Import passphrase'), message: t('tfa.imp.passm', 'This export is encrypted. Enter the passphrase it was exported with.'), label: t('tfa.pass.l', 'Passphrase'), type: 'password' });
        if (!pass) return;
        try { data = await decryptVault(parsed, String(pass)); } catch { return toast.error(t('tfa.wrongpass', 'Wrong passphrase.')); }
      }
      const incoming = (Array.isArray(data.accounts) ? data.accounts : []).map(sanitizeAccount).filter(Boolean);
      if (!incoming.length) return toast.error(t('tfa.noimport', 'No accounts found in that file.'));
      const have = new Set(accounts.map((a) => a.secret));
      const merged = [...accounts, ...incoming.filter((a) => !have.has(a.secret))];
      commit(merged);
      toast.success(t('tfa.imported', 'Imported {n} account(s).').replace('{n}', merged.length - accounts.length));
    } catch { toast.error(t('tfa.importfail', 'That file isn’t a valid export.')); }
  };

  // ── Passphrase / lock ──
  const setPassphrase = async () => {
    const pass = await dialog.prompt({ title: t('tfa.pass.set', 'Set a passphrase'), message: t('tfa.pass.setm', 'Your vault will be encrypted at rest with this passphrase. If you forget it, the secrets can’t be recovered.'), label: t('tfa.pass.l', 'Passphrase'), type: 'password' });
    if (!pass) return;
    if (String(pass).length < 6) return toast.error(t('tfa.pass.short', 'Use at least 6 characters.'));
    passRef.current = String(pass); setEncrypted(true); await persist(accounts, history);
    toast.success(t('tfa.pass.on', 'Vault encrypted.'));
  };
  const removePassphrase = async () => {
    if (!(await dialog.confirm({ title: t('tfa.pass.rem', 'Remove encryption?'), message: t('tfa.pass.remm', 'The vault will be stored in plain text on this device again.'), okLabel: t('tfa.pass.rem.ok', 'Remove'), danger: true }))) return;
    passRef.current = null; setEncrypted(false); await persist(accounts, history);
    toast.success(t('tfa.pass.off', 'Encryption removed.'));
  };
  const lockNow = () => { passRef.current = null; setAccounts([]); setHistory([]); setCodes({}); setLocked(true); };
  const [unlockPass, setUnlockPass] = useState('');
  const unlock = async () => {
    try {
      const blob = JSON.parse(localStorage.getItem(LS_KEY));
      const data = await decryptVault(blob, unlockPass);
      passRef.current = unlockPass;
      let accts = data.accounts || []; const hist = data.history || [];
      // Fold in an account that was handed off from Profile while the vault was locked.
      if (pendingImport && !accts.some((a) => a.secret === pendingImport.secret)) { accts = [...accts, pendingImport]; }
      setAccounts(accts); setHistory(hist); setLocked(false); setUnlockPass('');
      if (pendingImport) { await persist(accts, hist); setPendingImport(null); }
    } catch { toast.error(t('tfa.wrongpass', 'Wrong passphrase.')); }
  };
  // Add / append backup (recovery) codes to an account.
  const addBackupCodes = async (a) => {
    const raw = await dialog.prompt({ title: t('tfa.bk.add', 'Add backup codes'), message: t('tfa.bk.addm', 'Paste your one-time backup/recovery codes (one per line or comma-separated). They’re stored locally with this account.'), label: t('tfa.bk.codes', 'Backup codes') });
    if (!raw) return;
    const codes = String(raw).split(/[\s,;]+/).map((c) => c.trim().slice(0, 64)).filter(Boolean).slice(0, 50);
    if (!codes.length) return;
    const existing = a.backupCodes || [];
    commit(accounts.map((x) => (x.id === a.id ? { ...x, backupCodes: [...new Set([...existing, ...codes])] } : x)));
    toast.success(t('tfa.bk.added', 'Backup codes saved.'));
  };
  const removeBackupCode = (a, code) => commit(accounts.map((x) => (x.id === a.id ? { ...x, backupCodes: (x.backupCodes || []).filter((c) => c !== code) } : x)));

  // ── Locked screen ──
  if (locked) return (
    <div className="max-w-md mx-auto">
      <PageHeader icon={Lock} title={t('tfa.title', 'Authenticator (2FA)')} subtitle={t('tfa.locked.sub', 'This vault is encrypted. Enter your passphrase to unlock.')} />
      <Card className="p-5 space-y-3">
        {pendingImport && <div className="text-xs text-[var(--primary-2)] flex items-center gap-1.5"><KeyIcon size={13} /> {t('tfa.pending', 'A new account (“{n}”) will be added once you unlock.').replace('{n}', pendingImport.issuer || pendingImport.label)}</div>}
        <Input type="password" autoFocus value={unlockPass} onChange={(e) => setUnlockPass(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && unlock()} placeholder={t('tfa.pass.l', 'Passphrase')} />
        <Button variant="primary" className="w-full" onClick={unlock}><Unlock size={15} /> {t('tfa.unlock', 'Unlock')}</Button>
      </Card>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader icon={ShieldCheck} title={t('tfa.title', 'Authenticator (2FA)')} subtitle={t('tfa.sub', 'A private, fully-local TOTP authenticator. Nothing leaves your device.')}
        actions={<div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" onClick={() => setShowHistory((v) => !v)}><HistoryIcon size={14} /> {t('tfa.history', 'History')}</Button>
          <Button size="sm" onClick={exportJson}><Download size={14} /> {t('tfa.export', 'Export')}</Button>
          <label className="btn btn-sm cursor-pointer"><Upload size={14} /> {t('tfa.import', 'Import')}<input type="file" accept="application/json,.json" className="hidden" onChange={(e) => { importJson(e.target.files?.[0]); e.target.value = ''; }} /></label>
        </div>} />

      {/* privacy / security note */}
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/40 p-3 mb-4 flex items-start gap-2.5 text-xs text-[var(--muted)]">
        <ShieldCheck size={15} className="text-success shrink-0 mt-0.5" />
        <div>{t('tfa.note', 'Secrets never leave this browser — codes are computed locally with the Web Crypto API and stored only in this device’s local storage.')} {encrypted
          ? <span className="text-success">{t('tfa.note.enc', 'Encrypted at rest.')} <button className="underline" onClick={removePassphrase}>{t('tfa.pass.remove', 'remove')}</button> · <button className="underline" onClick={lockNow}>{t('tfa.lock', 'lock now')}</button></span>
          : <button className="underline text-[var(--primary-2)]" onClick={setPassphrase}>{t('tfa.pass.add', 'Add a passphrase to encrypt the vault.')}</button>}</div>
      </div>

      {/* add controls */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Button variant="primary" onClick={() => setManualOpen((v) => !v)}><KeyRound size={15} /> {t('tfa.addmanual', 'Add by secret')}</Button>
        {scanning
          ? <Button className="!text-error" onClick={stopScan}><X size={15} /> {t('tfa.stopscan', 'Stop camera')}</Button>
          : <Button onClick={startScan}><Camera size={15} /> {t('tfa.scancam', 'Scan QR (camera)')}</Button>}
        <label className="btn cursor-pointer"><QrCode size={15} /> {t('tfa.scanimg', 'Scan QR image')}<input type="file" accept="image/*" className="hidden" onChange={(e) => { scanImage(e.target.files?.[0]); e.target.value = ''; }} /></label>
      </div>

      {scanning && (
        <Card className="p-3 mb-4">
          <video ref={videoRef} className="w-full max-h-72 rounded-lg bg-black object-contain" muted playsInline />
          <p className="text-xs text-[var(--faint)] mt-2 text-center">{t('tfa.point', 'Point the camera at a TOTP QR code.')}</p>
        </Card>
      )}

      {manualOpen && (
        <Card className="p-4 mb-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t('tfa.f.issuer', 'Issuer (e.g. GitHub)')}><Input value={mf.issuer} onChange={(e) => setMf({ ...mf, issuer: e.target.value })} placeholder="GitHub" /></Field>
            <Field label={t('tfa.f.label', 'Account (e.g. email)')}><Input value={mf.label} onChange={(e) => setMf({ ...mf, label: e.target.value })} placeholder="me@email.com" /></Field>
          </div>
          <Field label={t('tfa.f.secret', 'Secret key (Base32)')} hint={t('tfa.f.secret.h', 'The code shown as “setup key” / “can’t scan?” when enabling 2FA.')}><Input value={mf.secret} onChange={(e) => setMf({ ...mf, secret: e.target.value })} placeholder="JBSWY3DPEHPK3PXP" className="font-mono" /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('tfa.f.digits', 'Digits')}><Select value={mf.digits} onChange={(e) => setMf({ ...mf, digits: Number(e.target.value) })}>{[6, 7, 8].map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
            <Field label={t('tfa.f.period', 'Period (s)')}><Select value={mf.period} onChange={(e) => setMf({ ...mf, period: Number(e.target.value) })}>{[30, 60].map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
            <Field label={t('tfa.f.algo', 'Algorithm')}><Select value={mf.algorithm} onChange={(e) => setMf({ ...mf, algorithm: e.target.value })}>{['SHA1', 'SHA256', 'SHA512'].map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
          </div>
          <div className="flex justify-end"><Button variant="primary" onClick={submitManual}><Plus size={14} /> {t('tfa.add', 'Add')}</Button></div>
        </Card>
      )}

      {/* history */}
      {showHistory && (
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between mb-2"><span className="font-medium text-sm flex items-center gap-2"><HistoryIcon size={14} className="text-[var(--primary-2)]" /> {t('tfa.history.title', 'Copied-code history')}</span>
            {history.length > 0 && <Button size="sm" variant="ghost" className="!text-error" onClick={() => commit(accounts, [])}><Trash2 size={13} /> {t('tfa.history.clear', 'Clear')}</Button>}</div>
          {history.length ? <div className="max-h-64 overflow-auto divide-y divide-[var(--line)]">
            {history.map((h) => (
              <div key={h.id} className="flex items-center gap-3 py-1.5 text-sm">
                <span className="font-mono font-semibold tabular-nums">{h.code}</span>
                <span className="flex-1 min-w-0 truncate text-[var(--muted)]">{h.label}</span>
                <span className="text-[11px] text-[var(--faint)] shrink-0">{new Date(h.at).toLocaleString()}</span>
              </div>
            ))}
          </div> : <div className="text-xs text-[var(--faint)]">{t('tfa.history.none', 'No codes copied yet. Copying a code records it here.')}</div>}
        </Card>
      )}

      {/* accounts + live codes */}
      {accounts.length ? <div className="grid sm:grid-cols-2 gap-3">
        {accounts.map((a) => { const period = a.period || 30; const remaining = period - (Math.floor(now / 1000) % period); const pct = (remaining / period) * 100; const code = codes[a.id]; return (
          <Card key={a.id} className="p-4">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{a.issuer || a.label}</div>
                {a.issuer && a.label && <div className="text-xs text-[var(--faint)] truncate">{a.label}</div>}
              </div>
              <button onClick={() => del(a)} className="text-[var(--faint)] hover:text-error shrink-0" title={t('tfa.del.ok', 'Remove')}><Trash2 size={14} /></button>
            </div>
            <button onClick={() => copyCode(a)} className="mt-3 w-full flex items-center justify-between gap-3 group" title={t('tfa.copyhint', 'Click to copy')}>
              <span className="text-3xl font-bold font-mono tracking-widest tabular-nums text-[var(--text)] group-hover:text-[var(--primary-2)] transition">{code ? code.replace(/(\d{3})(\d+)/, '$1 $2') : '••••••'}</span>
              <span className="flex items-center gap-2 shrink-0">
                <span className={`text-xs tabular-nums flex items-center gap-1 ${remaining <= 5 ? 'text-error' : 'text-[var(--faint)]'}`}><Clock size={12} /> {remaining}s</span>
                <Copy size={14} className="text-[var(--faint)] group-hover:text-[var(--primary-2)]" />
              </span>
            </button>
            <div className="h-1 rounded-full bg-[var(--surface-2)] overflow-hidden mt-2"><div className={`h-full transition-all duration-1000 ease-linear ${remaining <= 5 ? 'bg-error' : 'bg-gradient-to-r from-brand to-brand-2'}`} style={{ width: `${pct}%` }} /></div>
            {/* Backup / recovery codes stored alongside this account. */}
            <details className="mt-2.5 group/bk">
              <summary className="text-[11px] text-[var(--faint)] hover:text-[var(--text)] cursor-pointer flex items-center gap-1.5 select-none list-none"><KeyIcon size={11} /> {t('tfa.bk.title', 'Backup codes')} {(a.backupCodes?.length || 0) > 0 && <span className="text-[var(--primary-2)]">({a.backupCodes.length})</span>}</summary>
              <div className="mt-1.5">
                {(a.backupCodes?.length || 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {a.backupCodes.map((bc) => (
                      <span key={bc} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[11px] font-mono">
                        <button type="button" onClick={() => { navigator.clipboard?.writeText(bc); toast.success(t('tfa.copied', 'Code copied.')); }} className="hover:text-[var(--primary-2)]">{bc}</button>
                        <button type="button" onClick={() => removeBackupCode(a, bc)} className="text-[var(--faint)] hover:text-error"><X size={9} /></button>
                      </span>
                    ))}
                  </div>
                )}
                <button type="button" onClick={() => addBackupCodes(a)} className="text-[11px] text-[var(--primary-2)] hover:underline flex items-center gap-1"><Plus size={11} /> {t('tfa.bk.add', 'Add backup codes')}</button>
              </div>
            </details>
          </Card>
        ); })}
      </div> : <EmptyState icon={KeyRound} title={t('tfa.empty.t', 'No accounts yet')} sub={t('tfa.empty.s', 'Add one by scanning a QR code or entering a setup key. Everything stays on this device.')} />}
    </div>
  );
}
