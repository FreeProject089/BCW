import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { useI18n } from '../i18n.jsx';
import { Button, Card, Field, Input, Textarea, Select, PageHeader, Spinner, useToast } from '../ui/ui.jsx';
import {
  Mail, MessageSquare, Send, ShieldCheck, BadgeCheck, ArrowLeft, ChevronRight, Flag, Scale,
  CreditCard, User, ShieldAlert, Bug, Server, Receipt, Download, Trash2, Info, Languages, Boxes,
  Lightbulb,
} from 'lucide-react';
import { ContactModal } from '../ui/contact.jsx';
import { useDraft, DraftBanner } from '../ui/drafts.jsx';
import { GithubIcon, DiscordIcon, KofiIcon, RedditIcon } from '../ui/brand.jsx';
import { api } from '../lib/api.js';
import { ReportModal } from '../ui/report.jsx';
import { DESTINATIONS, Q1, Q2, TOPICS, fieldsComplete } from './contact-triage.js';

// Contact is a TRIAGE, not a form.
//
// One form with a topic dropdown asked everybody for a name, an e-mail and a paragraph, and
// the paragraph was never the thing missing: a billing question arrived without an invoice
// reference, a rights claim arrived with nothing to act on, and every one of those cost a
// round trip. Two short questions decide where somebody goes, and each destination asks for
// the two or three things its ANSWER needs.
//
// Two destinations are not forms here at all. A rights claim and a report about content or a
// person already have flows that know what the law asks for and can resolve a link into the
// exact file inside a repo; the triage hands over to them, carrying what has been typed,
// instead of growing a second, worse copy of each.
//
// The questions and the fields live in contact-triage.js — see that file for why, and for
// the server copy that re-checks every field.

const ICONS = {
  flag: Flag, scale: Scale, card: CreditCard, user: User, shield: ShieldAlert, bug: Bug,
  message: MessageSquare, server: Server, receipt: Receipt, download: Download, trash: Trash2,
  languages: Languages, boxes: Boxes, lightbulb: Lightbulb,
};

/**
 * "Write to a project": pick it, then the project's own contact form (its topics, its
 * inbox). A project that closed its inbox says so here rather than at Send.
 */
function ProjectRoute({ fr }) {
  const [ref, setRef] = useState('');
  const [info, setInfo] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setInfo(null);
    if (!ref) return undefined;
    let on = true;
    api.get(`/projects-contact/${encodeURIComponent(ref)}`).then((r) => { if (on) setInfo(r); }).catch(() => { if (on) setInfo({ enabled: false }); });
    return () => { on = false; };
  }, [ref]);
  return (
    <div className="space-y-3">
      <ProjectPicker value={ref} onChange={setRef} fr={fr} />
      {info && (info.enabled && info.topics?.length
        ? <div className="flex justify-end"><Button variant="primary" onClick={() => setOpen(true)}><MessageSquare size={15} /> {fr ? `Écrire à ${info.name}` : `Write to ${info.name}`}</Button></div>
        : <p className="text-xs text-[var(--muted)]">{fr ? 'Ce projet ne reçoit pas de messages ici pour le moment. Tu peux écrire à l’équipe du site avec « Autre chose ».' : 'This project does not take messages here at the moment. You can write to the site team with “Something else”.'}</p>)}
      {open && info && <ContactModal kind="project" targetId={info.ref} targetLabel={info.name} topics={info.topics} onClose={() => setOpen(false)} />}
    </div>
  );
}

/**
 * The projects a sender may pick (GET /contact/projects), loaded the first time a form asks
 * for one. Official projects first, then the others, in two groups, because "which project"
 * is a question about names people know and the two lists do not overlap.
 */
function ProjectPicker({ value, onChange, fr }) {
  const [list, setList] = useState(null);
  useEffect(() => { let on = true; api.get('/contact/projects').then((r) => { if (on) setList(r.projects || []); }).catch(() => { if (on) setList([]); }); return () => { on = false; }; }, []);
  if (!list) return <Spinner />;
  const official = list.filter((x) => x.official);
  const others = list.filter((x) => !x.official);
  return (
    <Select value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">{fr ? 'Choisir un projet' : 'Pick a project'}</option>
      {official.length > 0 && <optgroup label={fr ? 'Projets officiels' : 'Official projects'}>{official.map((x) => <option key={x.ref} value={x.ref}>{x.name}</option>)}</optgroup>}
      {others.length > 0 && <optgroup label={fr ? 'Autres projets' : 'Other projects'}>{others.map((x) => <option key={x.ref} value={x.ref}>{x.name}</option>)}</optgroup>}
    </Select>
  );
}
const Glyph = ({ name, size = 16, className = '' }) => {
  const I = ICONS[name] || MessageSquare;
  return <I size={size} className={className} />;
};

/**
 * A pasted address turned into a report target.
 *
 * The report flow takes a type and an id; a person pastes a URL. Anything that is not one of
 * ours becomes `general`, which is a real target type — a report with no resolvable target is
 * still a report, and refusing it here would send somebody back to a link they do not have.
 */
export function parseTarget(link) {
  const raw = String(link || '').trim();
  if (!raw) return { type: 'general', id: '', label: '' };
  let path = raw;
  try { if (/^https?:\/\//i.test(raw)) path = new URL(raw).pathname; } catch { path = raw; }
  const pick = (re, type) => { const m = re.exec(path); return m ? { type, id: decodeURIComponent(m[1]), label: raw } : null; };
  return pick(/^\/(?:r|repo)\/([^/?#]+)/, 'repo')
    || pick(/^\/c\/([^/?#]+)/, 'catalog')
    || pick(/^\/item\/([^/?#]+)/, 'item')
    || pick(/^\/u\/([^/?#]+)/, 'user')
    || { type: 'general', id: '', label: raw };
}

/** One tappable answer. Big target, label and a line of what it covers. */
function Choice({ icon, label, sub, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="w-full text-start flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 hover:border-[var(--ring)] transition-colors">
      <span className="grid place-items-center w-9 h-9 rounded-lg bg-[var(--surface)] shrink-0"><Glyph name={icon} className="text-[var(--accent-ink)]" /></span>
      <span className="flex-1 min-w-0">
        <span className="block font-medium text-sm">{label}</span>
        {sub && <span className="block text-xs text-[var(--muted)] mt-0.5">{sub}</span>}
      </span>
      <ChevronRight size={16} className="text-[var(--faint)] shrink-0" />
    </button>
  );
}

export function Contact() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const fr = lang === 'fr';
  const say = (l) => (fr ? l.fr : l.en);

  // Where we are. Nothing typed is ever dropped: every step writes into its own piece of
  // state and Back only moves the pointer, so a person who takes the wrong branch and comes
  // back finds their message where they left it.
  const [step, setStep] = useState('q1');       // q1 | q2 | form
  const [branch, setBranch] = useState(null);   // which Q2
  const [dest, setDest] = useState(null);
  const [locate, setLocate] = useState('');     // the pasted address, for the two routed flows
  const [reportOpen, setReportOpen] = useState(false);
  const [msg, setMsg] = useState({ name: '', email: '', body: '' });
  // Field answers per destination, so switching destination does not wipe them.
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const spec = dest ? DESTINATIONS[dest] : null;
  const dv = (dest && vals[dest]) || {};
  const setField = (name, v) => setVals((s) => ({ ...s, [dest]: { ...(s[dest] || {}), [name]: v } }));

  // Prefill from the account when signed in. The message is linked to the account
  // server-side regardless; this is a convenience.
  useEffect(() => { if (user) setMsg((m) => ({ ...m, name: m.name || user.displayName || '', email: m.email || user.email || '' })); }, [user]);

  // A `?topic=` link skips the questions: the page that sent it already knows the answer.
  // `?report=` is the old anonymous-report link and lands on the report branch.
  const [params] = useSearchParams();
  useEffect(() => {
    const topic = params.get('topic');
    if (topic && TOPICS[topic]) {
      const tp = TOPICS[topic];
      setDest(tp.dest); setStep('form');
      const tmpl = fr ? tp.fr : tp.en;
      if (tmpl) setMsg((m) => ({ ...m, body: m.body || tmpl }));
      return;
    }
    const rType = params.get('report');
    if (rType) {
      setBranch('locate'); setStep('q2'); setDest('report');
      const id = params.get('id') || '';
      const path = rType === 'repo' ? `/r/${id}` : rType === 'catalog' ? `/c/${id}` : rType === 'item' ? `/item/${id}` : rType === 'user' ? `/u/${id}` : '';
      if (id && path) setLocate((s) => s || path);
    }
  }, [params, fr]);

  // A kept draft of the WHOLE triage (ui/drafts.jsx): the answers, the destination and the
  // step, because the destination is what gives the answers their meaning — restoring a
  // paragraph without the queue it was written for would put a billing question in the
  // security inbox. `ready` waits a commit so the account prefill and a `?topic=` link have
  // landed: otherwise the form-as-the-account-filled-it counts as something the person typed,
  // and an untouched page would offer its own e-mail address back as a draft.
  const [draftReady, setDraftReady] = useState(false);
  useEffect(() => { setDraftReady(true); }, []);
  const draftValue = useMemo(() => ({ step, branch, dest, locate, msg, vals }), [step, branch, dest, locate, msg, vals]);
  const draft = useDraft({
    scope: 'contact-triage', id: null, value: draftValue, ready: draftReady,
    onRestore: (v) => {
      setMsg(v.msg || { name: '', email: '', body: '' }); setVals(v.vals || {});
      setDest(v.dest ?? null); setBranch(v.branch ?? null); setLocate(v.locate || '');
      setStep(v.step || 'q1');
    },
  });

  const channels = [
    { icon: DiscordIcon, label: 'Discord', sub: fr ? 'Support et communauté, en direct' : 'Fastest support and community', href: 'https://discord.com/invite/CTaaEF9R75' },
    { icon: GithubIcon, label: 'GitHub', sub: fr ? 'Signaler un bug / une issue' : 'Report bugs and issues', href: 'https://github.com/FreeProject089' },
    { icon: KofiIcon, label: 'Ko-fi', sub: fr ? 'Soutenir le projet' : 'Support the project', href: 'https://ko-fi.com/bettercommunity', kofi: true },
    { icon: RedditIcon, label: 'Reddit', sub: fr ? 'Discussions' : 'Discussions', href: 'https://www.reddit.com/r/BetterModManager/' },
  ];

  // ── the two routed destinations ──────────────────────────────────────────────────────
  // Carried over: the address, and which kind of claim it is. The notice form resolves the
  // address into a real target (down to the file inside a repo), which is precisely why this
  // page does not try to collect a rights claim itself.
  const goRights = () => {
    const q = new URLSearchParams({ kind: 'copyright' });
    if (locate.trim()) q.set('q', locate.trim());
    navigate(`/report?${q.toString()}`);
  };
  // Signed in: the report modal, with the target read out of the pasted address. Signed out:
  // the notice form, which takes a report from someone with no account.
  const goReport = () => {
    if (user) return setReportOpen(true);
    const q = new URLSearchParams({ kind: 'illegal' });
    if (locate.trim()) q.set('q', locate.trim());
    navigate(`/report?${q.toString()}`);
  };

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(msg.email);
  const valid = !!dest && msg.name.trim().length >= 1 && emailOk && msg.body.trim().length >= 5 && fieldsComplete(dest, dv);
  // A translation problem IN A PROJECT goes to that project's inbox, where the people who can
  // fix the text read it, as long as the project takes translation messages. Anything else,
  // or a project that does not, goes to the site team exactly as before.
  const sendToProject = async (pow) => {
    const payload = {
      kind: 'project', targetId: dv.project, topic: 'translation',
      subject: `${fr ? 'Traduction' : 'Translation'}: ${dv.page}`.slice(0, 140),
      body: [`${fr ? 'Page ou texte' : 'Page or text'}: ${dv.page}`, dv.lang ? `${fr ? 'Langue' : 'Language'}: ${dv.lang}` : '', '', msg.body.trim()].filter((x, i) => x || i === 2).join('\n'),
      ...(user ? {} : { email: msg.email.trim(), name: msg.name.trim(), pow }),
    };
    try { return await api.post('/threads', payload); }
    catch (x) { if (['project_contact_off', 'invalid_topic', 'not_found'].includes(x.data?.error)) return null; throw x; }
  };
  const send = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const { solvePow } = await import('../lib/pow.js');
      const pow = await solvePow(() => api.get('/auth/pow')); // anti-spam proof-of-work
      if (dest === 'translation' && dv.scope === 'project' && dv.project) {
        const r = await sendToProject(pow);
        if (r) { draft.clear(); setSent({ project: true, link: r.accessToken ? `${window.location.origin}/messages/t/${r.accessToken}` : '' }); return; }
      }
      await api.post('/contact', {
        name: msg.name.trim(), email: msg.email.trim(), body: msg.body.trim(),
        // The destination, not a kind: the server derives the queue from it so a browser
        // cannot file a security report as a data-export request.
        dest, fields: dv, pow,
      });
      draft.clear();
      setSent(true);
    } catch (x) {
      const err = x.data?.error;
      toast.error(err === 'daily_limit' ? (fr ? (user ? 'Limite quotidienne atteinte (5/jour).' : 'Limite quotidienne atteinte (3/jour). Connecte-toi pour 5/jour.') : (user ? 'Daily limit reached (5/day).' : 'Daily limit reached (3/day). Log in for 5/day.'))
        : err === 'field_required' ? (fr ? 'Il manque une réponse au-dessus.' : 'An answer above is missing.')
          : err === 'field_too_long' ? (fr ? 'Une réponse est trop longue.' : 'One answer is too long.')
          : err === 'unknown_project' ? (fr ? 'Ce projet n’existe plus, choisis-en un autre.' : 'That project no longer exists, pick another one.')
            : err === 'invalid_input' ? (fr ? 'Vérifie les champs.' : 'Check the fields.') : (fr ? 'Échec de l’envoi.' : 'Failed to send.'));
    } finally { setBusy(false); }
  };

  const restart = () => { setStep('q1'); setBranch(null); setDest(null); };

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader icon={Mail} title={t('ct.title2', 'Contact')} subtitle={fr ? 'Dis-nous de quoi il s’agit, on t’envoie au bon endroit.' : 'Tell us what it is about, we send you to the right place.'} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {channels.map((c) => (
          <a key={c.label} href={c.href} target="_blank" rel="noreferrer">
            <Card hover className="p-5 h-full"><c.icon size={22} className={c.kofi ? 'text-orange-400' : 'text-[var(--accent-ink)]'} />
              <div className="font-semibold mt-3">{c.label}</div><div className="text-xs text-[var(--muted)] mt-0.5">{c.sub}</div></Card>
          </a>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--line)] bg-[var(--surface-2)] flex items-center gap-2.5">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-brand to-brand-2"><MessageSquare size={16} className="text-white" /></span>
          <div className="min-w-0">
            <div className="font-semibold leading-tight">{fr ? 'Écrire à l’équipe' : 'Write to the team'}</div>
            <div className="text-xs text-[var(--muted)]">{fr ? 'Reçu directement par l’équipe, réponse par email.' : 'Goes straight to the team, we reply by email.'}</div>
          </div>
        </div>

        {!sent && <DraftBanner draft={draft} what={t('draft.w.message', 'message')} className="mx-6 mt-4" />}

        {sent ? (
          <div className="p-10 text-center">
            <span className="inline-grid place-items-center w-14 h-14 rounded-2xl bg-success-bg mb-4"><BadgeCheck size={28} className="text-success" /></span>
            <div className="text-lg font-semibold">{fr ? 'Message envoyé !' : 'Message sent!'}</div>
            {sent?.project ? (
              <p className="text-sm text-[var(--muted)] mt-1.5 max-w-sm mx-auto">
                {fr ? 'Il est parti aux mainteneurs du projet.' : 'It went to the project’s maintainers.'}{' '}
                {sent.link
                  ? <>{fr ? 'Garde ce lien pour suivre la conversation :' : 'Keep this link to follow the conversation:'} <a className="text-[var(--accent-ink)] break-all" href={sent.link}>{sent.link}</a></>
                  : (fr ? 'La conversation est dans ton tableau de bord, Messages.' : 'The conversation is in your dashboard, Messages.')}
              </p>
            ) : (
              <p className="text-sm text-[var(--muted)] mt-1.5 max-w-sm mx-auto">{fr ? 'Merci, on te répond dès que possible. Pour du temps réel, rejoins le Discord ci-dessus.' : 'Thanks, we will get back to you soon. Prefer real-time? Join the Discord above.'}</p>
            )}
            <Button className="mt-5" onClick={() => { setSent(false); setMsg({ name: user?.displayName || '', email: user?.email || '', body: '' }); setVals({}); restart(); }}>{fr ? 'Envoyer un autre' : 'Send another'}</Button>
          </div>
        ) : step === 'q1' ? (
          <div className="p-6 space-y-2.5">
            <div className="text-sm font-semibold mb-1">{fr ? 'C’est à quel sujet ?' : 'What is this about?'}</div>
            {Q1.map((o) => (
              <Choice key={o.id} icon={o.icon} label={say(o.label)} sub={say(o.sub)}
                onClick={() => { if (o.next) { setBranch(o.next); setDest(o.id === 'report' || o.id === 'rights' ? o.id : null); setStep('q2'); } else { setDest(o.dest); setStep('form'); } }} />
            ))}
          </div>
        ) : step === 'q2' ? (
          <div className="p-6 space-y-3">
            <button type="button" onClick={() => setStep('q1')} className="text-xs text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1"><ArrowLeft size={13} /> {fr ? 'Retour' : 'Back'}</button>
            <div className="text-sm font-semibold">{say(Q2[branch].title)}</div>
            {Q2[branch].kind === 'project' ? (
              <>
                <p className="text-xs text-[var(--muted)]">{say(Q2[branch].hint)}</p>
                <ProjectRoute fr={fr} />
              </>
            ) : Q2[branch].kind === 'locate' ? (
              <>
                <p className="text-xs text-[var(--muted)]">{say(Q2[branch].hint)}</p>
                <Input value={locate} onChange={(e) => setLocate(e.target.value)} maxLength={400}
                  placeholder="https://bettercommunity.ch/r/… · /c/… · /item/… · /u/…" />
                <p className="text-xs text-[var(--muted)]">{say(DESTINATIONS[dest === 'rights' ? 'rights' : 'report'].lead)}</p>
                <div className="flex justify-end">
                  <Button variant="primary" onClick={dest === 'rights' ? goRights : goReport}>
                    {dest === 'rights' ? (fr ? 'Ouvrir le formulaire de notification' : 'Open the notice form') : (fr ? 'Ouvrir le signalement' : 'Open the report')}
                    <ChevronRight size={15} />
                  </Button>
                </div>
              </>
            ) : (
              Q2[branch].options.map((o) => (
                <Choice key={o.dest} icon={o.icon} label={say(o.label)} sub={say(DESTINATIONS[o.dest].lead)}
                  onClick={() => { setDest(o.dest); setStep('form'); }} />
              ))
            )}
          </div>
        ) : (
          <div className="p-6">
            <button type="button" onClick={() => setStep(branch ? 'q2' : 'q1')} className="text-xs text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1 mb-3"><ArrowLeft size={13} /> {fr ? 'Retour' : 'Back'}</button>
            <div className="font-semibold text-sm">{say(spec.title)}</div>
            <p className="text-xs text-[var(--muted)] mt-1 flex items-start gap-1.5"><Info size={13} className="mt-0.5 shrink-0 text-[var(--accent-ink)]" /><span>{say(spec.lead)}</span></p>

            {spec.fields.length > 0 && (
              <div className="mt-4 grid sm:grid-cols-2 gap-4">
                {spec.fields.filter((f) => !f.requiredIf || dv[f.requiredIf.field] === f.requiredIf.equals).map((f) => (
                  <div key={f.name} className={f.type === 'textarea' || f.type === 'check' ? 'sm:col-span-2' : ''}>
                    {f.type === 'choice' ? (
                      <Field label={say(f.label)}>
                        <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label={say(f.label)}>
                          {f.options.map((o) => (
                            <button key={o.value} type="button" role="radio" aria-checked={dv[f.name] === o.value} onClick={() => setField(f.name, o.value)}
                              className={`px-3 py-1.5 rounded-lg border text-sm ${dv[f.name] === o.value ? 'border-[var(--ring)] tint-primary' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>{say(o.label)}</button>
                          ))}
                        </div>
                      </Field>
                    ) : f.type === 'project' ? (
                      <Field label={say(f.label)}><ProjectPicker value={dv[f.name]} onChange={(v) => setField(f.name, v)} fr={fr} /></Field>
                    ) : f.type === 'check' ? (
                      <label className="flex items-start gap-2 text-sm cursor-pointer rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5">
                        <input type="checkbox" className="mt-1" checked={dv[f.name] === true} onChange={(e) => setField(f.name, e.target.checked)} />
                        <span>{say(f.label)}</span>
                      </label>
                    ) : (
                      <Field label={say(f.label)}>
                        {f.type === 'textarea'
                          ? <Textarea rows={3} maxLength={f.max} value={dv[f.name] || ''} onChange={(e) => setField(f.name, e.target.value)} placeholder={f.placeholder ? say(f.placeholder) : undefined} />
                          : <Input maxLength={f.max} value={dv[f.name] || ''} onChange={(e) => setField(f.name, e.target.value)} placeholder={f.placeholder ? say(f.placeholder) : undefined} />}
                      </Field>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-4 mt-4">
              <Field label={fr ? 'Ton nom' : 'Your name'}><Input value={msg.name} onChange={(e) => setMsg({ ...msg, name: e.target.value })} maxLength={100} placeholder={fr ? 'Ton nom ou pseudo' : 'Your name or handle'} /></Field>
              <Field label={fr ? 'Ton email' : 'Your email'} hint={msg.email && !emailOk ? (fr ? 'Email invalide' : 'Invalid email') : undefined}>
                <Input type="email" value={msg.email} onChange={(e) => setMsg({ ...msg, email: e.target.value })} maxLength={254} placeholder="you@example.com" className={msg.email && !emailOk ? '!border-error-border' : ''} /></Field>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5">Message <span className="normal-case font-normal text-[var(--faint)]">({fr ? 'markdown supporté' : 'markdown supported'})</span></label>
                <span className={`text-[11px] ${msg.body.length > 2000 ? 'text-error' : 'text-[var(--faint)]'}`}>{msg.body.length}/2000</span>
              </div>
              <div className="rounded-xl border border-[var(--line)] overflow-hidden focus-within:border-[var(--line-strong)] transition-colors" style={{ background: 'var(--surface-2)' }}>
                <textarea value={msg.body} onChange={(e) => setMsg({ ...msg, body: e.target.value })} maxLength={2000} rows={6}
                  placeholder={fr ? 'Raconte-nous…' : 'Tell us about it…'}
                  className="w-full bg-transparent px-3.5 py-3 text-sm outline-none resize-y leading-relaxed text-[var(--text)]" style={{ minHeight: 150 }} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
              <p className="text-xs text-[var(--faint)] flex items-center gap-1.5"><ShieldCheck size={13} className="text-[var(--accent-ink)]" /> {fr ? 'Ton email sert uniquement à te répondre.' : 'Your email is only used to reply to you.'}</p>
              <Button variant="primary" disabled={!valid || busy} onClick={send}>{busy ? <Spinner /> : <><Send size={15} /> {fr ? 'Envoyer' : 'Send message'}</>}</Button>
            </div>
          </div>
        )}
      </Card>

      {/* The report flow itself, for a signed-in sender: the same modal the Report button
          opens next to the content, with the target read out of what was pasted. */}
      {reportOpen && (() => {
        const tg = parseTarget(locate);
        return <ReportModal targetType={tg.type} targetId={tg.id} targetLabel={tg.label} onClose={() => setReportOpen(false)} />;
      })()}
    </div>
  );
}
