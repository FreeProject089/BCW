// Admin → Accounts → Creator IDs: read a BMM creator id or proof (v4 or v5) and see what the
// platform knows about it.
//
// Reads routes/admin-fingerprint.mjs. Reading is manage_users (moderators hold it by default);
// the ban rows appear only when the server says the reader also holds manage_sanctions, and
// resetting a key pin is manage_sanctions. Every lookup is written to the audit log by the
// server, which is why there is no "search as you type" here: one lookup, one audit line.
//
// Fingerprints are shown as what they are: salted hashes BMM computed for THIS server (see
// src-tauri/src/commands/creator_v5.rs in BMM). None of them is a serial number, and none can
// be matched with another service. What they answer is "is this machine stable" and "which
// other ids share it".
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Fingerprint, Search, KeyRound, ShieldAlert, User as UserIcon, CheckCircle2, XCircle, RotateCcw, Link2 } from 'lucide-react';
import { Card, Badge, Button, Input, Spinner, EmptyState, Explain, useToast, copyText } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';

const COMPONENTS = ['board', 'os', 'disk', 'canvas'];

function when(d) { return d ? new Date(d).toLocaleString() : '-'; }

function Check({ ok, label }) {
  const I = ok ? CheckCircle2 : XCircle;
  return <Badge tone={ok ? 'green' : 'red'} className="shrink-0"><I size={10} /> {label}</Badge>;
}

function Row({ label, children }) {
  return (
    <div className="flex gap-3 text-sm py-1.5 min-w-0">
      <div className="w-36 shrink-0 text-[var(--muted)]">{label}</div>
      <div className="min-w-0 flex-1 break-all">{children}</div>
    </div>
  );
}

function TokenCard({ token, t }) {
  if (token.kind === 'id') {
    return <Card className="p-4 text-sm text-[var(--muted)]">{t('afp.bareid', 'A bare creator id: nothing to verify on its own. The history below is what the platform has seen for it.')}</Card>;
  }
  const c = token.checks || {};
  return (
    <Card className="p-4 space-y-2" data-afp-token>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge tone="blue">{t('afp.proofv', 'Proof v{v}').replace('{v}', token.version)}</Badge>
        <Check ok={c.signature} label={t('afp.c.signature', 'signature')} />
        {token.version === 5 && <Check ok={c.chain} label={t('afp.c.chain', 'key chain')} />}
        {token.version === 5 && <Check ok={c.nonce} label={t('afp.c.nonce', 'nonce')} />}
        <Check ok={c.audience} label={t('afp.c.audience', 'this server')} />
        <Check ok={c.unexpired} label={t('afp.c.unexpired', 'not expired')} />
      </div>
      {token.kid && token.kid !== token.cid && <Row label={t('afp.kid', 'Signing key')}><code className="font-mono text-xs">{token.kid}</code> <span className="text-xs text-[var(--faint)]">({t('afp.seq', 'rotation {n}').replace('{n}', token.seq)})</span></Row>}
      {token.chainError && <Row label={t('afp.chainerr', 'Chain error')}><code className="font-mono text-xs">{token.chainError}</code></Row>}
      {token.exp && <Row label={t('afp.exp', 'Expires')}>{when(token.exp * 1000)}</Row>}
      {!!Object.keys(token.fp || {}).length && (
        <Row label={t('afp.fpin', 'Fingerprint in it')}>
          <div className="space-y-0.5">{COMPONENTS.filter((k) => token.fp[k]).map((k) => <div key={k} className="text-xs"><span className="text-[var(--muted)]">{k}</span> <code className="font-mono">{token.fp[k]}</code></div>)}</div>
        </Row>
      )}
    </Card>
  );
}

function Bans({ bans, t }) {
  if (!bans) return null;
  return (
    <div className="flex gap-1.5 flex-wrap">
      {bans.site ? <Badge tone="red"><ShieldAlert size={10} /> {t('afp.ban.site', 'site ban')}{bans.site.until ? ` (${t('afp.until', 'until')} ${when(bans.site.until)})` : ''}</Badge> : null}
      {bans.repos ? <Badge tone="red"><ShieldAlert size={10} /> {t('afp.ban.repos', 'repo ban')}</Badge> : null}
      {!bans.site && !bans.repos ? <Badge tone="green">{t('afp.ban.none', 'not banned')}</Badge> : null}
    </div>
  );
}

export function AdminFingerprint() {
  const { t } = useI18n(); const toast = useToast();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');

  const lookup = async (value) => {
    const v = String(value || '').trim();
    if (!v) return;
    setBusy(true); setErr('');
    try { setRes(await api.post('/admin/users/creator-lookup', { q: v })); }
    catch (e) { setRes(null); setErr(e?.data?.error || e?.message || 'failed'); }
    finally { setBusy(false); }
  };

  const resetPin = (cid) => {
    const before = res;
    setRes({ ...res, analysis: { ...res.analysis, version: null, key: null } });
    toast.action({
      tone: 'info', msg: t('afp.pinreset', 'Key pin reset. The next v5 proof for this id sets a new one.'),
      onCommit: () => api.del(`/admin/security/creator-pin/${cid}`).catch(() => { setRes(before); toast.error(t('common.failed', 'Failed.')); }),
      onCancel: () => setRes(before),
    });
  };

  const a = res?.analysis;
  return (
    <div className="space-y-4" data-admin-fingerprint>
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold"><Fingerprint size={16} /> {t('afp.title', 'Creator IDs')}</div>
        <Explain summary={t('afp.explain', 'Paste a creator id or a creator proof (v4 or v5).')}>
          {t('afp.explain.more', 'A proof is decoded and each check is shown on its own. The fingerprints are salted hashes made by BMM for this server only: they identify no serial number and cannot be matched elsewhere. Each lookup is written to the audit log.')}
        </Explain>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); lookup(q); }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('afp.placeholder', 'Creator id (64 hex) or bmmc1… / bmmc5… proof')} aria-label={t('afp.placeholder', 'Creator id (64 hex) or bmmc1… / bmmc5… proof')} />
          <Button type="submit" disabled={busy || !q.trim()} aria-label={t('afp.lookup', 'Look up')}><Search size={14} /> {t('afp.lookup', 'Look up')}</Button>
        </form>
        {err && <div className="text-sm text-error">{err === 'not_a_creator_id_or_proof' ? t('afp.notid', 'That is neither a creator id nor a creator proof.') : t('afp.failed', 'Lookup failed: {e}').replace('{e}', err)}</div>}
      </Card>

      {busy && <Spinner />}
      {!busy && !res && !err && <EmptyState icon={Fingerprint} title={t('afp.empty', 'Nothing looked up yet')} sub={t('afp.empty.s', 'Creator ids appear in reports, repo access logs and the ban list.')} />}

      {!busy && res && (
        <>
          <TokenCard token={res.token} t={t} />
          <Card className="p-4 space-y-1">
            <Row label={t('afp.cid', 'Creator ID')}>
              <code className="font-mono text-xs">{a.cid}</code>{' '}
              <Button size="sm" variant="ghost" onClick={() => { copyText(a.cid); toast.success(t('common.copied', 'Copied.')); }}>{t('common.copy', 'Copy')}</Button>
            </Row>
            <Row label={t('afp.version', 'Key version')}>
              {a.version === 5
                ? <span className="inline-flex items-center gap-2 flex-wrap"><Badge tone="green"><KeyRound size={10} /> v5</Badge> <span className="text-xs text-[var(--muted)]">{t('afp.pinned', 'pinned to key {k}, rotation {n}').replace('{k}', `${a.key.kid.slice(0, 16)}…`).replace('{n}', a.key.seq)}</span>
                  {res.canSeeBans && <Button size="sm" variant="ghost" onClick={() => resetPin(a.cid)}><RotateCcw size={12} /> {t('afp.reset', 'Reset pin')}</Button>}</span>
                : <Badge>{t('afp.v4', 'v4 (no v5 key seen)')}</Badge>}
            </Row>
            <Row label={t('afp.first', 'First seen')}>{when(a.firstSeen)}</Row>
            <Row label={t('afp.last', 'Last seen')}>{when(a.lastSeen)}</Row>
            <Row label={t('afp.account', 'Linked account')}>
              {a.account
                ? <Link to={`/u/${a.account.id}`} className="text-[var(--accent-ink)] hover:underline inline-flex items-center gap-1"><UserIcon size={12} /> {a.account.displayName}</Link>
                : <span className="text-[var(--muted)]">{t('afp.noaccount', 'not linked')}</span>}
              {a.account?.status && a.account.status !== 'active' && <Badge tone="red" className="ml-2">{a.account.status}</Badge>}
            </Row>
            <Row label={t('afp.claims', 'Free-tier claims')}>{a.claims.length ? a.claims.map((c) => `${c.kind} (${when(c.createdAt)})`).join(', ') : '-'}</Row>
            {res.canSeeBans && <Row label={t('afp.bans', 'Bans')}><Bans bans={a.bans} t={t} /></Row>}
          </Card>

          <Card className="p-4 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-sm"><Fingerprint size={14} /> {t('afp.history', 'Fingerprint history')}
              {a.stability.overall != null && <Badge tone={a.stability.overall >= 0.8 ? 'green' : a.stability.overall >= 0.5 ? 'amber' : 'red'}>{t('afp.stability', 'stability {s}').replace('{s}', `${Math.round(a.stability.overall * 100)}%`)}</Badge>}
            </div>
            {!a.fingerprints.length
              ? <div className="text-sm text-[var(--muted)]">{t('afp.nofp', 'No v5 proof carried a fingerprint for this id yet.')}</div>
              : (
                <div className="divide-y divide-[var(--line)]">
                  {a.fingerprints.map((f) => (
                    <div key={`${f.component}-${f.hash}`} className="flex gap-3 py-1.5 text-xs flex-wrap">
                      <span className="w-14 text-[var(--muted)]">{f.component}</span>
                      <code className="font-mono">{f.hash}</code>
                      <span className="text-[var(--faint)]">×{f.count}</span>
                      <span className="text-[var(--faint)]">{when(f.firstSeenAt)} → {when(f.lastSeenAt)}</span>
                    </div>
                  ))}
                </div>
              )}
          </Card>

          <Card className="p-4 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-sm"><Link2 size={14} /> {t('afp.similar', 'Other ids sharing a component')}</div>
            {!a.similar.length
              ? <div className="text-sm text-[var(--muted)]">{t('afp.nosimilar', 'None. No other creator id presented one of these hashes.')}</div>
              : (
                <div className="divide-y divide-[var(--line)]">
                  {a.similar.map((s) => (
                    <div key={s.creatorId} className="py-2 flex items-center gap-2 flex-wrap text-xs">
                      <button type="button" className="font-mono text-[var(--accent-ink)] hover:underline" onClick={() => { setQ(s.creatorId); lookup(s.creatorId); }}>{s.creatorId.slice(0, 24)}…</button>
                      {s.components.map((c) => <Badge key={c} tone={c === 'board' || c === 'os' ? 'amber' : ''}>{c}</Badge>)}
                      {s.account && <Link to={`/u/${s.account.id}`} className="inline-flex items-center gap-1 hover:underline"><UserIcon size={11} /> {s.account.displayName}</Link>}
                      {res.canSeeBans && <Bans bans={s.bans} t={t} />}
                    </div>
                  ))}
                </div>
              )}
            <div className="text-[11px] text-[var(--faint)]">{t('afp.similar.note', 'A shared board or OS hash is a strong signal; a shared canvas alone is weak (same GPU and driver). It is a lead for a person to check, never a verdict.')}</div>
          </Card>
        </>
      )}
    </div>
  );
}
