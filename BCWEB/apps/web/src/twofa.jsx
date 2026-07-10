// A fully-LOCAL TOTP authenticator (RFC 6238). Nothing here ever touches the
// network: secrets are generated/entered on the device, codes are computed with
// the Web Crypto API, and the vault is stored in localStorage — optionally
// encrypted at rest with a passphrase (AES-GCM + PBKDF2) so a leaked disk / shared
// browser profile doesn't expose the seeds (CWE-312). QR import uses the native
// BarcodeDetector (no upload, no third-party lib).
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { ShieldCheck, KeyRound, QrCode, Camera, Download, Upload, Plus, Trash2, Copy, Lock, Unlock, History as HistoryIcon, X, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useI18n } from './i18n.jsx';
import { Card, Button, Input, Select, Field, Badge, useToast, useDialog, PageHeader, EmptyState } from './ui.jsx';

const LS_KEY = 'bcw_2fa_vault';
const A2H = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };

// ── Base32 (RFC 4648, no padding required) ──
function base32Decode(input) {
  const alph = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(input || '').toUpperCase().replace(/=+$/,'').replace(/\s+/g,'');
  if (!clean) throw new Error('empty');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const idx = alph.indexOf(ch);
    if (idx === -1) throw new Error('bad base32');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

// ── TOTP code for a given time ──
async function totp(secretB32, { digits = 6, period = 30, algorithm = 'SHA1' } = {}, at = Date.now()) {
  const key = base32Decode(secretB32);
  const counter = Math.floor(at / 1000 / period);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c = Math.floor(c / 256); }
  const ck = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: { name: A2H[algorithm] || 'SHA-1' } }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', ck, msg));
  const off = sig[sig.length - 1] & 0x0f;
  const bin = ((sig[off] & 0x7f) << 24) | ((sig[off + 1] & 0xff) << 16) | ((sig[off + 2] & 0xff) << 8) | (sig[off + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

// ── otpauth://totp/Issuer:Label?secret=…&issuer=…&digits=…&period=…&algorithm=… ──
function parseOtpauth(uri) {
  const u = new URL(uri);
  if (u.protocol !== 'otpauth:') throw new Error('not otpauth');
  if (u.host !== 'totp') throw new Error('only TOTP is supported');
  const path = decodeURIComponent(u.pathname.replace(/^\//, ''));
  const [maybeIssuer, maybeLabel] = path.includes(':') ? path.split(/:(.+)/) : [null, path];
  const q = u.searchParams;
  const secret = (q.get('secret') || '').replace(/\s+/g, '');
  if (!secret) throw new Error('missing secret');
  base32Decode(secret); // validate now so a bad QR is rejected up front
  return {
    issuer: q.get('issuer') || maybeIssuer || '',
    label: (maybeLabel || maybeIssuer || 'Account').trim(),
    secret,
    digits: Math.min(8, Math.max(6, Number(q.get('digits')) || 6)),
    period: Math.min(120, Math.max(15, Number(q.get('period')) || 30)),
    algorithm: (q.get('algorithm') || 'SHA1').toUpperCase() in A2H ? (q.get('algorithm') || 'SHA1').toUpperCase() : 'SHA1',
  };
}

// ── base64 helpers for the encrypted blob ──
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(pass, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encryptVault(obj, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
  return { v: 1, enc: true, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
async function decryptVault(blob, pass) {
  const key = await deriveKey(pass, unb64(blob.salt));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

const rid = () => Math.random().toString(36).slice(2, 10);

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

  // ── Load once ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed.enc) { setEncrypted(true); setLocked(true); }
      else { setAccounts(parsed.accounts || []); setHistory(parsed.history || []); }
    } catch { /* corrupt vault — start fresh */ }
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
    const acct = { id: rid(), label: a.label || 'Account', issuer: a.issuer || '', secret: a.secret, digits: a.digits || 6, period: a.period || 30, algorithm: a.algorithm || 'SHA1', addedAt: Date.now() };
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
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ type: 'bcw-2fa-export', version: 1, exportedAt: new Date().toISOString(), accounts, history }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `bcw-2fa-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href);
    toast.success(t('tfa.exported', 'Exported — keep this file somewhere safe; it contains your secrets.'));
  };
  const importJson = async (file) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = (parsed.accounts || []).filter((a) => a.secret);
      if (!incoming.length) return toast.error(t('tfa.noimport', 'No accounts found in that file.'));
      const have = new Set(accounts.map((a) => a.secret));
      const merged = [...accounts, ...incoming.filter((a) => !have.has(a.secret)).map((a) => ({ ...a, id: rid(), addedAt: a.addedAt || Date.now() }))];
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
      passRef.current = unlockPass; setAccounts(data.accounts || []); setHistory(data.history || []); setLocked(false); setUnlockPass('');
    } catch { toast.error(t('tfa.wrongpass', 'Wrong passphrase.')); }
  };

  // ── Locked screen ──
  if (locked) return (
    <div className="max-w-md mx-auto">
      <PageHeader icon={Lock} title={t('tfa.title', 'Authenticator (2FA)')} subtitle={t('tfa.locked.sub', 'This vault is encrypted. Enter your passphrase to unlock.')} />
      <Card className="p-5 space-y-3">
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
        <ShieldCheck size={15} className="text-emerald-400 shrink-0 mt-0.5" />
        <div>{t('tfa.note', 'Secrets never leave this browser — codes are computed locally with the Web Crypto API and stored only in this device’s local storage.')} {encrypted
          ? <span className="text-emerald-400">{t('tfa.note.enc', 'Encrypted at rest.')} <button className="underline" onClick={removePassphrase}>{t('tfa.pass.remove', 'remove')}</button> · <button className="underline" onClick={lockNow}>{t('tfa.lock', 'lock now')}</button></span>
          : <button className="underline text-[var(--primary-2)]" onClick={setPassphrase}>{t('tfa.pass.add', 'Add a passphrase to encrypt the vault.')}</button>}</div>
      </div>

      {/* add controls */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Button variant="primary" onClick={() => setManualOpen((v) => !v)}><KeyRound size={15} /> {t('tfa.addmanual', 'Add by secret')}</Button>
        {scanning
          ? <Button className="!text-red-400" onClick={stopScan}><X size={15} /> {t('tfa.stopscan', 'Stop camera')}</Button>
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
            {history.length > 0 && <Button size="sm" variant="ghost" className="!text-red-400" onClick={() => commit(accounts, [])}><Trash2 size={13} /> {t('tfa.history.clear', 'Clear')}</Button>}</div>
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
              <button onClick={() => del(a)} className="text-[var(--faint)] hover:text-red-400 shrink-0" title={t('tfa.del.ok', 'Remove')}><Trash2 size={14} /></button>
            </div>
            <button onClick={() => copyCode(a)} className="mt-3 w-full flex items-center justify-between gap-3 group" title={t('tfa.copyhint', 'Click to copy')}>
              <span className="text-3xl font-bold font-mono tracking-widest tabular-nums text-[var(--text)] group-hover:text-[var(--primary-2)] transition">{code ? code.replace(/(\d{3})(\d+)/, '$1 $2') : '••••••'}</span>
              <span className="flex items-center gap-2 shrink-0">
                <span className={`text-xs tabular-nums flex items-center gap-1 ${remaining <= 5 ? 'text-red-400' : 'text-[var(--faint)]'}`}><Clock size={12} /> {remaining}s</span>
                <Copy size={14} className="text-[var(--faint)] group-hover:text-[var(--primary-2)]" />
              </span>
            </button>
            <div className="h-1 rounded-full bg-[var(--surface-2)] overflow-hidden mt-2"><div className={`h-full transition-all duration-1000 ease-linear ${remaining <= 5 ? 'bg-red-500' : 'bg-gradient-to-r from-orange-500 to-amber-500'}`} style={{ width: `${pct}%` }} /></div>
          </Card>
        ); })}
      </div> : <EmptyState icon={KeyRound} title={t('tfa.empty.t', 'No accounts yet')} sub={t('tfa.empty.s', 'Add one by scanning a QR code or entering a setup key. Everything stays on this device.')} />}
    </div>
  );
}
