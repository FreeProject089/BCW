// ── Make Your Own — the intake, as a conversation instead of a form ────────────────────
//
// This replaced a single modal that showed seven fields at once (name, logo, objective,
// audience, a 2000-character textarea, reply language, an urgent checkbox) above a "Pay &
// start" button. Everything it asked for is still asked here — the endpoint contract has not
// changed — but one question at a time, so a visitor who does not yet know what they want is
// walked to an answer instead of being handed a blank brief and a price.
//
// Two things the old form could not do and this can:
//   · it ASKS what the thing should do. A checklist per product kind turns "describe your
//     product" into a set of decisions, and the picks are written into the brief verbatim, so
//     the quote is priced against a scope both sides can see.
//   · it ends on a recap. Every answer, each one clickable to go back and change it, with the
//     consultation fee and what that fee buys stated next to the button — rather than the
//     price appearing for the first time on the button itself.
//
// The answers are folded into `description` (the field the API already has) as a readable
// brief, so no migration and no admin change: a request opened here reads like a well-written
// one typed by hand.
import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Clock, CreditCard, Pencil } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Modal, Button, Input, Textarea, Spinner, useToast } from '../ui/ui.jsx';
import { fmtMoney } from '../lib/money.js';

// Catalogues carry their own en/fr, the way KIND_META does in myo.jsx — a dictionary key per
// option would be ~90 keys that only ever appear here, and the i18n checker cannot see into
// a data table anyway.
const L = (lang, o) => (lang === 'fr' ? o.fr : o.en);

const TARGETS = [
  { id: 'personal', en: 'Just me', fr: 'Juste moi' },
  { id: 'friends', en: 'Friends', fr: 'Des amis' },
  { id: 'community', en: 'My community', fr: 'Ma communauté' },
  { id: 'nonprofit', en: 'A non-profit', fr: 'Une association' },
  { id: 'commercial', en: 'A business', fr: 'Une entreprise' },
  { id: 'other', en: 'Something else', fr: 'Autre chose' },
];

// What it should do, per product kind. These become the scope lines of the brief.
const SCOPE = {
  discord_bot: [
    { id: 'moderation', en: 'Moderation', fr: 'Modération' },
    { id: 'roles', en: 'Roles & permissions', fr: 'Rôles & permissions' },
    { id: 'tickets', en: 'Support tickets', fr: 'Tickets de support' },
    { id: 'giveaways', en: 'Giveaways', fr: 'Giveaways' },
    { id: 'economy', en: 'Levels & economy', fr: 'Niveaux & économie' },
    { id: 'music', en: 'Music / voice', fr: 'Musique / vocal' },
    { id: 'logs', en: 'Logs & audit', fr: 'Logs & audit' },
    { id: 'forms', en: 'Forms & applications', fr: 'Formulaires & candidatures' },
    { id: 'site', en: 'Website integration', fr: 'Intégration au site' },
    { id: 'i18n', en: 'Multilingual', fr: 'Multilingue' },
  ],
  app: [
    { id: 'windows', en: 'Windows', fr: 'Windows' },
    { id: 'macos', en: 'macOS', fr: 'macOS' },
    { id: 'linux', en: 'Linux', fr: 'Linux' },
    { id: 'android', en: 'Android', fr: 'Android' },
    { id: 'ios', en: 'iOS', fr: 'iOS' },
    { id: 'offline', en: 'Works offline', fr: 'Fonctionne hors-ligne' },
    { id: 'sync', en: 'Cloud sync', fr: 'Synchronisation cloud' },
    { id: 'autoupdate', en: 'Auto-update', fr: 'Mise à jour auto' },
    { id: 'notifs', en: 'Notifications', fr: 'Notifications' },
  ],
  website: [
    { id: 'showcase', en: 'Showcase pages', fr: 'Pages vitrine' },
    { id: 'shop', en: 'Shop & payments', fr: 'Boutique & paiements' },
    { id: 'blog', en: 'Blog', fr: 'Blog' },
    { id: 'accounts', en: 'Member accounts', fr: 'Espace membre' },
    { id: 'dashboard', en: 'Dashboard', fr: 'Tableau de bord' },
    { id: 'booking', en: 'Booking', fr: 'Réservation' },
    { id: 'contact', en: 'Contact form', fr: 'Formulaire de contact' },
    { id: 'seo', en: 'SEO', fr: 'Référencement' },
    { id: 'i18n', en: 'Multilingual', fr: 'Multilingue' },
  ],
  audit: [
    { id: 'source', en: 'Source code', fr: 'Code source' },
    { id: 'deps', en: 'Dependencies', fr: 'Dépendances' },
    { id: 'infra', en: 'Infrastructure', fr: 'Infrastructure' },
    { id: 'api', en: 'API surface', fr: 'Surface API' },
    { id: 'auth', en: 'Authentication', fr: 'Authentification' },
    { id: 'privacy', en: 'GDPR / personal data', fr: 'RGPD / données perso' },
    { id: 'cvss', en: 'CVSS-scored report', fr: 'Rapport noté CVSS' },
    { id: 'retest', en: 'Re-test after fixes', fr: 'Re-test après correctifs' },
  ],
  custom: [
    { id: 'auth', en: 'Accounts & login', fr: 'Comptes & connexion' },
    { id: 'payments', en: 'Payments', fr: 'Paiements' },
    { id: 'dashboard', en: 'Dashboard', fr: 'Tableau de bord' },
    { id: 'api', en: 'Public API', fr: 'API publique' },
    { id: 'mobile', en: 'Mobile', fr: 'Mobile' },
    { id: 'realtime', en: 'Real-time', fr: 'Temps réel' },
    { id: 'importexport', en: 'Import / export', fr: 'Import / export' },
    { id: 'i18n', en: 'Multilingual', fr: 'Multilingue' },
  ],
};
const scopeFor = (kind) => SCOPE[kind] || SCOPE.custom;

const BUDGETS = [
  { id: 'unknown', en: "I don't know yet", fr: 'Je ne sais pas encore' },
  { id: 'lt500', en: 'Under 500', fr: 'Moins de 500' },
  { id: '500_2k', en: '500 – 2 000', fr: '500 – 2 000' },
  { id: '2k_5k', en: '2 000 – 5 000', fr: '2 000 – 5 000' },
  { id: 'gt5k', en: 'Over 5 000', fr: 'Plus de 5 000' },
];
// `urgent: true` is the one answer here that changes the price, so it is marked as such.
const DEADLINES = [
  { id: 'flexible', en: 'No rush', fr: 'Pas pressé', urgent: false },
  { id: 'months', en: 'Within a few months', fr: 'D’ici quelques mois', urgent: false },
  { id: 'month', en: 'Within a month', fr: 'D’ici un mois', urgent: false },
  { id: 'urgent', en: 'As soon as possible', fr: 'Le plus vite possible', urgent: true },
];

/** A grid of pickable tiles — the one selection control this wizard uses, single or multi. */
function Tiles({ options, value, onPick, multi = false, lang, cols = 'sm:grid-cols-3' }) {
  const on = (id) => (multi ? (value || []).includes(id) : value === id);
  return (
    <div className={`grid grid-cols-2 ${cols} gap-2`}>
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onPick(o.id)}
          className={`relative text-start rounded-xl border px-3 py-2.5 text-sm transition-all hover:-translate-y-0.5 ${
            on(o.id) ? 'border-[var(--primary)] bg-[var(--primary)]/[0.07] text-[var(--text)]'
                     : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong,var(--line))] hover:text-[var(--text)]'}`}>
          {L(lang, o)}
          {on(o.id) && <Check size={13} className="absolute top-2 end-2 text-[var(--accent-ink)]" />}
        </button>
      ))}
    </div>
  );
}

/**
 * The brief the admin reads. Built from the answers rather than typed, so a request always
 * arrives with a scope, an audience, a budget band and a deadline — the four things a quote
 * needs and a free-text box rarely contains.
 */
export function buildBrief(a, kind, lang) {
  const pick = (list, id) => { const o = list.find((x) => x.id === id); return o ? L(lang, o) : id; };
  const fr = lang === 'fr';
  const lines = [];
  lines.push(`${fr ? 'Pour qui' : 'Audience'}: ${pick(TARGETS, a.target)}`);
  const sc = (a.scope || []).map((id) => pick(scopeFor(kind), id));
  lines.push(`${fr ? 'Périmètre' : 'Scope'}: ${sc.length ? sc.join(', ') : (fr ? 'à définir ensemble' : 'to be defined together')}`);
  if (a.scopeOther.trim()) lines.push(`${fr ? 'Autre' : 'Also'}: ${a.scopeOther.trim()}`);
  lines.push(`${fr ? 'Budget' : 'Budget'}: ${pick(BUDGETS, a.budget)}`);
  lines.push(`${fr ? 'Échéance' : 'Deadline'}: ${pick(DEADLINES, a.deadline)}`);
  if (a.refs.trim()) lines.push(`${fr ? 'Références' : 'References'}: ${a.refs.trim()}`);
  const notes = a.description.trim();
  return (lines.join('\n') + (notes ? `\n\n${fr ? 'Notes' : 'Notes'}:\n${notes}` : '')).slice(0, 2000);
}

export default function MyoIntakeWizard({ cards = [], cfg, onClose, inline = false, onNeedAuth }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const isFr = lang === 'fr';
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [a, setA] = useState({
    card: null,
    name: '', logo: '', objective: '', target: 'personal', scope: [], scopeOther: '',
    budget: 'unknown', deadline: 'flexible', refs: '', description: '', lang: isFr ? 'fr' : 'en',
  });
  // The chosen product card drives the scope checklist and what gets submitted. Until the first
  // question is answered there is no kind, so the catalogue's first entry stands in for the
  // shapes that depend on one.
  const chosen = cards.find((c) => c.key === a.card) || null;
  const kind = chosen?.kind || 'custom';
  const set = (k, v) => setA((s) => ({ ...s, [k]: v }));
  const toggle = (k, id) => setA((s) => ({ ...s, [k]: s[k].includes(id) ? s[k].filter((x) => x !== id) : [...s[k], id] }));

  const urgent = DEADLINES.find((d) => d.id === a.deadline)?.urgent === true;
  const fee = urgent ? cfg.urgentConsultationCents : cfg.consultationCents;
  const urgentBlocked = urgent && cfg.urgentAvailable === false;

  // One entry per question. `done` gates Next, `summary` is what the recap shows.
  const steps = useMemo(() => [
    {
      // FIRST, and it replaces the catalogue of cards this page used to open on. Choosing what
      // you want is a question like the others, not a gate in front of the questions — and it
      // is the one that decides which checklist the scope question shows.
      id: 'kind',
      q: t('myo.w.q.kind', 'What do you want built?'),
      hint: t('myo.w.h.kind', 'The closest match, the details are sorted out together.'),
      done: !!a.card,
      summary: chosen ? chosen.label : '',
      body: (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {cards.map((c) => {
            const on = a.card === c.key;
            const Ico = c.icon;
            return (
              <button key={c.key} type="button" onClick={() => { set('card', c.key); setI((v) => v + 1); }}
                className={`text-start rounded-xl border px-3 py-3 transition-all hover:-translate-y-0.5 ${
                  on ? 'border-[var(--primary)] bg-[var(--primary)]/[0.07]' : 'border-[var(--line)] hover:border-[var(--line-strong,var(--line))]'}`}>
                <span className="flex items-center gap-2">
                  {Ico ? <Ico size={16} className="text-[var(--accent-ink)] shrink-0" /> : null}
                  <span className="font-medium text-sm">{c.label}</span>
                  {on && <Check size={13} className="ms-auto text-[var(--accent-ink)]" />}
                </span>
                {c.blurb ? <span className="block text-[11.5px] text-[var(--muted)] mt-1 leading-relaxed">{c.blurb}</span> : null}
              </button>
            );
          })}
        </div>
      ),
    },
    {
      id: 'name',
      q: t('myo.w.q.name', 'What is it called?'),
      hint: t('myo.w.h.name', 'A working name is fine, it can change later.'),
      done: a.name.trim().length >= 2,
      summary: a.name.trim(),
      body: (
        <div className="space-y-3">
          <Input autoFocus value={a.name} maxLength={120} onChange={(e) => set('name', e.target.value)} placeholder={t('myo.f.nameph', 'e.g. My Community Bot')} />
          <label className="block">
            <span className="text-xs text-[var(--faint)]">{t('myo.f.logo', 'Logo URL (optional)')}</span>
            <Input className="mt-1" value={a.logo} maxLength={500} onChange={(e) => set('logo', e.target.value)} placeholder="https://…/logo.png" />
          </label>
        </div>
      ),
    },
    {
      id: 'objective',
      q: t('myo.w.q.obj', 'In one sentence, what should it accomplish?'),
      hint: t('myo.w.h.obj', 'The result you want, not how it works.'),
      done: a.objective.trim().length >= 4,
      summary: a.objective.trim(),
      body: <Input autoFocus value={a.objective} maxLength={200} onChange={(e) => set('objective', e.target.value)} placeholder={t('myo.f.objph', 'What should it accomplish?')} />,
    },
    {
      id: 'target',
      q: t('myo.w.q.target', 'Who is it for?'),
      hint: t('myo.w.h.target', 'It changes how much has to be bullet-proof.'),
      done: true,
      summary: L(lang, TARGETS.find((x) => x.id === a.target) || TARGETS[0]),
      body: <Tiles options={TARGETS} value={a.target} onPick={(id) => set('target', id)} lang={lang} />,
    },
    {
      id: 'scope',
      q: t('myo.w.q.scope', 'What should it do?'),
      hint: t('myo.w.h.scope', 'Pick everything that applies, nothing is binding, it is what the quote is priced against.'),
      done: true,
      summary: (a.scope.length ? a.scope.map((id) => L(lang, scopeFor(kind).find((x) => x.id === id) || { en: id, fr: id })).join(', ') : t('myo.w.tbd', 'to be defined together'))
        + (a.scopeOther.trim() ? ` · ${a.scopeOther.trim()}` : ''),
      body: (
        <div className="space-y-3">
          <Tiles options={scopeFor(kind)} value={a.scope} onPick={(id) => toggle('scope', id)} multi lang={lang} />
          <Input value={a.scopeOther} maxLength={200} onChange={(e) => set('scopeOther', e.target.value)} placeholder={t('myo.w.scopeOther', 'Something not in the list…')} />
        </div>
      ),
    },
    {
      id: 'budget',
      q: t('myo.w.q.budget', 'What budget do you have in mind?'),
      hint: t('myo.w.h.budget', "An honest range, in {cur}. “I don't know” is a real answer, the consultation is partly for this.").replace('{cur}', String(cfg.currency || '').toUpperCase()),
      done: true,
      summary: L(lang, BUDGETS.find((x) => x.id === a.budget) || BUDGETS[0]),
      body: <Tiles options={BUDGETS} value={a.budget} onPick={(id) => set('budget', id)} lang={lang} />,
    },
    {
      id: 'deadline',
      q: t('myo.w.q.deadline', 'When do you need it?'),
      hint: t('myo.w.h.deadline', 'Only the last option changes the consultation fee.'),
      done: !urgentBlocked,
      summary: L(lang, DEADLINES.find((x) => x.id === a.deadline) || DEADLINES[0]),
      body: (
        <div className="space-y-3">
          <Tiles options={DEADLINES} value={a.deadline} onPick={(id) => set('deadline', id)} lang={lang} cols="sm:grid-cols-4" />
          {urgent && (
            <div className={`text-xs rounded-lg p-2.5 flex items-start gap-2 border ${urgentBlocked ? 'border-[var(--warning)] text-[var(--warning)]' : 'border-[var(--line)] text-[var(--faint)]'}`}>
              <Clock size={13} className="shrink-0 mt-0.5" />
              <span>{urgentBlocked
                ? t('myo.f.urgentfull', 'All urgent slots are taken right now, a normal request can still start today.')
                : t('myo.f.urgentnote', 'Prioritised, a higher consultation fee ({p}).').replace('{p}', fmtMoney(cfg.urgentConsultationCents, cfg.currency))}</span>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'description',
      q: t('myo.w.q.more', 'Anything else worth knowing?'),
      hint: t('myo.w.h.more', 'Style, constraints, what already exists, links to things you like. Optional.'),
      done: true,
      summary: a.description.trim() || t('myo.w.none', 'nothing added'),
      body: (
        <div className="space-y-3">
          <Textarea rows={5} value={a.description} onChange={(e) => set('description', e.target.value.slice(0, 1400))} placeholder={t('myo.f.descph', 'Features, style, references, deadline, anything useful…')} />
          <Input value={a.refs} maxLength={300} onChange={(e) => set('refs', e.target.value)} placeholder={t('myo.w.refs', 'Links to references (optional)')} />
          <div className="flex items-center gap-2 text-xs text-[var(--faint)]">
            <span>{t('myo.f.lang', 'Reply language')}</span>
            {['en', 'fr'].map((lg) => (
              <button key={lg} type="button" onClick={() => set('lang', lg)}
                className={`px-2.5 py-1 rounded-lg border text-xs ${a.lang === lg ? 'border-[var(--primary)] text-[var(--text)]' : 'border-[var(--line)]'}`}>{lg === 'fr' ? 'Français' : 'English'}</button>
            ))}
          </div>
        </div>
      ),
    },
  ], [a, lang, cfg, cards, chosen, kind, urgent, urgentBlocked, t]);

  const last = i >= steps.length;      // the recap sits one past the questions
  const step = steps[Math.min(i, steps.length - 1)];
  const pct = Math.round(((last ? steps.length : i) / steps.length) * 100);

  const submit = async () => {
    // Sign-in is asked for HERE, not at the door. The page used to bounce a signed-out visitor
    // to /auth the moment they picked a card — before a single question, with nothing yet
    // invested. Answering first and signing in to pay is the order that respects the work
    // already done.
    if (onNeedAuth && onNeedAuth()) return;
    setBusy(true);
    try {
      const res = await api.post('/myo/requests', {
        productId: chosen?.id || null, productKind: kind,
        name: a.name.trim(), logo: a.logo.trim() || null, objective: a.objective.trim(),
        target: a.target, description: buildBrief(a, kind, a.lang), lang: a.lang, urgent,
      });
      if (res?.checkoutUrl) { window.location.href = res.checkoutUrl; return; }
      toast.error(t('myo.e.pay', 'Could not start checkout.')); setBusy(false);
    } catch (x) {
      const e = x.data?.error;
      toast.error(
        e === 'myo_disabled' ? t('myo.off.t', 'Not accepting requests right now')
        : e === 'stripe_unconfigured' ? t('myo.e.stripe', 'Payments are not configured yet.')
        : e === 'urgent_full' ? t('myo.e.urgentfull', 'Every urgent slot is taken. Untick "urgent" to start now, or try again later.')
        : e === 'queue_full' ? t('myo.e.queuefull', 'The commission queue is full right now, please try again in a few days.')
        : e === 'too_many_own' ? t('myo.e.ownfull', 'You already have {n} request(s) open. Finish or close one first.').replace('{n}', x.data?.limit ?? '')
        : t('myo.e.pay', 'Could not start checkout.'));
      setBusy(false);
    }
  };

  const Icon = chosen?.icon;
  const foot = (
        <>
          <Button variant="ghost" disabled={i === 0 && !onClose} onClick={() => (i === 0 ? onClose?.() : setI((v) => v - 1))}>
            {i === 0 ? t('common.cancel', 'Cancel') : <><ArrowLeft size={15} /> {t('myo.w.back', 'Back')}</>}
          </Button>
          {last
            ? <Button variant="primary" disabled={busy || cfg.queueFull || urgentBlocked} onClick={submit}>
                {busy ? <Spinner /> : <><CreditCard size={15} /> {t('myo.intake.pay', 'Pay {p} & start').replace('{p}', fmtMoney(fee, cfg.currency))}</>}
              </Button>
            : <Button variant="primary" disabled={!step.done} onClick={() => setI((v) => v + 1)}>
                {t('myo.w.next', 'Next')} <ArrowRight size={15} />
              </Button>}
        </>
  );

  // The same wizard, two shells: a card ON the page (this is what /myo opens on now) or the
  // modal it used to be, kept for anywhere that still opens it over something else.
  const inner = (<>
      {/* Progress: which of the N questions, and how far along. */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-[11px] text-[var(--faint)] mb-1.5">
          <span>{last ? t('myo.w.recap', 'Your brief') : t('myo.w.step', 'Question {n} of {m}').replace('{n}', i + 1).replace('{m}', steps.length)}</span>
          <span>{pct}%</span>
        </div>
        <div className="h-1 rounded-full bg-[var(--surface-2)] overflow-hidden">
          <div className="h-full rounded-full bg-[var(--primary)] transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {cfg.queueFull && (
        <div className="text-xs rounded-lg p-2.5 mb-3 flex items-start gap-2 border border-[var(--warning)] text-[var(--warning)]">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>{t('myo.queuefull.note', 'The queue is full right now, so new requests are not being taken. Nothing is lost if you write your brief — but the payment button stays off until a slot frees up.')}</span>
        </div>
      )}

      {!last ? (
        <div className="space-y-3">
          <div>
            <h3 className="text-[17px] font-semibold leading-snug m-0">{step.q}</h3>
            {step.hint && <p className="text-xs text-[var(--faint)] mt-1 mb-0 leading-relaxed">{step.hint}</p>}
          </div>
          {step.body}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-[var(--line)] divide-y divide-[var(--line)]">
            {steps.map((s, n) => (
              <button key={s.id} type="button" onClick={() => setI(n)}
                className="w-full text-start px-3 py-2.5 flex items-start gap-3 hover:bg-[var(--surface-2)] transition-colors group">
                <span className="text-[11px] text-[var(--faint)] w-40 shrink-0 pt-0.5">{s.q}</span>
                <span className="flex-1 text-sm min-w-0 break-words">{s.summary || <span className="text-[var(--faint)]">—</span>}</span>
                <Pencil size={12} className="shrink-0 mt-1 text-[var(--faint)] opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
          </div>
          {/* What the fee buys, said before the button rather than on it. */}
          <div className="text-xs text-[var(--faint)] flex items-start gap-2 bg-[var(--surface-2)] rounded-lg p-2.5">
            <AlertTriangle size={13} className="shrink-0 mt-0.5 text-warning" />
            <span>{t('myo.intake.note2', 'You are paying {p} for a consultation: your brief is read, you get advice on it, and you get a quote. It is not the price of the product — building starts once you approve that quote.').replace('{p}', fmtMoney(fee, cfg.currency))}</span>
          </div>
          <div className="text-[11px] text-[var(--faint)] text-center pt-1">
            {t('myo.intake.legalpre', 'By paying you accept our')}{' '}
            <Link to="/legal/terms" className="underline hover:text-[var(--text)]">{t('foot.terms', 'Terms')}</Link>
            {' · '}
            <Link to="/legal/refunds" className="underline hover:text-[var(--text)]">{t('foot.refunds', 'Payments & Refunds')}</Link>
          </div>
        </div>
      )}
  </>);

  if (inline) {
    return (
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6 max-w-2xl mx-auto">
        {inner}
        <div className="flex items-center justify-between gap-2 mt-5 pt-4 border-t border-[var(--line)]">{foot}</div>
      </div>
    );
  }
  return (
    <Modal open onClose={onClose} title={t('myo.intake.title', 'Start a request')} icon={Icon} width="max-w-xl" footer={foot}>
      {inner}
    </Modal>
  );
}
