// The shell the two content-authoring modals share: a docs page and a blog post.
//
// They do the same job — a bilingual title, a bilingual body, a handful of settings, Save —
// and they had drifted into two different screens. Same merge banner written twice, same
// language tabs written twice, one of them putting its fields in a four-column grid and the
// other in a flat scroll, and both of them piling seven controls into the modal footer, which
// on a phone wraps into a block taller than the content it belongs to.
//
// Three things live here because they are rules rather than layout, and a rule written twice
// diverges the first time it changes:
//
//   • Closing never discards silently. `Modal` closes on Escape, on the × and on a click
//     anywhere in the backdrop — three ways to lose an afternoon's writing to a stray click,
//     with no question asked. `useCloseGuard` asks, and only when there is something to lose.
//   • A save in flight owns the modal. While it runs the fields are disabled (a native
//     `<fieldset disabled>`, so it needs no bookkeeping) and neither Escape nor the backdrop
//     closes anything — the old code left the form editable under a spinner and the dialog
//     dismissable out from under its own request.
//   • The card is clamped to the VISIBLE viewport, not to `92vh`. On a phone those are not
//     the same number: browser chrome and the on-screen keyboard both eat into the visual
//     viewport while `vh` keeps reporting the tall value, which is exactly how a Save button
//     ends up below the fold on the one device where scrolling to it is hardest.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, GitMerge, Languages, X } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { Button, Field, Modal, Spinner, useDialog } from './ui.jsx';

/** The guarded close, for anything the caller renders inside the modal (its footer included). */
const EntryCtx = createContext(null);
export const useEntryClose = () => useContext(EntryCtx);

/**
 * Has the form changed since it was last known-saved?
 *
 * A flag set by every onChange is wrong twice: it stays on after you undo your edit by hand,
 * and it turns on by itself while the editor seeds itself from the server (both of these
 * editors fetch the full body AFTER opening). A guard that fires on a form nobody touched
 * teaches people to click "Discard", which is the opposite of the point.
 *
 * So: compare against a snapshot, and let the caller re-take the snapshot by bumping `seed`
 * once its asynchronous seeding has landed.
 */
export function useDirtyForm(value, seed = 0) {
  const snap = useRef(null);
  const seedRef = useRef(seed);
  const json = JSON.stringify(value);
  if (snap.current === null) snap.current = json;
  // React 18 batches the `setF` and the seed bump that follow one another in a `.then`, so by
  // the time this runs `value` is already the seeded form.
  if (seedRef.current !== seed) { seedRef.current = seed; snap.current = json; }
  return json !== snap.current;
}

/**
 * `onClose` that asks before throwing work away, and refuses while a save is in flight.
 * Returned identity is stable enough for `Modal`, which keeps its own ref of it.
 */
export function useCloseGuard({ dirty, busy, onClose, message }) {
  const dialog = useDialog();
  const { t } = useI18n();
  // Escape repeats while held, and the backdrop is one big click target: without this a second
  // dismiss stacks a second confirmation on top of the first.
  const asking = useRef(false);
  return useCallback(async () => {
    if (busy) return;
    if (!dirty) { onClose(); return; }
    if (asking.current) return;
    asking.current = true;
    const ok = await dialog.confirm({
      title: t('ent.leave.t', 'Leave without saving?'),
      message: message || t('ent.leave.m', 'What you wrote has not been saved yet, and closing loses it.'),
      okLabel: t('ent.leave.ok', 'Discard changes'),
      cancelLabel: t('ent.leave.cancel', 'Keep editing'),
      danger: true,
    });
    asking.current = false;
    if (ok) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, busy, onClose, message]);
}

/**
 * The authoring modal itself.
 *
 * `dirty`/`busy` drive the close guard and the disabled state; everything else is `Modal`'s.
 * `onSave` is wired to Ctrl/⌘+S as well as the footer button — a long writing session should
 * not need the mouse to reach the one control that keeps the work.
 */
export function EntryModal({ title, icon, width = 'max-w-3xl', dirty, busy, onClose, onSave, footer, children }) {
  const close = useCloseGuard({ dirty, busy, onClose });
  const fitRef = useRef(null);

  // A reload takes unsaved work as quietly as a stray click did, and the browser's own prompt
  // is the only thing that can stop it.
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!onSave) return undefined;
    const onKey = (e) => {
      if (!(e.key === 's' && (e.ctrlKey || e.metaKey))) return;
      e.preventDefault();
      if (!busy) onSave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSave, busy]);

  // Clamp the card to what the reader can actually SEE, and keep it inside that band.
  //
  // `Modal` sizes its card with `max-h-[92vh]` and centres it in the layout viewport. On a
  // phone the layout viewport includes the space under the browser's own chrome, and when the
  // keyboard opens it includes the keyboard too — so a centred card that is "92vh tall" has
  // its footer, and therefore Save, somewhere under all of that. `visualViewport` is the only
  // thing that reports the visible band, so the height comes from there, and the extra bottom
  // margin re-centres the card inside it (a margin shifts a `place-items-center` grid item by
  // half its size, hence the doubling).
  //
  // Reaching for the card through `closest` rather than owning it: the card belongs to
  // `Modal`, and this is a correction to it, not a second copy of it. If that class ever goes
  // away this quietly does nothing rather than breaking the dialog.
  useEffect(() => {
    const card = fitRef.current?.closest('.modal-card');
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!card) return undefined;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const h = Math.min(window.innerHeight, vv?.height || window.innerHeight);
      card.style.maxHeight = `${Math.round(h * 0.92)}px`;
      // How far the visible band's centre sits above the layout viewport's centre.
      const shift = Math.round(window.innerHeight / 2 - ((vv?.offsetTop || 0) + h / 2));
      card.style.marginBottom = shift > 8 ? `${shift * 2}px` : '';
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };
    apply();
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      card.style.maxHeight = '';
      card.style.marginBottom = '';
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  return (
    // The guarded close is published rather than passed around: the footer is built by the
    // caller and rendered by `Modal`, so "Cancel" would otherwise get the RAW onClose and be
    // the one dismissal out of four that still threw the draft away.
    <EntryCtx.Provider value={close}>
      <Modal open onClose={close} title={title} icon={icon} width={width} footer={footer}>
        {/* `fieldset disabled` is the whole "a save in flight owns the form" rule: no per-field
            bookkeeping, and it covers controls added later by whoever edits this next. */}
        <fieldset ref={fitRef} disabled={busy || undefined} aria-busy={busy || undefined}
          className="min-w-0 m-0 p-0 border-0 disabled:opacity-60 transition-opacity">
          {children}
        </fieldset>
      </Modal>
    </EntryCtx.Provider>
  );
}

/**
 * The footer row, in the order a thumb reaches it.
 *
 * On a phone the two buttons are a full-width pair at the bottom of the sheet, with whatever
 * toggles the caller passes stacked above them; from `sm` it is the usual right-aligned row.
 * Secondary actions (History, Comments, Delete) deliberately do NOT belong here — they live
 * at the top of the body, where they cannot push Save off the screen.
 */
export function EntryActions({ busy, onCancel, onSave, saveLabel, savingLabel, toggles }) {
  const { t } = useI18n();
  const guarded = useEntryClose();
  const cancel = onCancel || guarded;
  return (
    <div className="w-full flex flex-col sm:flex-row sm:items-center gap-2.5">
      {toggles && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:me-auto">{toggles}</div>}
      <div className="flex gap-2 sm:ms-auto">
        <Button variant="ghost" className="flex-1 sm:flex-none justify-center" onClick={cancel} disabled={busy}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button variant="primary" className="flex-1 sm:flex-none justify-center" onClick={onSave} disabled={busy}>
          {busy ? <><Spinner /> {savingLabel || t('ent.saving', 'Saving…')}</> : saveLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * A group of fields that is not on the common path.
 *
 * `<details>` rather than state: the browser's own disclosure keeps the content in the
 * document (find-in-page and printing still reach it), costs one line when closed whatever is
 * inside, and needs no JavaScript. `summary` names the group, `status` is the one-line answer
 * to "do I need to open this" — the value that is set in there, so nobody opens four panels
 * looking for the category.
 */
export function EntrySection({ icon: Icon, title, status, defaultOpen = false, children }) {
  return (
    <details open={defaultOpen} className="group mt-3 rounded-xl border border-[var(--line)] panel">
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none flex items-center gap-2 px-3.5 py-2.5 rounded-xl">
        <ChevronDown size={14} className="shrink-0 text-[var(--faint)] -rotate-90 group-open:rotate-0 transition-transform" />
        {Icon && <Icon size={15} className="shrink-0 text-[var(--accent-ink)]" />}
        <span className="text-sm font-medium">{title}</span>
        {status && <span className="ms-auto text-xs text-[var(--muted)] truncate max-w-[45%] text-end" title={status}>{status}</span>}
      </summary>
      <div className="px-3.5 pb-3.5 pt-1 space-y-3">{children}</div>
    </details>
  );
}

/** The message under the field it is about, rather than in a toast that is gone in four seconds. */
export function FieldError({ children }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-1.5 text-xs text-error flex items-start gap-1.5">
      <AlertCircle size={13} className="shrink-0 mt-px" /> <span>{children}</span>
    </p>
  );
}

/** `Field` plus the error slot, so a validation message never has to travel to a toast. */
export function EntryField({ label, hint, error, children, className = '' }) {
  return (
    <Field label={label} hint={hint} className={className}>
      {children}
      <FieldError>{error}</FieldError>
    </Field>
  );
}

/**
 * English (base) / French tabs. `state` is 'empty' | 'partial' | 'full` for the FR side, which
 * is the question the tab is really asked: is there a translation behind it.
 */
export function LangTabs({ tab, onTab, frState = 'empty', className = '' }) {
  const { t } = useI18n();
  const tabs = [
    ['en', t('ent.lang.en', 'English (base)'), null],
    ['fr', 'Français', frState],
  ];
  return (
    <div className={`flex items-center gap-1 ${className}`} role="tablist">
      {tabs.map(([l, label, state]) => (
        <button key={l} type="button" role="tab" aria-selected={tab === l} onClick={() => onTab(l)}
          className={`px-3 py-2 rounded-lg text-sm flex items-center gap-1.5 border transition ${tab === l ? 'panel border-[var(--line)] font-medium' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}>
          <Languages size={13} /> {label}
          {state && <span className={`text-[10px] ${state === 'empty' ? 'text-[var(--faint)]' : state === 'partial' ? 'text-warning' : 'text-success'}`}>
            {state === 'empty' ? t('ent.lang.optional', '(optional)') : state === 'partial' ? t('ent.lang.partial', '(partial)') : t('ent.lang.done', '(done)')}
          </span>}
        </button>
      ))}
    </div>
  );
}

/**
 * The concurrent-edit banner, once. Both editors 3-way-merge a colliding save and both had
 * their own copy of this, down to the wording.
 */
export function MergeBanner({ merge, resolving, onReopen, onDismiss }) {
  const { t } = useI18n();
  if (!merge) return null;
  const conflicts = merge.conflicts > 0;
  return (
    <div className={`mb-3 rounded-xl border px-3.5 py-2.5 text-sm flex items-start gap-2.5 ${conflicts ? 'border-warning-border bg-warning-bg text-warning' : 'border-success-border bg-success-bg text-success'}`}>
      <GitMerge size={16} className="shrink-0 mt-0.5" />
      <div className="flex-1">
        {conflicts ? (
          <>
            <b>{t('ent.merge.conflicts', '{n} conflict(s) to resolve.').replace('{n}', merge.conflicts)}</b>{' '}
            {t('ent.merge.someone', 'Someone else saved while you were editing.')}{' '}
            {resolving
              ? t('ent.merge.inpanel', 'Resolve them in the panel, then Save.')
              : <>{t('ent.merge.thensave', 'Then Save.')}{' '}
                {merge.pending && <button type="button" className="underline font-medium" onClick={onReopen}>{t('ent.merge.reopen', 'Reopen resolver')}</button>}</>}
          </>
        ) : (
          <><b>{t('ent.merge.clean', "Merged cleanly with someone else's edits.")}</b> {t('ent.merge.review', 'Review, then Save again.')}</>
        )}
      </div>
      <button type="button" onClick={onDismiss} className="opacity-70 hover:opacity-100" aria-label={t('common.close2', 'Close')}><X size={14} /></button>
    </div>
  );
}
