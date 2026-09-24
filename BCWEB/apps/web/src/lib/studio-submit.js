// Sending a studio block's `submit` step (PLAN-STUDIO-2026 2.5, phase 5), and the confirmation
// some of them need first.
//
// Pure (no React), so the rule is tested under plain node (test/studio-actions.test.mjs). The
// executor (ui/canvas-actions.jsx) draws the dialogs and calls these; it builds no request of
// its own.
//
// WHY A CONFIRMATION (owner decision after phase 5). `poll.vote` votes with the CLICKER's
// session, and the button's words are the author's: a button labelled "Continue" could cast a
// vote the visitor never meant to. So an entry of the registry that carries `confirm` is sent
// only after the visitor has seen, and accepted, what it does: the poll's question and the
// chosen options, as the SERVER names them (its public GET), never as the author labelled them.
//
// Two locks, either of which holds on its own:
//   · `runSubmit` asks (`ask`) and sends only on a yes; Cancel sends nothing;
//   · `sendSubmit` itself refuses such an entry unless the caller says it was confirmed, so a
//     future code path that calls it directly still cannot vote silently.
import { SUBMIT_REGISTRY, submitRequest, submitNeedsConfirm, submitConfirmUrl } from './canvas.js';

export { submitNeedsConfirm };

/**
 * Send one submit step: the request `submitRequest` builds, nothing else. Resolves
 * `{ ok, error }`; never throws. `ctx.confirmed` must be true for an entry that needs the
 * visitor's confirmation, or nothing is sent (`confirm_required`).
 */
export async function sendSubmit(step, visitor, ctx = {}) {
  const entry = Object.prototype.hasOwnProperty.call(SUBMIT_REGISTRY, step?.endpoint) ? SUBMIT_REGISTRY[step.endpoint] : null;
  if (!entry) return { ok: false, error: 'unknown_endpoint' };
  if (entry.confirm && ctx.confirmed !== true) return { ok: false, error: 'confirm_required' };
  const doFetch = ctx.fetch || globalThis.fetch;
  let pow = null;
  try {
    const first = submitRequest(step.endpoint, step.fields || {}, visitor, ctx);
    if (!first.ok) return { ok: false, error: first.reason, field: first.field };
    if (entry.pow) {
      const { solvePow } = await import('./pow.js');
      pow = await solvePow(async () => {
        const r = await doFetch(entry.pow, { credentials: 'include', headers: { accept: 'application/json' } });
        return r.json();
      });
    }
    const req = submitRequest(step.endpoint, step.fields || {}, visitor, { ...ctx, pow });
    if (!req.ok) return { ok: false, error: req.reason, field: req.field };
    const res = await doFetch(req.url, {
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

/**
 * A submit with no visitor field, through its confirmation when the registry asks for one.
 *
 * `ask(step)` resolves true (the visitor confirmed) or false (cancelled, closed, Escape).
 * Nothing is sent before it has resolved true; a cancel resolves `{ ok: false, error:
 * 'cancelled' }` with no request made. `send` is sendSubmit (a parameter for the tests).
 */
export async function runSubmit(step, { ask, send = sendSubmit, ctx = {} } = {}) {
  if (!submitNeedsConfirm(step?.endpoint)) return send(step, {}, ctx);
  const yes = typeof ask === 'function' ? await ask(step) : false;
  if (yes !== true) return { ok: false, error: 'cancelled' };
  return send(step, {}, { ...ctx, confirmed: true });
}

/**
 * What a vote confirmation shows: the poll's question and the chosen options, read from the
 * poll's public GET (the registry's `confirm.read`). An option id the poll does not have is
 * listed as unknown, and `ok` is false then (the dialog does not offer to vote for it).
 * Resolves `{ ok, question, options: [{ id, label, known }], open, error }`; never throws.
 */
export async function loadVoteSummary(step, { fetch: doFetch = globalThis.fetch } = {}) {
  const url = submitConfirmUrl(step?.endpoint, step?.fields);
  const ids = Array.isArray(step?.fields?.optionIds) ? [...new Set(step.fields.optionIds)] : [];
  if (!url) return { ok: false, question: '', options: [], open: false, error: 'bad_step' };
  try {
    const res = await doFetch(url, { credentials: 'include', headers: { accept: 'application/json' } });
    if (!res.ok) return { ok: false, question: '', options: [], open: false, error: res.status === 404 ? 'not_found' : 'load_failed' };
    const poll = await res.json();
    const byId = new Map((Array.isArray(poll?.options) ? poll.options : []).map((o) => [o?.id, String(o?.label ?? '')]));
    const options = ids.map((id) => ({ id, label: byId.get(id) || '', known: byId.has(id) }));
    const question = String(poll?.question || '').slice(0, 500);
    const open = poll?.open !== false;
    return { ok: !!question && options.length > 0 && options.every((o) => o.known) && open, question, options, open, error: '' };
  } catch {
    return { ok: false, question: '', options: [], open: false, error: 'load_failed' };
  }
}
