// Kept drafts: the React half. `useDraft` for the form, `<DraftBanner>` for the offer.
//
// See ui/draft-store.js for where a draft lives and why. This is the part a caller touches,
// and it is shaped like the undo family in pages/pages.jsx (`useUndoableDelete` and its two
// siblings): one hook, three things handed in, a small object handed back, and the wording
// of the thing on screen written once here rather than at each call site.
//
// THE CONTRACT
//
//   const draft = useDraft({ scope, id, value, onRestore, ready, meta });
//
//   You give:
//     scope      a stable name for this form ('contact', 'report', 'blog-post'…). It is half
//                the storage key, so two forms can never be handed each other's drafts.
//     id         the row being edited, or null/'' for a new one. The other half of the key:
//                editing post 7 and post 8 are two drafts, and both differ from "new post".
//     value      the whole form state, as ONE serialisable object. A File, a DOM node or a
//                function in there is dropped by JSON and comes back as nothing — keep those
//                out of `value` and re-attach them after a restore, the way the wizard keeps
//                its upload slot outside the draft.
//     onRestore  (value) => void — put a kept draft back. Called ONLY from the banner's
//                "Restore", never on its own.
//     ready      false while the form is still loading what it is editing. Nothing is read or
//                written until it is true, so an empty form on its way to being filled by a
//                fetch is not mistaken for the user clearing everything.
//     meta       anything small the caller wants back alongside the draft (the wizard keeps
//                the step it was on). Optional.
//     seed       for an editor that fetches the rest of its content after opening: bump it
//                when that lands and "pristine" is re-taken there. Same contract as
//                `useDirtyForm` in ui/entry-modal.jsx, on purpose — the two hooks sit on the
//                same forms and a second meaning of `seed` would be one too many.
//
//   You get:
//     offered    { value, savedAt, meta } — a kept draft that is NOT on screen, or null.
//                It is never applied for you. A draft that silently replaced what somebody
//                was looking at would be indistinguishable from the site losing their work.
//     restore()  apply it (calls onRestore) and dismiss the offer.
//     discard()  forget it. One click, no confirmation: the thing being thrown away is
//                already a copy of something, and the current form is untouched either way.
//     clear()    the caller's "this is saved now, the draft is spent" — call it after a
//                successful submit, the way the wizard clears on Publish.
//     flush()     write now rather than in 400ms, for a "Save draft" button that also closes.
//                Not needed for an ordinary close: unmount flushes a pending write by itself.
//     saved      true once something has actually been written, for a "kept in this tab" line.
//
//   It guarantees:
//     · nothing is written while the form is pristine (equal to what it started from), and a
//       form edited back to pristine has its draft removed;
//     · nothing at all is written when drafts are off in Settings — see draft-store.js;
//     · a draft older than a day is neither offered nor kept;
//     · one tab cannot overwrite another's draft (sessionStorage is per tab).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { getDraftsDisabled } from '../lib/prefs.js';
import { draftKey, readDraft, writeDraft, clearDraft, draftAge, draftDiffers } from './draft-store.js';

/** The store, resolved lazily: there is none during a server render or in a browser that
 *  refuses storage, and the hook has to work (doing nothing) in both. */
const store = () => { try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; } };

/** How long after the last keystroke the draft is written. The studio uses 300ms for a canvas;
 *  a form is typed into faster than it is dragged, so a touch longer. */
const DEBOUNCE_MS = 400;

export function useDraft({ scope, id, value, onRestore, ready = true, meta = null, seed = 0 }) {
  const key = draftKey(scope, id);
  const [offered, setOffered] = useState(null);
  const [saved, setSaved] = useState(false);
  const checked = useRef(false);
  const baseline = useRef(null);   // what the form started from: pristine means "equal to this"
  const timer = useRef(null);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;
  const metaRef = useRef(meta);
  metaRef.current = meta;

  // The key identifies the draft, so changing it (opening a different row in the same modal)
  // is a different draft: forget what was offered and look again.
  useEffect(() => { checked.current = false; baseline.current = null; setOffered(null); setSaved(false); }, [key]);

  const serialised = useMemo(() => { try { return JSON.stringify(value); } catch { return null; } }, [value]);

  // `seed`, exactly as `useDirtyForm` in ui/entry-modal.jsx uses it: an editor that fetches
  // the rest of what it is editing AFTER opening bumps it once that landed, and pristine is
  // re-taken there. Without it the fetch filling the form in looks like somebody typing, and
  // the editor keeps a draft of a post nobody touched.
  const seedRef = useRef(seed);
  if (seedRef.current !== seed) { seedRef.current = seed; baseline.current = serialised; }

  // Look once, when the form is ready. `baseline` is captured in the same pass so that the
  // very first write cannot fire before we know what pristine looks like.
  useEffect(() => {
    if (!ready || checked.current) return;
    checked.current = true;
    baseline.current = (() => { try { return JSON.stringify(value); } catch { return null; } })();
    const kept = readDraft(store(), key, { enabled: !getDraftsDisabled() });
    if (kept && draftDiffers(kept.value, value)) setOffered(kept);
    else if (kept) clearDraft(store(), key);   // identical to what is on screen: not a draft
  }, [ready, key, value]);

  // Keep what is on screen, a moment after it stops changing.
  const latest = useRef({ key, serialised, value });
  latest.current = { key, serialised, value };
  const pending = useRef(false);

  // The one place a write happens, so the Settings switch has one place to be honoured.
  const writeNow = useRef(null);
  writeNow.current = () => {
    const { key: k, serialised: s, value: v } = latest.current;
    pending.current = false;
    if (!checked.current || s == null) return;
    // Pristine: nothing has been typed, or it has been typed back to where it started.
    // Either way there is nothing worth keeping, and a stale key would be offered later.
    if (s === baseline.current) { clearDraft(store(), k); setSaved(false); return; }
    // Read the switch here rather than at mount: turning drafts off has to stop the writes
    // in a form that is already open, not only in the next one.
    if (getDraftsDisabled()) return;
    if (writeDraft(store(), k, v, { meta: metaRef.current })) setSaved(true);
  };

  useEffect(() => {
    if (!ready || !checked.current || serialised == null) return undefined;
    pending.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => writeNow.current?.(), DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [serialised, ready, key]);

  // On the way out, write what is still inside the debounce window. A modal shut by a
  // mis-click outside it is the case this whole mechanism exists for, and the last keystroke
  // before that click is exactly the one the timer had not fired for yet. Empty deps on
  // purpose: this must run at unmount and nowhere else, or a change of `key` would flush the
  // new form's value under the old form's key.
  useEffect(() => () => { if (pending.current) writeNow.current?.(); }, []);

  /** Write the current value now instead of in 400ms. For a "Save draft" button, where the
   *  click and the close happen in the same breath. */
  const flush = useCallback(() => { clearTimeout(timer.current); pending.current = true; writeNow.current?.(); }, []);

  // Not inside a `setOffered` updater: a state updater has to be pure, and under StrictMode
  // React runs it twice — which would restore the draft twice, and on a form whose onRestore
  // appends rather than replaces that is visible damage.
  const restore = useCallback(() => {
    if (!offered) return;
    onRestoreRef.current?.(offered.value, offered.meta);
    setOffered(null);
  }, [offered]);
  const discard = useCallback(() => { clearDraft(store(), key); setOffered(null); setSaved(false); }, [key]);
  const clear = useCallback(() => {
    clearTimeout(timer.current); pending.current = false;
    clearDraft(store(), key);
    setOffered(null); setSaved(false);
    // What is on screen at that moment IS the saved state now, so it must not be written back
    // as a draft by a pending change.
    baseline.current = (() => { try { return JSON.stringify(value); } catch { return null; } })();
  }, [key, value]);

  return { offered, restore, discard, clear, flush, saved, key };
}

/** "kept 5 minutes ago", in the reader's language. One translation of the sentence for every
 *  form, because a restore offer that is worded differently on each page reads as a different
 *  feature on each page. */
export function useDraftAgeLabel() {
  const { t } = useI18n();
  return (savedAt) => {
    const { unit, n } = draftAge(savedAt);
    if (unit === 'now') return t('draft.age.now', 'a moment ago');
    if (unit === 'min') return t('draft.age.min', '{n} min ago').replace('{n}', String(n));
    if (unit === 'hour') return t('draft.age.hour', '{n} h ago').replace('{n}', String(n));
    return t('draft.age.day', '{n} day(s) ago').replace('{n}', String(n));
  };
}

/**
 * The offer. Renders nothing until there is one, so a caller can drop it at the top of its
 * form unconditionally.
 *
 * Two buttons and an age, and that is the whole design: what you are being offered, how old
 * it is (so "is this newer than what I am looking at" is answerable), and one click each way.
 * `what` names the thing in one word for the sentence, e.g. "message", "article".
 */
export function DraftBanner({ draft, what, className = '' }) {
  const { t } = useI18n();
  const ageLabel = useDraftAgeLabel();
  if (!draft?.offered) return null;
  return (
    <div role="status" className={`rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs flex items-center gap-2 flex-wrap ${className}`}>
      <RotateCcw size={13} className="text-[var(--accent-ink)] shrink-0" />
      <span className="flex-1 min-w-[12rem]">
        {(what
          ? t('draft.offer.named', 'An unsent {what} was kept in this tab, {age}.').replace('{what}', what)
          : t('draft.offer', 'Something you were writing was kept in this tab, {age}.')
        ).replace('{age}', ageLabel(draft.offered.savedAt))}
      </span>
      <button type="button" onClick={draft.restore}
        className="shrink-0 rounded-lg border border-[var(--line)] px-2 py-1 font-medium hover:bg-[var(--surface-1)] transition">
        {t('draft.restore', 'Restore it')}
      </button>
      <button type="button" onClick={draft.discard} title={t('draft.discard.h', 'Forget it and keep what is on screen.')}
        className="shrink-0 rounded-lg p-1 text-[var(--faint)] hover:text-[var(--text)] hover:bg-[var(--surface-1)] transition"
        aria-label={t('draft.discard', 'Discard the draft')}>
        <X size={13} />
      </button>
    </div>
  );
}

/** The quiet counterpart: "kept in this tab" under a long form, so somebody who is about to
 *  close the tab knows the net is there. Nothing when there is nothing kept. */
export function DraftKeptNote({ draft, className = '' }) {
  const { t } = useI18n();
  if (!draft?.saved) return null;
  return <p className={`text-[11px] text-[var(--faint)] ${className}`}>{t('draft.kept', 'Kept in this browser tab as you type. Nothing is sent until you do.')}</p>;
}
