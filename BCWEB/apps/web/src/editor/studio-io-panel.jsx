// What the studio draws for its export and import (phase 7c); the logic is studio-io.js.
//
//   · StudioIODialog   why a file (or a paste) was refused: each problem in words, with the
//                      field it is in, and the promise that nothing was changed
//   · DropOverlay      "drop a studio file" over the whole studio while a file is dragged in
//   · ImportButton     the menu item each panel carries (pages, components, presets): the same
//                      file picker, whatever the kind; the file's kind decides where it lands
import { FileWarning, FileUp, Upload } from 'lucide-react';
import { Button, Modal } from '../ui/ui.jsx';
import { reasonWords } from './studio-io-words.js';

export function StudioIODialog({ t, refusal, onClose }) {
  if (!refusal) return null;
  return (
    <Modal open onClose={onClose} title={refusal.title} icon={FileWarning}
      footer={<Button variant="primary" onClick={onClose} data-io-close>{t('common.ok', 'OK')}</Button>}>
      <div className="space-y-2" data-io-refusal role="alert">
        <p className="text-sm">{t('cst.io.refused.lead', 'Nothing was changed. The file holds:')}</p>
        <ul className="space-y-1.5">
          {refusal.problems.map((p, i) => (
            <li key={`${p.path}|${p.reason}|${i}`} className="text-[12px] rounded-md border border-[var(--line)] px-2 py-1.5" data-io-problem={p.reason}>
              <span className="block">{reasonWords(t, p.reason)}</span>
              {p.path ? <code className="block text-[11px] text-[var(--muted)] break-all" data-io-path>{p.path}</code> : null}
            </li>
          ))}
        </ul>
        {refusal.more > 0 && <p className="text-[11px] text-[var(--muted)]">{t('cst.io.refused.more', 'And {n} more.').replace('{n}', String(refusal.more))}</p>}
        <p className="text-[11px] text-[var(--muted)]">{t('cst.io.refused.h', 'A studio file is checked like a save: the same rules for links, pictures, containers and components. Fix the file, or export it again from the studio it came from.')}</p>
      </div>
    </Modal>
  );
}

export function DropOverlay({ t, on }) {
  if (!on) return null;
  return (
    <div className="cst-io-drop" aria-hidden data-io-drop>
      <div className="cst-io-drop-card">
        <FileUp size={28} className="text-[var(--accent-ink)]" />
        <div className="text-sm font-semibold mt-2">{t('cst.io.drop', 'Drop a studio file to import it')}</div>
        <div className="text-[11px] text-[var(--muted)] mt-1">{t('cst.io.drop.h', 'A page becomes a new page, a component or a preset goes into the library. Checked before anything changes.')}</div>
      </div>
    </div>
  );
}

export function ImportButton({ t, onImport, label = '' }) {
  if (!onImport) return null;
  const text = label || t('cst.io.import', 'Import a file');
  // studiofix: in a narrow dock the label wraps (a .btn is nowrap), so it is never wider than
  // the panel and never clipped either.
  return (
    <Button size="sm" variant="ghost" className="w-full min-w-0 justify-center" onClick={onImport} data-io-import
      title={t('cst.io.import.h', 'Import a .bcwstudio.json file (you can also drop it on the studio)')}>
      <Upload size={13} className="shrink-0" /> <span className="min-w-0 whitespace-normal text-center leading-tight">{text}</span>
    </Button>
  );
}
