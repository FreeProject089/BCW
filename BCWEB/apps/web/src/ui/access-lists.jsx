import { useState } from 'react';
import { KeyRound, Plus, Search, Users, X } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { api } from '../lib/api.js';
import { Button, Input, Spinner } from './ui.jsx';

// The access-list editors, shared by every screen that edits an access list: the repo
// dashboard and the catalog owner panel.
//
// They used to live inside the repo dashboard, where only repos could reach them. Copying
// them for catalogs would have made a second version of a rule that has to stay one — the
// server-side twin of this same list had already drifted that way, which is what prompted
// moving these here instead.

export function ChipList({ label, items, onAdd, onRemove, placeholder }) {
  const [v, setV] = useState('');
  const add = () => { const x = v.trim(); if (x) { onAdd(x); setV(''); } };
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{label}</div>
      <div className="flex gap-2"><Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} onKeyDown={(e) => e.key === 'Enter' && add()} /><Button size="sm" onClick={add}><Plus size={14} /></Button></div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {items.length ? items.map((x) => (
          <span key={x} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-xs">{x}<button onClick={() => onRemove(x)} className="text-[var(--faint)] hover:text-error"><X size={12} /></button></span>
        )) : <span className="text-xs text-[var(--faint)]">{'—'}</span>}
      </div>
    </div>
  );
}

// Whitelist/ban entries that identify an account (BetterCommunity or Discord) rather
// than an IP/key. Search resolves via /accounts/search (creator id / Discord id or
// username / display name) — a repo owner can add either identity from one result.
export function AccountChipList({ label, items, onAdd, onRemove, placeholder }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const search = async () => {
    if (q.trim().length < 2) return setResults(null);
    setBusy(true);
    try { const { accounts } = await api.get(`/accounts/search?q=${encodeURIComponent(q.trim())}`); setResults(accounts); }
    catch { setResults([]); } finally { setBusy(false); }
  };
  const has = (type, id) => items.some((a) => a.type === type && a.id === id);
  const add = (entry) => { if (!has(entry.type, entry.id)) onAdd(entry); };
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{label}</div>
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <Button size="sm" onClick={search}>{busy ? <Spinner /> : <Search size={14} />}</Button>
      </div>
      {results && (
        <div className="mt-2 space-y-1">
          {results.length ? results.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-xs">
              <span className="truncate">{u.displayName}{u.discord && <span className="text-[var(--faint)]"> · Discord: {u.discord.username || u.discord.id}</span>}</span>
              <span className="flex gap-1 shrink-0">
                <button onClick={() => add({ type: 'bcweb', id: u.id, label: u.displayName })} className="px-1.5 py-0.5 rounded border border-[var(--line)] hover:text-[var(--primary-2)] hover:border-[var(--primary-2)]">+ BC</button>
                {u.discord && <button onClick={() => add({ type: 'discord', id: u.discord.id, label: u.discord.username || u.discord.id })} className="px-1.5 py-0.5 rounded border border-[var(--line)] hover:text-[var(--primary-2)] hover:border-[var(--primary-2)]">+ Discord</button>}
              </span>
            </div>
          )) : <div className="text-xs text-[var(--faint)] px-1">{t('repos.acct.none', 'No accounts found.')}</div>}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {items.length ? items.map((a) => (
          <span key={`${a.type}:${a.id}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-xs">
            <Users size={10} className="text-[var(--faint)]" /> {a.type === 'discord' ? 'Discord: ' : ''}{a.label || a.id}
            <button onClick={() => onRemove(a)} className="text-[var(--faint)] hover:text-error"><X size={12} /></button>
          </span>
        )) : <span className="text-xs text-[var(--faint)]">{'—'}</span>}
      </div>
    </div>
  );
}

/** `ssh-ed25519 AAAA…` → the base64 blob and the trailing comment, or null. */
// Every algorithm BMM can prove with. ssh-dss is absent because OpenSSH removed it and
// nothing on either side verifies it — accepting it here would store a requirement no client
// could ever satisfy.
const KEY_TYPES = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521))$/;

function splitKey(line) {
  const parts = String(line || '').trim().split(/\s+/);
  if (!KEY_TYPES.test(parts[0] || '') || !parts[1]) return null;
  return { blob: parts[1], comment: parts.slice(2).join(' ') };
}

/**
 * A short, recognisable label for one key.
 *
 * The whole line is ~80 characters of base64, and a wall of those is unreadable — worse, an
 * unbreakable 80-character token in a flex row is exactly what blows a mobile layout out
 * sideways. What a person actually recognises is the comment they put on the key and its last
 * few characters, which is what `ssh-add -l` shows too.
 */
function keyLabel(line) {
  const k = splitKey(line);
  if (!k) return line;
  const tail = k.blob.slice(-12);
  return k.comment ? `${k.comment} · …${tail}` : `…${tail}`;
}

export function PubkeyList({ items, onAdd, onRemove }) {
  const { t } = useI18n();
  const [v, setV] = useState('');
  const [err, setErr] = useState('');

  const add = () => {
    const line = v.trim();
    if (!line) return;
    // The server refuses a non-ed25519 key too — but it refuses it after a round trip, on a
    // form the person may already have navigated away from. Saying it here is the difference
    // between a correction and a mystery. (Only ed25519 is verifiable; storing anything else
    // would be storing a requirement nothing could ever satisfy.)
    if (!splitKey(line)) {
      setErr(/^ssh-dss/.test(line)
        ? t('acck.wrongtype', 'DSA keys are not supported — OpenSSH removed them. Use ed25519, RSA or ECDSA.')
        : t('acck.malformed', 'That does not look like an OpenSSH public key line (ssh-ed25519 / ssh-rsa / ecdsa-sha2-… AAAA… comment).'));
      return;
    }
    setErr(''); setV(''); onAdd(line);
  };

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">
        {t('acck.label', 'Authorised public keys')}
      </div>
      <div className="text-xs text-[var(--muted)] mb-1.5">
        {t('acck.hint', 'Paste the contents of a .pub file — ed25519, RSA or ECDSA. Unlike the lists above, a key cannot be claimed: the client has to prove it holds the private half.')}
      </div>
      <div className="flex gap-2">
        <Input
          value={v}
          onChange={(e) => { setV(e.target.value); if (err) setErr(''); }}
          placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5… you@machine"
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <Button size="sm" onClick={add}><Plus size={14} /></Button>
      </div>
      {err && <div className="text-xs text-error mt-1.5">{err}</div>}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {(items || []).length ? items.map((x) => (
          // min-w-0 + break-all: without them one unbreakable base64 run stretches the row
          // past the viewport and takes the whole card with it.
          <span key={x} title={x} className="inline-flex items-center gap-1 min-w-0 max-w-full px-2 py-1 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-xs">
            <KeyRound size={12} className="shrink-0 text-[var(--primary-2)]" />
            <span className="truncate break-all">{keyLabel(x)}</span>
            <button onClick={() => onRemove(x)} className="shrink-0 text-[var(--faint)] hover:text-error"><X size={12} /></button>
          </span>
        )) : <span className="text-xs text-[var(--faint)]">{'—'}</span>}
      </div>
    </div>
  );
}
