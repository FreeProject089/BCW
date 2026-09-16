// The studio's keyboard, written down.
//
// Every shortcut listed here already worked — Ctrl+Z, Ctrl+D, the arrows, Escape — and not one
// of them was written anywhere a person could read. They were discoverable by reading the
// source, which is not a feature. Undiscoverable shortcuts are the same as absent ones, and
// worse: the author hand-places a block the slow way while the exact gesture they wanted is
// two keys away.
//
// So the table is the ONE source: the key handler in canvas-studio.jsx and this sheet are
// written against the same rows, which is what stops the sheet from slowly describing an
// editor that no longer exists. A row added here without a handler still shows up in review
// as a line nobody implemented; a handler added without a row is the failure this file is
// for, and it is at least a one-line fix.
import { Keyboard } from 'lucide-react';
import { Modal, Button } from '../ui/ui.jsx';

/**
 * The rows, grouped the way an author thinks about them rather than the way the handler is
 * written. `mod` renders as the platform's own modifier so a Mac reader is not told to press
 * a key their keyboard does not have.
 */
export function shortcutGroups(t) {
  return [
    {
      title: t('cst.keys.g.edit', 'Editing'),
      rows: [
        ['mod+Z', t('cst.keys.undo', 'Undo')],
        ['mod+Shift+Z', t('cst.keys.redo', 'Redo')],
        ['mod+S', t('cst.keys.save', 'Save the page')],
        ['mod+D', t('cst.keys.dup', 'Duplicate the selection')],
        ['mod+C / mod+V', t('cst.keys.copy', 'Copy and paste blocks, between pages too')],
        ['Delete', t('cst.keys.del', 'Delete the selection, locked blocks survive')],
      ],
    },
    {
      title: t('cst.keys.g.sel', 'Selecting'),
      rows: [
        ['mod+A', t('cst.keys.all', 'Select every block')],
        ['Shift+' + t('cst.keys.click', 'click'), t('cst.keys.add', 'Add a block to the selection, or take it out')],
        [t('cst.keys.drag', 'Drag on empty canvas'), t('cst.keys.marquee', 'Select everything the rubber band touches')],
        ['Escape', t('cst.keys.none', 'Select nothing')],
      ],
    },
    {
      title: t('cst.keys.g.move', 'Placing'),
      rows: [
        ['← ↑ → ↓', t('cst.keys.nudge', 'Move by one grid step')],
        ['Shift+← ↑ → ↓', t('cst.keys.nudge10', 'Move by ten grid steps')],
        ['mod+]', t('cst.keys.front', 'Bring the selection to the front')],
        ['mod+[', t('cst.keys.back', 'Send the selection to the back')],
        ['L', t('cst.keys.lock', 'Lock or unlock the selection')],
        ['H', t('cst.keys.hide', 'Hide or show the selection')],
      ],
    },
    {
      title: t('cst.keys.g.view', 'Looking'),
      rows: [
        ['+ / -', t('cst.keys.zoom', 'Zoom in and out')],
        ['0', t('cst.keys.fit', 'Fit the board to the pane')],
        ['1', t('cst.keys.100', 'Zoom to 100%')],
        ['G', t('cst.keys.grid', 'Show or hide the grid')],
        ['?', t('cst.keys.help', 'This list')],
      ],
    },
  ];
}

/** ⌘ on a Mac, Ctrl everywhere else. Read from the browser, so it is right on the machine. */
function modLabel() {
  const p = typeof navigator !== 'undefined' ? (navigator.platform || navigator.userAgent || '') : '';
  return /Mac|iPhone|iPad/i.test(p) ? '⌘' : 'Ctrl';
}

function Keys({ combo }) {
  const mod = modLabel();
  // A row can name a gesture instead of a chord ("Drag on empty canvas"); those are one piece,
  // and splitting them on the separators would render each word as its own key cap.
  const parts = /^[\w+⌘?[\]=\-←↑→↓ /]+$/.test(combo) ? combo.split(' / ') : [combo];
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {parts.map((p, i) => (
        <span key={p} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-[var(--faint)]">/</span>}
          {p.split('+').map((k) => (
            <kbd key={k} className="cst-kbd">{k === 'mod' ? mod : k}</kbd>
          ))}
        </span>
      ))}
    </span>
  );
}

/** The sheet itself. Opened from the top bar, and from `?` anywhere outside a text field. */
export default function ShortcutsModal({ t, onClose }) {
  return (
    <Modal open onClose={onClose} title={t('cst.keys', 'Keyboard shortcuts')} icon={Keyboard} width="max-w-3xl"
      footer={<Button variant="primary" onClick={onClose}>{t('common.done', 'Done')}</Button>}>
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
        {shortcutGroups(t).map((g) => (
          <div key={g.title}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{g.title}</div>
            <dl className="space-y-1">
              {g.rows.map(([combo, what]) => (
                <div key={combo} className="flex items-start gap-2 text-xs">
                  <dt className="shrink-0 w-[46%]"><Keys combo={combo} /></dt>
                  <dd className="flex-1 min-w-0 text-[var(--muted)]">{what}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-[var(--muted)] mt-4">{t('cst.keys.h', 'None of these fire while you are typing in a field, so Ctrl+Z inside a text box is still the browser’s own undo.')}</p>
    </Modal>
  );
}
