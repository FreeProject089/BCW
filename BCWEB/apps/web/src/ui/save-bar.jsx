// The one save bar every admin editor uses.
//
// Before: the home page editor had a sticky dock with a "modified" dot, the footer had the
// same dock with no dirty state at all (Save always lit, nothing said whether it mattered),
// the topbar editor had a Save button in its header and nothing else, and the 3D scene had a
// line of text under its buttons. Four answers to one question: "is there anything to save,
// and where is the button". One component now answers it the same way everywhere:
//
//   - a status dot and a sentence (Unsaved changes / All changes saved), plus an optional
//     detail the caller supplies (how many rows changed, what is off),
//   - Discard, which puts the saved version back, with an Undo in the toast (a discard throws
//     away work, and throwing away work gets an undo on this site),
//   - Save, disabled while there is nothing to save or a save is running,
//   - Ctrl+S / Cmd+S, which saves whichever bars on screen are dirty,
//   - a leave-page guard while dirty (lib/leave-guard.js): tab close, in-app links, and the
//     admin's own section switch all ask before dropping the draft,
//   - sticky at the bottom of the content, in the `.save-dock` frame (index.css), which
//     honours Translucent surfaces.
//
// Layout holds in every language: the sentence wraps (never truncated), and the buttons keep
// their natural width in their own non-shrinking group, which drops under the sentence on a
// narrow screen instead of squeezing it.
import { useEffect, useRef } from 'react';
import { Save, Undo2 } from 'lucide-react';
import { Button, useDialog, useToast } from './ui.jsx';
import { useI18n } from '../i18n.jsx';
import { registerDirty } from '../lib/leave-guard.js';
import './save-bar.css';

/**
 * @param dirty       true when the draft differs from what the server holds
 * @param busy        a save is in flight
 * @param onSave      () => void | Promise
 * @param onDiscard   () => (void | (() => void)): puts the saved version back. If it returns a
 *                    function, that function restores the discarded draft and the toast offers
 *                    it as Undo.
 * @param detail      optional node after the status sentence
 * @param label       what this editor is called, for the leave dialog ("Footer", "Topbar")
 * @param canSave     extra gate on Save (e.g. the draft is invalid); defaults to true
 * @param saveLabel   replaces "Save" (e.g. "Publish")
 * @param extra       optional nodes placed before Discard (secondary actions)
 * @param sticky      false renders the bar in the flow (for a card inside a longer page)
 */
export function SaveBar({
  dirty, busy = false, onSave, onDiscard, detail = null, label = '', canSave = true,
  saveLabel = '', extra = null, sticky = true, className = '',
}) {
  const { t } = useI18n();
  const toast = useToast();
  const dialog = useDialog();

  // The leave-page guard, held only while there is something to lose.
  useEffect(() => {
    if (!dirty) return undefined;
    return registerDirty({ dialog, t, label });
  }, [dirty, dialog, t, label]);

  // Ctrl+S. The latest handler is read through a ref so the listener is attached once.
  const live = useRef({ dirty, busy, onSave, canSave });
  live.current = { dirty, busy, onSave, canSave };
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || String(e.key).toLowerCase() !== 's') return;
      // Always swallow it while an editor is on screen: the browser's "Save page as" is never
      // what somebody pressing Ctrl+S in an editor meant.
      e.preventDefault();
      const s = live.current;
      if (s.dirty && !s.busy && s.canSave) void s.onSave?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const discard = () => {
    const restore = onDiscard?.();
    if (typeof restore === 'function') {
      toast.action({
        tone: 'info', duration: 7000, cancelLabel: t('common.undo', 'Undo'),
        msg: t('savebar.discarded', 'Changes discarded.'),
        onCommit: () => {},
        onCancel: restore,
      });
    }
  };

  return (
    <div className={`save-dock ${sticky ? '' : 'save-dock-flow'} ${className}`} data-dirty={dirty ? '1' : undefined} data-savebar="">
      <span className="save-dock-dot" aria-hidden="true" />
      <span className="text-[12px] min-w-[12rem] flex-1 break-words" aria-live="polite">
        <span className="font-medium text-[var(--text)]">
          {busy ? t('savebar.saving', 'Saving…') : dirty ? t('savebar.dirty', 'Unsaved changes') : t('savebar.clean', 'All changes saved')}
        </span>
        {detail && <span className="text-[var(--muted)]">{' · '}{detail}</span>}
        <span className="hidden md:inline text-[var(--faint)]">{' · '}{t('savebar.kbd', 'Ctrl+S to save')}</span>
      </span>
      {/* Not shrink-0: on a phone in French the group is wider than the bar, and a group that
          cannot shrink cannot wrap. It takes its own line and its buttons wrap inside it. */}
      <span className="flex items-center justify-end gap-2 flex-wrap ms-auto max-w-full min-w-0">
        {extra}
        {onDiscard && (
          <Button variant="ghost" size="sm" onClick={discard} disabled={!dirty || busy}>
            <Undo2 size={14} /> {t('savebar.discard', 'Discard')}
          </Button>
        )}
        <Button variant="primary" onClick={() => onSave?.()} disabled={!dirty || busy || !canSave} loading={busy}>
          <Save size={15} /> {saveLabel || t('common.save', 'Save')}
        </Button>
      </span>
    </div>
  );
}

export default SaveBar;
