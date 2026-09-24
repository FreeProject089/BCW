// The executor of studio block actions (PLAN-STUDIO-2026 2.5, phase 5).
//
// What a block DOES is decided in the studio package (packages/studio/src/actions.js): the
// vocabulary, the link policy, the submit registry and `planAction`, which turns stored steps
// into a plan: a link, a button, or inert with a reason. This file only carries the plan out,
// and it never builds a URL or a request of its own:
//
//   · a plan of kind `link` is a REAL `<a href>` (middle click, "open in new tab", screen
//     readers). An internal one is followed inside the app on a plain click; `external` opens
//     in a new tab with rel="noopener noreferrer", behind a "you are leaving" screen that names
//     the host (decision D7) and re-checks the site's link policy before it offers to go on;
//   · a plan of kind `button` is a `<button type="button">` (focusable, Enter and Space);
//   · an inert plan runs nothing and says why (`data-inert`), which the editor shows in red.
//
// The steps before the last run in order, synchronously where they can (scroll, reveal, theme,
// copy starts inside the click so the clipboard accepts it). `submit` sends exactly the
// request `submitRequest` builds from a SUBMIT_REGISTRY entry, and nothing else: that is the
// only `fetch` a click on a studio block can make (plus the entry's own proof-of-work
// challenge, which the registry names).
//
// A text block's OWN links win over the block's action: the block's action is a cover under
// the text's links (see `.cv-act` / `.cv-actionable` in index.css), never an anchor around
// them, so a click on an inline link follows that link and a click anywhere else runs the
// block. Nested anchors would be invalid HTML and would give the browser the choice.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { UNSAFE_NavigationContext } from 'react-router-dom';
import { ExternalLink, Send } from 'lucide-react';
import { Modal, Button, Input, Textarea, Field, copyText } from './ui.jsx';
import { useTheme } from './theme.jsx';
import { useI18n } from '../i18n.jsx';
import { SUBMIT_REGISTRY, submitRequest, hostAllowed, planAction } from '../lib/canvas.js';
import { useStudioLinks, loadStudioLinks } from '../lib/studio-links.js';

const Ctx = createContext(null);
/** The executor of the canvas this block is drawn in (null in the editor's own board). */
export const useCanvasActions = () => useContext(Ctx);

const reducedMotion = () => {
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/** Is this a plain left click, the only one we take over? Modifier and middle clicks keep the
 *  browser's own meaning (new tab, new window, download). */
const plainClick = (e) => !(e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);

/**
 * The executor for one canvas. `blocks` are the normalised blocks of the page (every one, the
 * hidden ones included: a scroll or reveal may name any of them); `rootRef` is the canvas root,
 * where a scroll target is looked up by its `data-cvb` name, never by a selector.
 *
 * `preview`: the editor's modal preview. Steps that stay on the page run; a navigation does not
 * leave the studio (the author would lose the page they are drawing).
 */
export function CanvasActions({ blocks, rootRef, preview = false, children }) {
  const i18n = useI18n();
  const t = i18n?.t || ((_k, f) => f);
  const lang = i18n?.lang || 'en';
  const links = useStudioLinks();
  const theme = useTheme();
  const nav = useContext(UNSAFE_NavigationContext)?.navigator || null;
  const [shown, setShown] = useState({});
  const [leaving, setLeaving] = useState(null);
  const [form, setForm] = useState(null);
  const blockIds = useMemo(() => new Set((blocks || []).map((b) => b.id)), [blocks]);
  const hiddenAtLoad = useMemo(() => new Map((blocks || []).map((b) => [b.id, !!b.hidden])), [blocks]);

  // Visible NOW: what a reveal step set, else what the block says at load (`hidden`, which a
  // theme overlay may also set, so the caller passes the drawn block's own value).
  const isShown = useCallback((id, hidden) => (id in shown ? shown[id] : !hidden), [shown]);

  const scrollTo = useCallback((target) => {
    const behavior = reducedMotion() ? 'auto' : 'smooth';
    if (target === '#top') { try { window.scrollTo({ top: 0, behavior }); } catch { /* old engine */ } return; }
    // Looked up by NAME among this canvas's own blocks: never a selector, never another page's.
    const root = rootRef?.current;
    const el = root ? [...root.querySelectorAll('[data-cvb]')].find((n) => n.getAttribute('data-cvb') === target) : null;
    el?.scrollIntoView?.({ behavior, block: 'start' });
  }, [rootRef]);

  /** The steps that stay on the page. `feedback(kind)` shows a short state on the block. */
  const runLocal = useCallback((steps, feedback) => {
    for (const s of steps) {
      if (s.type === 'scroll') scrollTo(s.target);
      else if (s.type === 'reveal') {
        setShown((cur) => {
          const now = s.target in cur ? cur[s.target] : !hiddenAtLoad.get(s.target);
          const next = s.mode === 'show' ? true : s.mode === 'hide' ? false : !now;
          return { ...cur, [s.target]: next };
        });
      } else if (s.type === 'theme') {
        if (theme && (s.mode === 'toggle' || theme.theme !== s.mode)) theme.toggle();
      } else if (s.type === 'copy') {
        // Started inside the click: the clipboard only accepts a write from a user gesture.
        copyText(String(s.text || '')).then((ok) => feedback?.(ok ? 'copied' : 'error'));
      }
    }
  }, [scrollTo, hiddenAtLoad, theme]);

  /**
   * A click (or Enter / Space) on an actionable block. `plan` comes from planAction.
   */
  const activate = useCallback((e, plan, feedback) => {
    if (!plan || plan.kind === 'none') return;
    if (plan.kind === 'inert') { e.preventDefault(); return; }
    const plain = plainClick(e);
    if (plan.kind === 'link') {
      // A modifier or middle click is the READER's decision (a new tab, a download): the
      // anchor does it, and the steps before the link are not run for a page left open behind.
      if (!plain) return;
      runLocal(plan.steps, feedback);
      if (preview) { e.preventDefault(); feedback?.('preview'); return; }
      if (plan.external) { e.preventDefault(); setLeaving({ href: plan.href, host: plan.host }); return; }
      if (plan.internal && nav) { e.preventDefault(); nav.push(plan.href); return; }
      return; // mailto, download: the anchor does it
    }
    e.preventDefault();
    runLocal(plan.steps, feedback);
    if (plan.last?.type === 'submit') {
      const entry = SUBMIT_REGISTRY[plan.last.endpoint];
      if (preview) { feedback?.('preview'); return; }
      if (entry && Object.keys(entry.visitor).length) setForm({ step: plan.last, feedback });
      else sendSubmit(plan.last, {}, { lang }).then((r) => feedback?.(r.ok ? 'sent' : 'error'));
    }
  }, [runLocal, preview, nav, lang]);

  const plan = useCallback((steps) => planAction(steps, { links, blockIds }), [links, blockIds]);

  const value = useMemo(() => ({ activate, plan, isShown, t }), [activate, plan, isShown, t]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <LeavingDialog leaving={leaving} onClose={() => setLeaving(null)} t={t} />
      <SubmitDialog form={form} onClose={() => setForm(null)} t={t} lang={lang} />
    </Ctx.Provider>
  );
}

/**
 * Send one submit step: the request `submitRequest` builds, nothing else. Resolves
 * `{ ok, error }`; never throws.
 */
export async function sendSubmit(step, visitor, ctx = {}) {
  const entry = SUBMIT_REGISTRY[step?.endpoint];
  if (!entry) return { ok: false, error: 'unknown_endpoint' };
  let pow = null;
  try {
    const first = submitRequest(step.endpoint, step.fields || {}, visitor, ctx);
    if (!first.ok) return { ok: false, error: first.reason, field: first.field };
    if (entry.pow) {
      const { solvePow } = await import('../lib/pow.js');
      pow = await solvePow(async () => {
        const r = await fetch(entry.pow, { credentials: 'include', headers: { accept: 'application/json' } });
        return r.json();
      });
    }
    const req = submitRequest(step.endpoint, step.fields || {}, visitor, { ...ctx, pow });
    if (!req.ok) return { ok: false, error: req.reason, field: req.field };
    const res = await fetch(req.url, {
      method: req.method, credentials: 'include',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(req.body),
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: String(data?.error || res.status) };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** Visitor-facing words for what a submit can answer. Literal keys, so i18n-check sees them. */
function submitError(t, code) {
  switch (code) {
    case 'rate_limited': case 'daily_limit': return t('cv.submit.err.rate', 'Too many attempts. Try again in a few minutes.');
    case 'invalid_email': case 'email_required': return t('cv.submit.err.email', 'This e-mail address is not valid.');
    case 'sign_in_required': return t('cv.submit.err.signin', 'Sign in to do this.');
    case 'closed': return t('cv.submit.err.closed', 'This poll is closed.');
    case 'disabled': case 'project_contact_off': return t('cv.submit.err.off', 'This form is switched off for now.');
    case 'required': case 'too_short': case 'too_long': case 'bad_value': return t('cv.submit.err.field', 'Check the highlighted field.');
    default: return t('cv.submit.err.other', 'That did not work. Try again later.');
  }
}

/** Labels of the visitor fields a registry entry asks for. */
function fieldLabel(t, name) {
  switch (name) {
    case 'email': return t('cv.submit.f.email', 'E-mail address');
    case 'subject': return t('cv.submit.f.subject', 'Subject');
    case 'body': return t('cv.submit.f.body', 'Message');
    case 'name': return t('cv.submit.f.name', 'Name (optional)');
    default: return name;
  }
}
function submitTitle(t, key) {
  switch (key) {
    case 'newsletter.subscribe': return t('cv.submit.t.newsletter', 'Subscribe to the newsletter');
    case 'project.contact': return t('cv.submit.t.contact', 'Contact the project');
    default: return t('cv.submit.t.other', 'Send');
  }
}
function submitNote(t, key) {
  switch (key) {
    case 'newsletter.subscribe': return t('cv.submit.n.newsletter', 'We send a confirmation e-mail first. Nothing else arrives until you confirm, and every letter has an unsubscribe link.');
    case 'project.contact': return t('cv.submit.n.contact', 'Your message goes to the people who run this project. Signed out, add your e-mail so they can answer.');
    default: return '';
  }
}

/** The small fixed form a submit with visitor fields opens. Fields come from the registry. */
function SubmitDialog({ form, onClose, t, lang }) {
  const [values, setValues] = useState({});
  const [state, setState] = useState({ busy: false, error: '', field: '', done: false });
  const key = form?.step?.endpoint;
  const entry = key ? SUBMIT_REGISTRY[key] : null;
  const close = () => { setValues({}); setState({ busy: false, error: '', field: '', done: false }); onClose(); };
  const send = async (e) => {
    e.preventDefault();
    setState((s) => ({ ...s, busy: true, error: '', field: '' }));
    const r = await sendSubmit(form.step, values, { lang });
    if (r.ok) { setState({ busy: false, error: '', field: '', done: true }); form.feedback?.('sent'); }
    else setState({ busy: false, error: submitError(t, r.error), field: r.field || '', done: false });
  };
  return (
    <Modal open={!!entry} onClose={close} title={entry ? submitTitle(t, key) : ''} icon={Send}>
      {entry && (state.done ? (
        <div className="space-y-3" role="status">
          <p className="text-sm">{key === 'newsletter.subscribe' ? t('cv.submit.done.newsletter', 'Almost there: check your inbox to confirm.') : t('cv.submit.done', 'Sent. Thank you.')}</p>
          <div className="flex justify-end"><Button variant="primary" onClick={close}>{t('common.close2', 'Close')}</Button></div>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={send} data-submit-form={key}>
          {Object.entries(entry.visitor).map(([name, spec]) => {
            const Tag = spec.multiline ? Textarea : Input;
            return (
              <Field key={name} label={fieldLabel(t, name)}>
                <Tag name={name} rows={spec.multiline ? 5 : undefined} type={spec.kind === 'email' ? 'email' : 'text'}
                  required={!!spec.required} maxLength={spec.max || undefined} value={values[name] || ''}
                  aria-invalid={state.field === name || undefined}
                  onChange={(ev) => setValues((v) => ({ ...v, [name]: ev.target.value }))} />
              </Field>
            );
          })}
          {submitNote(t, key) && <p className="text-[12px] text-[var(--muted)]">{submitNote(t, key)}</p>}
          {state.error && <p className="text-[12px] text-error" role="alert">{state.error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>{t('common.cancel', 'Cancel')}</Button>
            <Button type="submit" variant="primary" loading={state.busy}><Send size={14} /> {t('cv.submit.send', 'Send')}</Button>
          </div>
        </form>
      ))}
    </Modal>
  );
}

/** "You are leaving BetterCommunity" (decision D7): the host, in full, and a real link on. */
function LeavingDialog({ leaving, onClose, t }) {
  const [blocked, setBlocked] = useState(false);
  // The policy may have arrived (or changed) since the page was drawn: asked again here.
  const host = leaving?.host || '';
  useEffect(() => {
    if (!host) return undefined;
    let alive = true;
    loadStudioLinks().then((p) => { if (alive) setBlocked(!hostAllowed(host, p)); });
    return () => { alive = false; };
  }, [host]);
  const close = () => { setBlocked(false); onClose(); };
  return (
    <Modal open={!!leaving} onClose={close} title={t('cv.leave.title', 'You are leaving BetterCommunity')} icon={ExternalLink}>
      {leaving && (
        <div className="space-y-3" data-leaving={leaving.host}>
          {blocked ? (
            <p className="text-sm text-error" role="alert">{t('cv.leave.blocked', 'This site blocks links to {host}.').replace('{host}', leaving.host)}</p>
          ) : (<>
            <p className="text-sm">{t('cv.leave.body', 'This link opens another site, in a new tab:')}</p>
            <p className="text-base font-semibold break-all" translate="no">{leaving.host}</p>
            <p className="text-[12px] text-[var(--muted)] break-all" translate="no">{leaving.href}</p>
          </>)}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>{t('common.cancel', 'Cancel')}</Button>
            {!blocked && (
              <a className="btn btn-primary" href={leaving.href} target="_blank" rel="noopener noreferrer" onClick={close}>
                <ExternalLink size={14} /> {t('cv.leave.go', 'Continue to {host}').replace('{host}', leaving.host)}
              </a>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Words for the short state a block shows after it ran. */
export function feedbackText(t, kind, doneLabel) {
  switch (kind) {
    case 'copied': return doneLabel || t('cv.fb.copied', 'Copied');
    case 'sent': return doneLabel || t('cv.fb.sent', 'Sent');
    case 'preview': return t('cv.fb.preview', 'Links stay put in the preview');
    case 'error': return t('cv.fb.error', 'That did not work');
    default: return '';
  }
}

/** A short-lived state (copied, sent, error), cleared after a moment. */
export function useFeedback() {
  const [fb, setFb] = useState('');
  const timer = useRef(0);
  const show = useCallback((kind) => {
    setFb(kind);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setFb(''), 1800);
  }, []);
  return [fb, show];
}

/** Anchor or button attributes for a plan: shared by the cover and the button block. */
export function planAttrs(plan) {
  if (plan.kind === 'link') {
    return {
      Tag: 'a',
      attrs: {
        href: plan.href,
        ...(plan.external ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
        ...(plan.download ? { download: '' } : {}),
        'data-act': plan.last?.type || 'link',
      },
    };
  }
  if (plan.kind === 'button') return { Tag: 'button', attrs: { type: 'button', 'data-act': plan.last?.type || 'button' } };
  return { Tag: 'span', attrs: { role: 'button', 'aria-disabled': 'true', tabIndex: -1, 'data-inert': plan.reason || 'inert' } };
}

/**
 * The clickable layer over a block that is not a button block: a real link or a real button,
 * covering the block, under the block's own interactive content (a text block's links).
 */
export function ActionCover({ plan, label, doneLabel }) {
  const ex = useCanvasActions();
  const [fb, show] = useFeedback();
  if (!ex || !plan || plan.kind === 'none') return null;
  const { Tag, attrs } = planAttrs(plan);
  return (
    <Tag {...attrs} className="cv-act" aria-label={label || undefined} onClick={(e) => ex.activate(e, plan, show)}>
      {fb && <span className="cv-act-fb" role="status">{feedbackText(ex.t, fb, doneLabel)}</span>}
    </Tag>
  );
}
