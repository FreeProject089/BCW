// /report — the notice form: a rights claim or an illegal-content report, precise enough to
// act on, from anyone, with or without an account.
//
// It asks for exactly what the legal page says a notice needs (DSA Art. 16, LCEN 6-I-5, Swiss
// CopA): WHERE — a target on this service, down to the file inside a repo or the item inside a
// catalogue; WHY; for a rights claim WHICH WORK and on what basis; WHO; and the two statements.
// Each element is a section, not a wizard step: a sender who has a link and a sentence should
// see the whole of what is being asked before they start, and a wizard hides that.
//
// Targets are RESOLVED as they are pasted (`/rights/resolve`), so "somewhere in this repo"
// becomes a list of its files with checkboxes. That precision is what lets staff take down two
// archives instead of a whole repository of forty.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Scale, Plus, X, Search, CheckCircle2, Loader2, FileText, Boxes, User as UserIcon, Link2, Shield } from 'lucide-react';
import { Button, Card, Field, Input, Textarea, Select, Badge, useToast } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from './auth.jsx';
import { useI18n } from '../i18n.jsx';
import { useDraft, DraftBanner } from '../ui/drafts.jsx';

const KINDS = [
  ['copyright', 'rn.k.copyright', 'Copyright, my work is here without permission'],
  ['trademark', 'rn.k.trademark', 'Trademark or impersonation'],
  ['privacy', 'rn.k.privacy', 'Privacy, my personal data or likeness'],
  ['illegal', 'rn.k.illegal', 'Illegal or harmful content'],
  ['other', 'rn.k.other', 'Another right'],
];
const BASIS = [['owner', 'rn.b.owner', 'I own the rights'], ['licensee', 'rn.b.licensee', 'I hold an exclusive licence'], ['agent', 'rn.b.agent', 'I act for the rights holder']];
const TYPE_ICON = { repo: Boxes, catalog: FileText, item: FileText, user: UserIcon, url: Link2 };

/** One target: what was resolved, and the files/items inside it the sender ticks. */
function TargetCard({ t, target, onChange, onRemove }) {
  const Icon = TYPE_ICON[target.type] || Link2;
  const [q, setQ] = useState('');
  const files = target.resolved?.files || [];
  const items = target.resolved?.items || [];
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = files.length ? files.map((f) => ({ key: f.path, label: f.path, sub: f.size ? `${(f.size / 1024).toFixed(0)} KB` : '' })) : items.map((i) => ({ key: i.id, label: i.name, sub: i.slug || '' }));
    return needle ? list.filter((x) => x.label.toLowerCase().includes(needle)) : list;
  }, [files, items, q]);
  const picked = new Set(target.files || []);
  const toggle = (key) => { const next = new Set(picked); if (next.has(key)) next.delete(key); else next.add(key); onChange({ ...target, files: [...next] }); };
  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-start gap-2">
        <span className="grid place-items-center w-8 h-8 rounded-lg bg-[var(--surface-2)] shrink-0"><Icon size={15} className="text-[var(--accent-ink)]" /></span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate" title={target.label || target.url}>{target.label || target.url}</div>
          <div className="text-[11px] text-[var(--faint)] truncate">{t(`rn.t.${target.type}`, target.type)}{target.url ? ` · ${target.url}` : ''}</div>
        </div>
        <button type="button" onClick={onRemove} className="p-1 rounded hover:bg-[var(--surface-2)]" aria-label={t('common.remove', 'Remove')}><X size={14} /></button>
      </div>
      {(files.length > 0 || items.length > 0) && (
        <div className="rounded-lg border border-[var(--line)] overflow-hidden">
          <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--line)] panel">
            <Search size={12} className="text-[var(--faint)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={files.length ? t('rn.filterfiles', 'Filter files…') : t('rn.filteritems', 'Filter items…')} className="flex-1 bg-transparent text-xs outline-none" />
            <span className="text-[11px] text-[var(--faint)] tabular-nums">{picked.size ? t('rn.picked', '{n} selected').replace('{n}', picked.size) : t('rn.pickhint', 'tick the ones concerned, none = the whole thing')}</span>
          </div>
          <div className="max-h-48 overflow-auto">
            {shown.slice(0, 300).map((x) => (
              <label key={x.key} className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-[var(--surface-2)]">
                <input type="checkbox" checked={picked.has(x.key)} onChange={() => toggle(x.key)} />
                <span className="flex-1 min-w-0 truncate font-mono" title={x.label}>{x.label}</span>
                {x.sub && <span className="text-[var(--faint)] tabular-nums">{x.sub}</span>}
              </label>
            ))}
            {!shown.length && <div className="px-2 py-3 text-xs text-[var(--faint)]">{t('rn.nomatch', 'Nothing matches.')}</div>}
          </div>
        </div>
      )}
      <Input value={target.note || ''} onChange={(e) => onChange({ ...target, note: e.target.value })} placeholder={t('rn.tnote', 'Anything specific about this one (a version, a page, a timestamp)…')} />
    </Card>
  );
}

function Lookup({ t, initialCode }) {
  const [code, setCode] = useState(initialCode || '');
  const [email, setEmail] = useState('');
  const [state, setState] = useState(null);
  const go = async (e) => {
    e.preventDefault();
    setState({ loading: true });
    try { const r = await api.get(`/rights/notice/${encodeURIComponent(code.trim().toUpperCase())}?email=${encodeURIComponent(email.trim())}`); setState({ notice: r.notice }); }
    catch { setState({ error: true }); }
  };
  const n = state?.notice;
  return (
    <Card className="p-4 space-y-3">
      <div className="font-semibold flex items-center gap-2"><Search size={15} className="text-[var(--accent-ink)]" /> {t('rn.lookup', 'Follow a notice')}</div>
      <form onSubmit={go} className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <Field label={t('rn.code', 'Reference')}><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="NTC-XXXX-XXXX" /></Field>
        <Field label={t('rn.email', 'E-mail it was filed with')}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Button type="submit" variant="primary" disabled={!code || !email || state?.loading}>{state?.loading ? <Loader2 size={14} className="animate-spin" /> : t('rn.lookup.go', 'Look up')}</Button>
      </form>
      {state?.error && <p className="text-sm text-error">{t('rn.lookup.none', 'No notice with that reference and e-mail.')}</p>}
      {n && (
        <div className="text-sm space-y-1">
          <div className="flex items-center gap-2"><span className="font-mono">{n.code}</span> <Badge>{t(`rn.s.${n.status}`, n.status)}</Badge> <span className="text-[var(--faint)]">{new Date(n.createdAt).toLocaleDateString()}</span></div>
          {n.decision && <p className="text-[var(--muted)] whitespace-pre-wrap">{n.decision}</p>}
          {n.counter && <p className="text-[var(--muted)]">{t('rn.lookup.counter', 'A counter-notice was received on {d}.').replace('{d}', new Date(n.counter.at).toLocaleDateString())}</p>}
        </div>
      )}
    </Card>
  );
}

export function ReportPage() {
  const { t } = useI18n(); const toast = useToast(); const { user } = useAuth();
  const [params] = useSearchParams();
  const [targets, setTargets] = useState([]);
  const [paste, setPaste] = useState('');
  const [resolving, setResolving] = useState(false);
  const [kind, setKind] = useState('copyright');
  const [explanation, setExplanation] = useState('');
  const [work, setWork] = useState({ title: '', urls: '', basis: 'owner', basisText: '', hashes: '' });
  const [who, setWho] = useState({ name: '', email: '', org: '', country: '', address: '', phone: '' });
  const [stmt, setStmt] = useState({ goodFaith: false, accurate: false, signature: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => { if (user) setWho((w) => ({ ...w, name: w.name || user.displayName || '', email: w.email || user.email || '' })); }, [user]);

  const resolve = async (q, fallback) => {
    setResolving(true);
    try {
      const r = await api.get(`/rights/resolve?q=${encodeURIComponent(q)}`);
      return { ...r.target, resolved: r.target, files: [] };
    } catch {
      if (fallback) return { ...fallback, files: [] };
      toast.error(t('rn.noresolve', 'That does not point at anything on this site. Paste a link to a repo, a catalogue, an item or a profile.'));
      return null;
    } finally { setResolving(false); }
  };
  // Arrived from a Report button: the target is already known. Or from the contact triage,
  // which asks "where is it?" as its second question and sends the answer as `q` — a raw
  // address, resolved here exactly as a pasted one, so nobody is asked the same question
  // twice. `kind` comes with it so the claim starts on the right one.
  useEffect(() => {
    const k = params.get('kind');
    if (k && KINDS.some(([v]) => v === k)) setKind(k);
    const q = params.get('q');
    if (q) {
      resolve(q, { type: 'url', id: '', label: q, url: q })
        .then((tg) => { if (tg) setTargets((l) => (l.some((x) => x.type === tg.type && (x.id || x.url) === (tg.id || tg.url)) ? l : [...l, tg])); });
    }
    const type = params.get('type'), id = params.get('id');
    if (!type || !id) return;
    const path = type === 'repo' ? `/r/${id}` : type === 'catalog' ? `/c/${id}` : type === 'item' ? `/item/${id}` : type === 'user' ? `/u/${id}` : id;
    resolve(path, { type, id, label: params.get('label') || '', url: '' }).then((tg) => { if (tg) setTargets((l) => (l.some((x) => x.type === tg.type && x.id === tg.id) ? l : [...l, tg])); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const addPasted = async () => {
    const q = paste.trim(); if (!q) return;
    const tg = await resolve(q);
    if (!tg) return;
    setTargets((l) => (l.some((x) => x.type === tg.type && (x.id || x.url) === (tg.id || tg.url)) ? l : [...l, tg]));
    setPaste('');
  };

  // A kept draft (ui/drafts.jsx). The longest form on the site — five sections, about twenty
  // fields, and a sender who is often not signed in, so there is no server-side half-finished
  // copy of it anywhere. Losing it means writing the whole notice again.
  //
  // `stmt` is deliberately NOT in the draft. Those two ticks and that signature are a sworn
  // statement about the notice as it stands, and restoring them from a cache would have the
  // form affirm, on somebody's behalf, something they had not read this time round. They are
  // four seconds to redo and the only part of this form where that matters.
  const [draftReady, setDraftReady] = useState(false);
  useEffect(() => { setDraftReady(true); }, []);
  const draftValue = useMemo(() => ({ targets, kind, explanation, work, who }), [targets, kind, explanation, work, who]);
  const draft = useDraft({
    scope: 'rights-notice', id: null, value: draftValue, ready: draftReady,
    onRestore: (v) => {
      setTargets(Array.isArray(v.targets) ? v.targets : []);
      if (v.kind && KINDS.some(([x]) => x === v.kind)) setKind(v.kind);
      setExplanation(v.explanation || '');
      setWork({ title: '', urls: '', basis: 'owner', basisText: '', hashes: '', ...(v.work || {}) });
      setWho({ name: '', email: '', org: '', country: '', address: '', phone: '', ...(v.who || {}) });
    },
  });

  const isRights = kind === 'copyright' || kind === 'trademark';
  const submit = async (e) => {
    e.preventDefault();
    if (!targets.length) return toast.error(t('rn.e.no_target', 'Add at least one target.'));
    setBusy(true);
    try {
      const { solvePow } = await import('../lib/pow.js');
      const pow = await solvePow(() => api.get('/auth/pow'));
      const r = await api.post('/rights/notice', {
        kind, explanation,
        targets: targets.map((x) => ({ type: x.type, id: x.id, label: x.label, url: x.url, files: x.files, note: x.note })),
        work: isRights ? { title: work.title, urls: work.urls, basis: work.basis, basisText: work.basisText, hashes: work.hashes } : {},
        ...who, onBehalfOf: work.basis, ...stmt, pow,
      });
      draft.clear();
      setDone(r.notice);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (x) {
      const e = x.data?.error;
      const msg = { no_target: 'rn.e.no_target', explanation_short: 'rn.e.explanation', name_required: 'rn.e.name', email_invalid: 'rn.e.email', good_faith_required: 'rn.e.statements', accuracy_required: 'rn.e.statements', signature_required: 'rn.e.signature', work_required: 'rn.e.work', own_content: 'rn.e.own', daily_limit: 'rn.e.daily', pow_required: 'rn.e.pow' }[e];
      toast.error(msg ? t(msg, e) : (e || t('acc.failed', 'Failed.')));
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="max-w-2xl mx-auto py-8 space-y-4">
        <Card className="p-6 text-center space-y-3">
          <CheckCircle2 size={36} className="mx-auto text-success" />
          <h1 className="text-xl font-bold">{t('rn.done.t', 'Notice received')}</h1>
          <div className="font-mono text-lg">{done.code}</div>
          <p className="text-sm text-[var(--muted)]">{t('rn.done.s', 'Keep this reference. A person will review your notice; you will be told at the e-mail you gave what was decided. You can follow it here at any time with the reference and that e-mail.')}</p>
          {user && <Link to="/dashboard?s=reports" className="text-sm text-[var(--accent-ink)] hover:underline">{t('rn.done.dash', 'It is also listed in your dashboard → Reports.')}</Link>}
        </Card>
        <Lookup t={t} initialCode={done.code} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Scale size={22} className="text-[var(--accent-ink)]" /> {t('rn.title', 'Report content or claim a right')}</h1>
        <p className="text-sm text-[var(--muted)] mt-1">{t('rn.sub', 'For copyright and other rights claims, impersonation, privacy, and illegal content. No account needed. Everything below is what the law asks a notice to contain — a complete notice is one we can act on the same day.')}</p>
        <p className="text-[11px] text-[var(--faint)] mt-1">{t('rn.sub2', 'Something else, a bug, a broken listing, a rude comment? The Report button next to the content is quicker.')} <Link to="/legal/terms" className="underline">{t('rn.legal', 'How reports are handled')}</Link></p>
      </div>

      {params.get('code') && <Lookup t={t} initialCode={params.get('code')} />}

      <DraftBanner draft={draft} what={t('draft.w.report', 'report')} />

      <form onSubmit={submit} className="space-y-5">
        {/* 1 — where */}
        <section className="space-y-2">
          <h2 className="font-semibold flex items-center gap-2"><span className="grid place-items-center w-6 h-6 rounded-full tint-primary text-[var(--accent-ink)] text-xs font-bold">1</span> {t('rn.s1', 'Where it is')}</h2>
          <p className="text-xs text-[var(--muted)]">{t('rn.s1.d', 'Paste the address of the repo, catalogue, item or profile. Inside a repo or a catalogue you can then tick the exact files or items.')}</p>
          {targets.map((tg, i) => <TargetCard key={`${tg.type}:${tg.id || tg.url}`} t={t} target={tg} onChange={(next) => setTargets((l) => l.map((x, j) => (j === i ? next : x)))} onRemove={() => setTargets((l) => l.filter((_, j) => j !== i))} />)}
          <div className="flex gap-2">
            <Input value={paste} onChange={(e) => setPaste(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPasted(); } }} placeholder="https://bettercommunity.ch/r/… · /c/… · /item/… · /u/… · BC-XXXX-XXXX" className="flex-1" />
            <Button type="button" onClick={addPasted} disabled={resolving || !paste.trim()}>{resolving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {t('rn.add', 'Add')}</Button>
          </div>
        </section>

        {/* 2 — why */}
        <section className="space-y-2">
          <h2 className="font-semibold flex items-center gap-2"><span className="grid place-items-center w-6 h-6 rounded-full tint-primary text-[var(--accent-ink)] text-xs font-bold">2</span> {t('rn.s2', 'What is wrong')}</h2>
          <Field label={t('rn.kind', 'Kind of claim')}><Select value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([v, k, fb]) => <option key={v} value={v}>{t(k, fb)}</option>)}</Select></Field>
          <Field label={t('rn.why', 'Explain, why it infringes or is illegal, and how you know')} hint={t('rn.why.h', 'Be specific: "the archive mods/x.zip is my mod Foo v1.2, byte for byte" beats "they stole my work".')}>
            <Textarea rows={5} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
          </Field>
        </section>

        {/* 3 — the work */}
        {isRights && (
          <section className="space-y-2">
            <h2 className="font-semibold flex items-center gap-2"><span className="grid place-items-center w-6 h-6 rounded-full tint-primary text-[var(--accent-ink)] text-xs font-bold">3</span> {t('rn.s3', 'The work or mark')}</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label={t('rn.wtitle', 'Its name')}><Input value={work.title} onChange={(e) => setWork({ ...work, title: e.target.value })} /></Field>
              <Field label={t('rn.basis', 'On what basis')}><Select value={work.basis} onChange={(e) => setWork({ ...work, basis: e.target.value })}>{BASIS.map(([v, k, fb]) => <option key={v} value={v}>{t(k, fb)}</option>)}</Select></Field>
            </div>
            <Field label={t('rn.wurls', 'Where the original lives, one link per line')} hint={t('rn.wurls.h', 'Your store page, your repository, your site. This is how we tell the original from the copy.')}>
              <Textarea rows={3} value={work.urls} onChange={(e) => setWork({ ...work, urls: e.target.value })} placeholder="https://…" />
            </Field>
            <Field label={t('rn.basistext', 'Anything that shows you hold the right (optional)')}><Textarea rows={2} value={work.basisText} onChange={(e) => setWork({ ...work, basisText: e.target.value })} /></Field>
            <Field label={t('rn.hashes', 'SHA-256 of your original files (optional, one per line)')} hint={t('rn.hashes.h', 'If you give us the hashes of your files, we can recognise them the next time somebody uploads them, before you have to write to us again.')}>
              <Textarea rows={2} value={work.hashes} onChange={(e) => setWork({ ...work, hashes: e.target.value })} className="font-mono text-xs" />
            </Field>
          </section>
        )}

        {/* 4 — who */}
        <section className="space-y-2">
          <h2 className="font-semibold flex items-center gap-2"><span className="grid place-items-center w-6 h-6 rounded-full tint-primary text-[var(--accent-ink)] text-xs font-bold">{isRights ? 4 : 3}</span> {t('rn.s4', 'Who you are')}</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t('rn.name', 'Full name')}><Input value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} /></Field>
            <Field label={t('rn.email', 'E-mail')}><Input type="email" value={who.email} onChange={(e) => setWho({ ...who, email: e.target.value })} /></Field>
            <Field label={t('rn.org', 'Company or organisation (optional)')}><Input value={who.org} onChange={(e) => setWho({ ...who, org: e.target.value })} /></Field>
            <Field label={t('rn.country', 'Country (2 letters, optional)')}><Input value={who.country} maxLength={2} onChange={(e) => setWho({ ...who, country: e.target.value.toUpperCase() })} placeholder="FR" /></Field>
            <Field label={t('rn.address', 'Postal address (optional; asked for by French law)')}><Input value={who.address} onChange={(e) => setWho({ ...who, address: e.target.value })} /></Field>
            <Field label={t('rn.phone', 'Phone (optional)')}><Input value={who.phone} onChange={(e) => setWho({ ...who, phone: e.target.value })} /></Field>
          </div>
        </section>

        {/* 5 — statements */}
        <section className="space-y-2">
          <h2 className="font-semibold flex items-center gap-2"><span className="grid place-items-center w-6 h-6 rounded-full tint-primary text-[var(--accent-ink)] text-xs font-bold">{isRights ? 5 : 4}</span> {t('rn.s5', 'Statements')}</h2>
          <label className="flex items-start gap-2 text-sm cursor-pointer"><input type="checkbox" className="mt-1" checked={stmt.goodFaith} onChange={(e) => setStmt({ ...stmt, goodFaith: e.target.checked })} /> <span>{t('rn.goodfaith', 'I am acting in good faith and believe the use described above is not authorised by the rights holder, their agent, or the law.')}</span></label>
          <label className="flex items-start gap-2 text-sm cursor-pointer"><input type="checkbox" className="mt-1" checked={stmt.accurate} onChange={(e) => setStmt({ ...stmt, accurate: e.target.checked })} /> <span>{t('rn.accurate', 'The information in this notice is accurate, and I am the rights holder or authorised to act for them. I understand a knowingly false notice can make me liable.')}</span></label>
          <Field label={t('rn.signature', 'Signature, type your full name')}><Input value={stmt.signature} onChange={(e) => setStmt({ ...stmt, signature: e.target.value })} /></Field>
        </section>

        <div className="flex items-center gap-3 flex-wrap">
          <Button type="submit" variant="primary" disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />} {t('rn.send', 'Send the notice')}</Button>
          <span className="text-[11px] text-[var(--faint)]">{t('rn.send.h', 'You will get a reference by e-mail. Reviewed by a person, not an automated system.')}</span>
        </div>
      </form>

      {!params.get('code') && <Lookup t={t} />}
    </div>
  );
}
