// Admin, Messages: the contact inbox, and the policy for conversations between members.
//
// WHAT THIS REPLACES, and why it is a different shape.
//
// The old screen was a LIST. Two hundred cards, every body expanded, marked read by hovering
// over it, and one action: delete. It told you a message existed; it told you nothing about
// whether anybody was on it, whether it had been answered, or by whom. The only way to reply
// was a `mailto:` that left no trace on the site, so the answer lived in one person's sent
// folder and the next person to open the message could not tell it had been handled. That is
// not a small ergonomic complaint: it is why the same message got two answers, and why
// "cluttered" was the word for it — everything was visible and none of it was informative.
//
// So: a list on the left that fits on a screen, one message open on the right, and the four
// facts that decide what to do next (state, who has it, how urgent, whether it was answered)
// on the row rather than inside it. The long explanations — the legal clock, the security
// rule — are one line with the rest behind `Explain`, because an explanation that is always
// on is an explanation nobody reads twice and everybody scrolls past forever.
//
// Markdown is the format in BOTH directions. The sender's body is rendered with the site's
// own B.MD renderer (ui/md.jsx), and a reply is written in the site's own MarkdownEditor and
// rendered to HTML on its way into the mail. There is no second formatting dialect here.
//
// THE SECURITY RULE. A security report's body never appears in the list: the API withholds
// it, and this screen shows a lock instead of an excerpt. It is readable in one place, the
// open message, on a surface every admin-tier session reaches only with a second factor. The
// reply composer never quotes it back. See misc.mjs, and test/contact-inbox.test.mjs.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Mail, Gavel, ShieldAlert, Search, RefreshCw, Send, StickyNote, Lock, User as UserIcon,
  Trash2, Inbox, CheckCircle2, Clock, Ban, CircleDot, Flag, MessageSquare, Sliders,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAsync } from './pages.jsx';
import Markdown from '../ui/md.jsx';
import { MarkdownEditor } from '../editor/markdown-editor.jsx';
import { AdminThreads } from './admin-threads.jsx';
import { Button, Card, Badge, Input, Select, EmptyState, Spinner, Explain, Field, useToast, useDialog } from '../ui/ui.jsx';

/* ── The five states, and what each one MEANS ──────────────────────────────────────────
 *
 * They are not "read" and "unread". Each one answers a different question, and the pair they
 * replaced answered none of them:
 *
 *   new      nobody has looked at it
 *   open     somebody has it, it is not finished
 *   waiting  answered, the next move is the sender's — not on us, not done
 *   resolved done
 *   spam     junk, kept so the sender stays countable and blockable
 *
 * `waiting` is the one that earns its place: without it an answered message either sits in
 * the queue looking unhandled or gets closed while the conversation is still live.
 */
const STATES = [
  ['new', CircleDot, (t) => t('ami.s.new', 'New'), 'amber'],
  ['open', Inbox, (t) => t('ami.s.open', 'In progress'), 'primary'],
  ['waiting', Clock, (t) => t('ami.s.waiting', 'Waiting on them'), ''],
  ['resolved', CheckCircle2, (t) => t('ami.s.resolved', 'Resolved'), 'success'],
  ['spam', Ban, (t) => t('ami.s.spam', 'Spam'), 'error'],
];
const STATE_LABEL = (t, s) => { const row = STATES.find(([k]) => k === s); return row ? row[2](t) : s; };

/** The sender-declared subject, and the two families that change how a message is handled. */
const KINDS = {
  report: { legal: true, tone: 'error', label: (t) => t('am.k.report', 'Illegal content') },
  copyright: { legal: true, tone: 'error', label: (t) => t('am.k.copyright', 'Copyright') },
  data_export: { legal: true, tone: 'primary', label: (t) => t('am.k.export', 'Data copy') },
  data_delete: { legal: true, tone: 'primary', label: (t) => t('am.k.delete', 'Data deletion') },
  security: { secret: true, tone: 'amber', label: (t) => t('am.k.security', 'Security') },
  appeal: { tone: 'amber', label: (t) => t('am.k.appeal', 'Moderation appeal') },
  billing: { tone: '', label: (t) => t('am.k.billing', 'Billing') },
  bug: { tone: '', label: (t) => t('am.k.bug', 'Bug') },
  account: { tone: '', label: (t) => t('am.k.account', 'Account') },
  translation: { tone: '', label: (t) => t('am.k.translation', 'Translation') },
  other: { tone: '', label: (t) => t('ami.k.other', 'Other') },
};
const kindOf = (k) => KINDS[k] || KINDS.other;
const when = (d) => new Date(d).toLocaleString();
const PRIORITIES = [
  ['high', (t) => t('ami.p.high', 'High')],
  ['normal', (t) => t('ami.p.normal', 'Normal')],
  ['low', (t) => t('ami.p.low', 'Low')],
];

/* ── One row in the list ─────────────────────────────────────────────────────────────── */
function Row({ m, active, onClick }) {
  const { t } = useI18n();
  const k = kindOf(m.kind);
  return (
    <li>
      <button type="button" onClick={onClick} aria-current={active ? 'true' : undefined}
        className={`w-full text-start px-3 py-2.5 flex gap-3 items-start ${active ? 'tint-primary' : 'hover:panel'}`}>
        <span className="grid place-items-center w-7 h-7 rounded-lg panel-quiet shrink-0 mt-0.5">
          {k.secret ? <ShieldAlert size={14} className="text-warning" /> : k.legal ? <Gavel size={14} className="text-error" /> : <Mail size={14} className="text-[var(--accent-ink)]" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={`truncate text-sm ${m.state === 'new' ? 'font-semibold' : ''}`} title={m.name}>{m.name}</span>
            {m.priority === 'high' && <Flag size={11} className="text-error shrink-0" aria-label={t('ami.p.high', 'High')} />}
            <span className="ms-auto text-[11px] text-[var(--faint)] shrink-0 tabular-nums">{new Date(m.createdAt).toLocaleDateString()}</span>
          </span>
          <span className="block text-[12px] text-[var(--muted)] truncate mt-0.5" title={m.secret ? undefined : m.excerpt}>
            {m.secret ? <span className="inline-flex items-center gap-1 italic"><Lock size={10} /> {t('ami.hidden', 'Open it to read this one.')}</span> : m.excerpt}
          </span>
          <span className="flex items-center gap-1.5 mt-1 flex-wrap">
            <Badge tone={k.tone || undefined}>{k.label(t)}</Badge>
            {m.state !== 'new' && <Badge>{STATE_LABEL(t, m.state)}</Badge>}
            {m.assignee && <Badge tone="primary" title={m.assignee.displayName}><UserIcon size={9} /> {m.assignee.displayName}</Badge>}
            {m.replyCount > 0 && <span className="text-[11px] text-[var(--faint)] inline-flex items-center gap-1"><Send size={10} /> {m.replyCount}</span>}
            {m.noteCount > 0 && <span className="text-[11px] text-[var(--faint)] inline-flex items-center gap-1"><StickyNote size={10} /> {m.noteCount}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

/* ── The open message ────────────────────────────────────────────────────────────────── */
function Thread({ id, staff, onChanged, onDeleted }) {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const { data, loading, reload } = useAsync(() => api.get(`/admin/contact/${id}/thread`), [id]);
  const [tab, setTab] = useState('reply'); // reply | note
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <div className="py-10 text-center"><Spinner /></div>;
  const m = data?.message;
  if (!m) return <EmptyState icon={Mail} title={t('ami.gone', 'This message is gone.')} sub={t('ami.gone.s', 'It was deleted while the list was open.')} />;
  const k = kindOf(m.kind);

  const patch = async (body) => {
    try { await api.patch(`/admin/contact/${m.id}`, body); await reload(true); onChanged?.(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };
  const send = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await api.post(`/admin/contact/${m.id}/replies`, { kind: tab, body: draft.trim() });
      setDraft(''); await reload(true); onChanged?.();
      toast.success(tab === 'reply' ? t('ami.sent', 'Answer sent.') : t('ami.noted', 'Note saved.'));
    } catch (x) {
      const e = x.data?.error;
      toast.error(e === 'email_disabled' ? t('ami.nomail', 'E-mail is switched off for this deployment, so an answer cannot leave. Write a note instead.')
        : e === 'send_failed' ? t('ami.sendfail', 'The mail server refused it. Nothing was saved.')
        : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  const del = async () => {
    if (!await dialog.confirm({ title: t('ami.del.q', 'Delete this message?'), message: t('ami.del.m', 'The message, its answers and its notes go with it. This cannot be undone.'), danger: true })) return;
    try { await api.del(`/admin/contact/${m.id}`); onDeleted?.(); } catch { toast.error(t('common.failed', 'Failed.')); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate" title={m.name}>{m.name}</div>
          <div className="text-[12px] text-[var(--muted)] truncate" title={m.email}>
            <a href={`mailto:${m.email}`} className="hover:text-[var(--accent-ink)]">{m.email}</a>
            {m.user && <> · <span title={m.user.displayName}>{m.user.displayName}</span></>}
            {' · '}{when(m.createdAt)}
          </div>
        </div>
        <Badge tone={k.tone || undefined}>{k.label(t)}</Badge>
      </div>

      {/* The three decisions, on one line. They used to be nowhere. */}
      <div className="grid sm:grid-cols-3 gap-2">
        <Field label={t('ami.f.state', 'State')}>
          <Select value={m.state} onChange={(e) => patch({ state: e.target.value })}>
            {STATES.map(([s, , label]) => <option key={s} value={s}>{label(t)}</option>)}
          </Select>
        </Field>
        <Field label={t('ami.f.assignee', 'Handled by')}>
          <Select value={m.assignee?.id || ''} onChange={(e) => patch({ assigneeId: e.target.value || null })}>
            <option value="">{t('ami.nobody', 'Nobody yet')}</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
          </Select>
        </Field>
        <Field label={t('ami.f.priority', 'Priority')}>
          <Select value={m.priority} onChange={(e) => patch({ priority: e.target.value })}>
            {PRIORITIES.map(([v, label]) => <option key={v} value={v}>{label(t)}</option>)}
          </Select>
        </Field>
      </div>

      {k.secret && (
        <Explain summary={t('ami.sec.lead', 'This report is readable here and nowhere else.')} tone="plain" className="text-[12px]">
          {t('ami.sec.body', 'A security report can describe a working attack: the way in, the account it worked on, the data it reached. So it is never copied to Discord, never carried in the alert that woke you, and never shown in the list beside this one. It lives in this panel, which no session reaches without a second factor. An answer carries what you write and never quotes the report back, because the reply leaves by e-mail and e-mail has no second factor on it.')}
        </Explain>
      )}
      {k.legal && (
        <Explain summary={t('ami.legal.lead', 'This one carries a clock.')} tone="plain" className="text-[12px]">
          {t('ami.legal.body', 'The DSA expects action without undue delay, and under the LCEN a notification in form is what makes us legally presumed to know. Answer with a reason either way: a removal and a refusal both need one. A data copy or an erasure has a one-month deadline from the day it arrived, which is the date above.')}
        </Explain>
      )}

      <Card className="p-4">
        <div className="prose-sm break-words"><Markdown>{m.body}</Markdown></div>
      </Card>

      {data.replies.length > 0 && (
        <div className="space-y-2">
          {data.replies.map((r) => (
            <Card key={r.id} className={`p-3 ${r.kind === 'note' ? 'panel-quiet' : ''}`}>
              <div className="text-[11px] text-[var(--faint)] flex items-center gap-1.5 mb-1.5 flex-wrap">
                {r.kind === 'note' ? <><StickyNote size={11} /> {t('ami.r.note', 'Internal note')}</> : <><Send size={11} /> {t('ami.r.reply', 'Answered')}</>}
                <span>· {r.authorName || t('ami.r.staff', 'staff')} · {when(r.createdAt)}</span>
                {r.kind === 'reply' && !r.delivered && <Badge tone="error">{t('ami.r.undelivered', 'not delivered')}</Badge>}
              </div>
              <div className="prose-sm break-words text-sm"><Markdown>{r.body}</Markdown></div>
            </Card>
          ))}
        </div>
      )}

      <Card className="p-3 space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="inline-flex rounded-lg border border-[var(--line)] overflow-hidden">
            {[['reply', Send, t('ami.tab.reply', 'Answer')], ['note', StickyNote, t('ami.tab.note', 'Note')]].map(([id2, I, label]) => (
              <button key={id2} type="button" onClick={() => setTab(id2)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs ${tab === id2 ? 'tint-primary font-medium' : 'text-[var(--muted)]'}`}><I size={12} /> {label}</button>
            ))}
          </div>
          <span className="text-[11px] text-[var(--faint)]">
            {tab === 'reply'
              ? t('ami.tab.reply.h', 'Goes to {e} by e-mail. Markdown.').replace('{e}', m.email)
              : t('ami.tab.note.h', 'Stays here. Nobody outside this screen sees it.')}
          </span>
        </div>
        <MarkdownEditor value={draft} onChange={setDraft} minHeight={140}
          placeholder={tab === 'reply' ? t('ami.ph.reply', 'Write the answer…') : t('ami.ph.note', 'What the next person needs to know…')} />
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Button size="sm" variant="ghost" className="!text-error" onClick={del}><Trash2 size={13} /> {t('ami.delete', 'Delete')}</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={!draft.trim()} onClick={send}>
            {tab === 'reply' ? <><Send size={13} /> {t('ami.send', 'Send the answer')}</> : <><StickyNote size={13} /> {t('ami.savenote', 'Save the note')}</>}
          </Button>
        </div>
        {tab === 'reply' && !data.emailEnabled && <p className="text-[11px] text-error">{t('ami.nomail', 'E-mail is switched off for this deployment, so an answer cannot leave. Write a note instead.')}</p>}
      </Card>
    </div>
  );
}

/* ── Member conversations: the policy, not the moderation ─────────────────────────────
 *
 * The moderation queue below (AdminThreads) is where a flagged conversation is read. This
 * card is the part that has no other home: whether members may write to each other at all,
 * how fast one person may start conversations, and what happens to the ones already open
 * when the switch goes off.
 */
function MemberPolicy() {
  const { t } = useI18n(); const toast = useToast();
  const { data, reload } = useAsync(() => api.get('/admin/threads/config'), []);
  const [f, setF] = useState(null); const [busy, setBusy] = useState(false);
  const cfg = f || data?.config;
  if (!cfg) return null;
  const md = cfg.memberDirect || {};
  const setMd = (patch) => setF({ ...cfg, memberDirect: { ...md, ...patch } });
  const save = async () => {
    setBusy(true);
    try { await api.put('/admin/threads/config', { memberDirect: { enabled: md.enabled !== false, autoArchiveDays: Number(md.autoArchiveDays) || 0, autoArchiveAnonDays: Number(md.autoArchiveAnonDays) || 0, openPerHour: Number(md.openPerHour) || 0, openPerDay: Number(md.openPerDay) || 0, whenOff: md.whenOff === 'keep' ? 'keep' : 'freeze' } }); setF(null); await reload(true); toast.success(t('common.saved', 'Saved.')); }
    catch { toast.error(t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  return (
    <Card className="p-4 space-y-3">
      <div className="font-semibold flex items-center gap-2"><Sliders size={15} className="text-[var(--accent-ink)]" /> {t('ami.mp.title', 'Conversations between members')}</div>
      <Explain summary={t('ami.mp.lead', 'This switch is a ceiling. Each member still chooses for themselves.')} className="text-[12px]">
        {t('ami.mp.body', 'Off, nobody can open a conversation with a member, whatever that member prefers: a preference can refuse what the site allows, never grant what the site refused. It covers conversations addressed to a PERSON only. A repo, a catalogue and a team are things somebody published and still owe a contact channel, so those are never affected by anything on this card.')}
      </Explain>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={md.enabled !== false} onChange={(e) => setMd({ enabled: e.target.checked })} />
        {t('ami.mp.enabled', 'Members can write to each other')}
      </label>
      {/* No cap on how many conversations a member has: the rate limits stop a flood, the
          archive clocks keep the lists short. */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <Field label={t('ami.mp.archive', 'Archive after (days idle)')} hint={t('ami.mp.zero', '0 = no limit')}>
          <Input type="number" min={0} value={md.autoArchiveDays ?? 30} onChange={(e) => setMd({ autoArchiveDays: Number(e.target.value) })} />
        </Field>
        <Field label={t('ami.mp.archiveanon', 'Anonymous: archive after (days)')} hint={t('ami.mp.zero', '0 = no limit')}>
          <Input type="number" min={0} value={md.autoArchiveAnonDays ?? 7} onChange={(e) => setMd({ autoArchiveAnonDays: Number(e.target.value) })} />
        </Field>
        <Field label={t('ami.mp.oph', 'New conversations / hour')} hint={t('ami.mp.zero', '0 = no limit')}>
          <Input type="number" min={0} value={md.openPerHour ?? 4} onChange={(e) => setMd({ openPerHour: Number(e.target.value) })} />
        </Field>
        <Field label={t('ami.mp.opd', 'New conversations / day')} hint={t('ami.mp.zero', '0 = no limit')}>
          <Input type="number" min={0} value={md.openPerDay ?? 12} onChange={(e) => setMd({ openPerDay: Number(e.target.value) })} />
        </Field>
        <Field label={t('ami.mp.whenoff', 'When switched off')}>
          <Select value={md.whenOff === 'keep' ? 'keep' : 'freeze'} onChange={(e) => setMd({ whenOff: e.target.value })}>
            <option value="freeze">{t('ami.mp.freeze', 'Freeze the open ones')}</option>
            <option value="keep">{t('ami.mp.keep', 'Let the open ones continue')}</option>
          </Select>
        </Field>
      </div>
      <Explain summary={t('ami.mp.fate.lead', 'Nothing is ever deleted by either switch.')} className="text-[12px]">
        {t('ami.mp.fate', 'A conversation that is already open stays readable by both sides. Frozen means nobody can add to it; the archive clock and the switches are read at the moment somebody tries to write, so turning a switch back on restores exactly what was there rather than repairing it. An archived conversation is not closed either: either side can reopen it. There is no limit on how many conversations a member keeps; the hourly and daily limits stop floods, and replies are limited by the Replies per hour setting below.')}
      </Explain>
      <div className="flex justify-end"><Button size="sm" variant="primary" loading={busy} disabled={!f} onClick={save}>{t('common.save', 'Save')}</Button></div>
    </Card>
  );
}

/* ── The screen ──────────────────────────────────────────────────────────────────────── */
export default function AdminMessagesScreen() {
  const { t } = useI18n();
  const [sp, setSp] = useSearchParams();
  // In the URL, so a digest that says "2 waiting" can link to those two, and so Back works.
  const state = sp.get('state') || 'new';
  const open = sp.get('msg') || '';
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [assignee, setAssignee] = useState('');
  // One writer, taking every key at once. Two calls in a row each read the SAME stale `sp`
  // and the second silently discards the first, which is how "click a state, it also closes
  // the open message" turns into "click a state, nothing moves".
  const put = (patch) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); }
    setSp(n, { replace: true });
  };

  const qs = new URLSearchParams({ ...(state === 'all' ? {} : { state }), ...(q ? { q } : {}), ...(kind ? { kind } : {}), ...(assignee ? { assignee } : {}) }).toString();
  const { data, loading, reload } = useAsync(() => api.get(`/admin/contact/inbox?${qs}`), [qs]);
  const rows = data?.messages || [];
  const counts = data?.counts || {};
  const staff = data?.staff || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <Mail size={16} className="text-[var(--accent-ink)]" />
        <h2 className="font-semibold">{t('am.title', 'Contact messages')}</h2>
        {counts.new > 0 && <Badge tone="amber">{counts.new}</Badge>}
        <Button size="sm" variant="ghost" className="ms-auto" onClick={() => reload()} title={t('am.refresh', 'Refresh')} aria-label={t('am.refresh', 'Refresh')}><RefreshCw size={14} /></Button>
      </div>

      {/* One row of states, one row of filters. Everything else that used to sit here is
          either on a row or behind an Explain inside the open message. */}
      <div className="flex flex-wrap gap-1.5">
        {/* Written with `t` rather than a renamed parameter on purpose: i18n-check collects
            calls spelled t with a quoted literal, and a key it cannot see is a key nobody
            notices is still in English. (This comment says no such call for the same reason:
            the checker reads comments too, and would demand a translation for it.) */}
        {[...STATES, ['all', Mail, (t) => t('ami.s.all', 'Everything'), '']].map(([s, I, label]) => (
          <button key={s} type="button" onClick={() => put({ state: s === 'new' ? '' : s, msg: '' })}
            aria-current={state === s ? 'true' : undefined}
            className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition ${state === s ? 'border-[var(--ring)] tint-primary' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
            <I size={12} /> {label(t)}
            {counts[s] > 0 && <Badge tone={s === 'new' ? 'amber' : undefined}>{counts[s]}</Badge>}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--faint)] pointer-events-none" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="ps-8" placeholder={t('ami.search', 'Name, e-mail, text…')} />
        </div>
        <Select value={kind} className="!w-auto" onChange={(e) => setKind(e.target.value)} aria-label={t('ami.f.kind', 'Subject')}>
          <option value="">{t('ami.allkinds', 'Every subject')}</option>
          {Object.keys(KINDS).map((k) => <option key={k} value={k}>{KINDS[k].label(t)}</option>)}
        </Select>
        <Select value={assignee} className="!w-auto" onChange={(e) => setAssignee(e.target.value)} aria-label={t('ami.f.assignee', 'Handled by')}>
          <option value="">{t('ami.anyone', 'Anyone')}</option>
          <option value="me">{t('ami.mine', 'Mine')}</option>
          <option value="none">{t('ami.unassigned', 'Nobody yet')}</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
        </Select>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] gap-4 items-start">
        <Card className={`overflow-hidden ${open ? 'hidden lg:block' : ''}`}>
          {loading && !data ? <div className="py-10 text-center"><Spinner /></div>
            : rows.length ? (
              <ul className="divide-y divide-[var(--line)] max-h-[70vh] overflow-auto">
                {rows.map((m) => <Row key={m.id} m={m} active={m.id === open} onClick={() => put({ msg: m.id })} />)}
              </ul>
            ) : (
              <div className="p-2">
                <EmptyState icon={Inbox}
                  title={state === 'new' ? t('ami.empty.new', 'Nothing new') : t('ami.empty', 'Nothing here')}
                  sub={q || kind || assignee ? t('ami.empty.filtered', 'The filters above exclude everything.') : t('ami.empty.s', 'Messages from the contact form land here.')}
                  action={q || kind || assignee || state !== 'all' ? { label: t('ami.showall', 'Show everything'), icon: Mail, onClick: () => { setQ(''); setKind(''); setAssignee(''); put({ state: 'all', msg: '' }); } } : null} />
              </div>
            )}
        </Card>
        <Card className={`p-4 ${open ? '' : 'hidden lg:block'}`}>
          {open ? (
            <>
              <Button size="sm" variant="ghost" className="lg:hidden mb-2" onClick={() => put({ msg: '' })}>{t('ami.back', 'All messages')}</Button>
              <Thread id={open} staff={staff} onChanged={() => reload(true)} onDeleted={() => { put({ msg: '' }); reload(); }} />
            </>
          ) : (
            <EmptyState icon={MessageSquare} title={t('ami.pick', 'Pick a message')} sub={t('ami.pick.s', 'It opens here, with its answers and its notes.')} />
          )}
        </Card>
      </div>

      <MemberPolicy />
      {/* Moderation of member conversations: unchanged, and deliberately separate. Staff read
          what was flagged; they do not answer for the owners. */}
      <AdminThreads />
    </div>
  );
}
