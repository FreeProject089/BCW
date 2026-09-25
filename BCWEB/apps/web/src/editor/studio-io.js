// The studio's export and import (PLAN-STUDIO-2026 phase 7c): the browser's half.
//
// The format and EVERY rule are the package's (packages/studio/src/io.js): what a file holds,
// how it is read (size, JSON, reserved keys, depth, validateDoc, the library's entry rule, the
// asset rule) and how its ids are made new. This file only does what a browser has to:
//
//   · write a file (a Blob and an <a download>, the house pattern of the B.MD editor);
//   · read one: from a file picker, or dropped on the studio (the size is checked on the File
//     BEFORE it is read, so a 2 GB drop is refused without being loaded);
//   · decide where an accepted file lands, by its kind:
//       page, preset:page       a NEW page of the target, hidden from visitors (the page list's
//                               own "create", so the API validates it again); where there is no
//                               page list (a home section), it replaces the page being edited,
//                               after a confirmation, as one undo step;
//       component, preset:*     an entry of the page's library (else the site's), through the
//                               library's own save route and its guards;
//   · paste: Ctrl+V of copied blocks is read by the SAME package function (parseBlocksPaste),
//     so an import and a paste are refused by one validator;
//   · say why a file was refused, field by field (StudioIODialog, studio-io-panel.jsx).
//
// Nothing here writes to the server by itself: a page lands in the draft or through the page
// list's create, an entry through the library's save, each of which validates again.
import { useCallback, useRef, useState } from 'react';
import {
  parseStudioFile, exportStudioFile, studioFileName, studioFileText, freshStudioFile, parseBlocksPaste,
  entrySortOf, assetList, serializeDoc, MAX_FILE_BYTES, GRID,
} from '../lib/canvas.js';
import { loadStudioLinks } from '../lib/studio-links.js';
import { useI18n } from '../i18n.jsx';

/** Write a studio file to the author's disk. */
export function downloadStudioFile(file, name) {
  const url = URL.createObjectURL(new Blob([studioFileText(file)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = studioFileName(name, file.kind === 'page' ? 'page' : 'studio');
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Ask the browser for one file. Resolves with the File, or null when the picker is dismissed. */
export function pickStudioFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => resolve(input.files?.[0] || null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

/** Does a drag carry files (and not, say, a block of text or a panel of the dock)? */
const carriesFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

const newId = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * The studio's import and export. `ctx` is what the studio has in hand:
 *   t, toast, dialog      the kit's own
 *   canvas                the normalised page being edited
 *   emit(blocks, extra)   a change to it (one undo step)
 *   addBlocks(fresh)      new blocks placed on the board being edited (paste)
 *   pages                 the page list (pages/studio.jsx) or null: create, docOf, library
 *   componentMode         set when the document is a component's definition
 *   uid()                 a new block id
 * Returns the handlers the panels call and the state the dialog and the drop overlay draw.
 * (`t` may be passed; the hook reads its own from useI18n either way.)
 */
export function useStudioIO(ctx) {
  // The words are the hook's own (useI18n), so a caller cannot hand in a stale or missing t().
  const { t } = useI18n();
  const ref = useRef(ctx); ref.current = { ...ctx, t };
  const [refusal, setRefusal] = useState(null);     // { title, problems } | null
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const refuse = useCallback((title, problems) => setRefusal({ title, problems: problems.slice(0, 12), more: Math.max(0, problems.length - 12) }), []);

  /** Where the file's pictures point, said once it has landed. */
  const assetNote = useCallback((file) => {
    const { t } = ref.current;
    const n = assetList(file.doc, file.components || null).length;
    if (!n) return '';
    const here = typeof location !== 'undefined' ? location.origin : '';
    if (file.origin && here && file.origin !== here) {
      return t('cst.io.assets.other', 'This file comes from {host}: its {n} picture(s) or file(s) are addresses of that site, which this site probably does not have. Upload them here and choose them again.')
        .replace('{host}', file.origin.replace(/^https?:\/\//, '')).replace('{n}', String(n));
    }
    return t('cst.io.assets.same', 'It uses {n} picture(s) or file(s) of this site by address: they are not inside the file, and show as long as the uploads exist.').replace('{n}', String(n));
  }, []);

  // ── Export ──────────────────────────────────────────────────────────────────────────────
  const exportDoc = useCallback(async ({ kind, doc, id = '', name = '', exposed = null }) => {
    const { t, toast } = ref.current;
    const links = await loadStudioLinks();
    const { file, problems } = exportStudioFile({ kind, doc, id, name, exposed, origin: location.origin, exportedAt: new Date().toISOString() }, { links });
    if (problems.length) { refuse(t('cst.io.export.refused', 'This cannot be exported'), problems); return false; }
    downloadStudioFile(file, name || doc?.title || '');
    toast.success(t('cst.io.exported', 'Exported as a .bcwstudio.json file.'));
    return true;
  }, [refuse]);

  /** A page of the target by id (the one being edited: its draft as it is now). */
  const exportPage = useCallback((pid) => {
    const { canvas, pages } = ref.current;
    const doc = !pid || pid === canvas.id ? serializeDoc(canvas) : pages?.docOf?.(pid);
    if (!doc) return;
    return exportDoc({ kind: 'page', doc, id: pid || canvas.id, name: doc.title || '' });
  }, [exportDoc]);

  /** A library entry: `component` from the Components panel, `preset:<sort>` from the gallery. */
  const exportEntry = useCallback((entry, asPreset = false) => {
    if (!entry?.doc) return;
    const kind = asPreset ? `preset:${entry.sort}` : 'component';
    return exportDoc({ kind, doc: entry.doc, id: entry.id, name: entry.name, exposed: entry.sort === 'component' ? (entry.exposed || []) : null });
  }, [exportDoc]);

  // ── Import ──────────────────────────────────────────────────────────────────────────────
  const land = useCallback(async (file) => {
    const { t, toast, dialog, emit, pages, componentMode, uid } = ref.current;
    const sort = entrySortOf(file.kind);
    const title = t('cst.io.refused', 'This file was not imported');
    if (componentMode) { refuse(title, [{ path: 'kind', reason: 'not_here' }]); return; }
    const fresh = freshStudioFile(file, { uid, componentUid: () => newId('c') });
    const note = assetNote(file);
    if (!sort) {
      if (pages?.canEditList && pages.create) {
        // The page list's own create: a new page, hidden, validated again by the API.
        pages.create({ doc: fresh.doc, name: String(fresh.doc.title || '') });
        if (note) toast.info(note);
        return;
      }
      const ok = await dialog.confirm({
        title: t('cst.io.replace.title', 'Replace this page with the file?'),
        message: t('cst.io.replace.msg', 'Its blocks, background and stylesheet are replaced by the imported page. Undo (Ctrl+Z) brings them back, and nothing is saved until you save.'),
        okLabel: t('cst.io.replace.ok', 'Replace'), danger: true,
      });
      if (!ok) return;
      const d = fresh.doc;
      emit(d.blocks || [], { title: d.title || '', background: d.background || { type: 'site' }, css: d.css || '', grid: d.grid || GRID, frames: d.frames, components: d.components || {} });
      toast.success(`${t('cst.io.replaced', 'Page imported into the draft. Save to publish it.')}${note ? ` ${note}` : ''}`);
      return;
    }
    const lib = pages?.library || null;
    const scope = lib?.canWrite?.project ? 'project' : lib?.canWrite?.site ? 'site' : '';
    if (!lib || !scope) { refuse(title, [{ path: 'kind', reason: 'no_library' }]); return; }
    const entry = {
      id: newId(sort === 'component' ? 'cp' : 'pr'),
      name: String(file.name || '').trim() || t('cst.io.untitled', 'Imported'),
      sort, doc: fresh.doc, createdAt: new Date().toISOString(),
      ...(sort === 'component' ? { exposed: fresh.exposed || [] } : {}),
    };
    // The library's own save: the API runs the same entry rule again, with the list's.
    const saved = await lib.save(entry, scope, { quiet: true });
    if (!saved) return;
    const where = scope === 'site' ? t('cst.io.to.site', 'the site library') : t('cst.io.to.page', 'this page’s library');
    const what = sort === 'component' ? t('cst.io.imported.cmp', 'Component “{name}” imported into {where}.') : t('cst.io.imported.preset', 'Preset “{name}” imported into {where}.');
    toast.success(`${what.replace('{name}', entry.name).replace('{where}', where)}${note ? ` ${note}` : ''}`);
  }, [refuse, assetNote]);

  const importText = useCallback(async (text) => {
    const { t } = ref.current;
    const links = await loadStudioLinks();
    const r = parseStudioFile(text, { links });
    if (!r.ok) { refuse(t('cst.io.refused', 'This file was not imported'), r.problems); return false; }
    await land(r.file);
    return true;
  }, [refuse, land]);

  const importFile = useCallback(async (file) => {
    const { t } = ref.current;
    if (!file) return false;
    // Before reading it: a file this large cannot hold a page a save would take.
    if (file.size > MAX_FILE_BYTES) { refuse(t('cst.io.refused', 'This file was not imported'), [{ path: '', reason: 'file_too_large' }]); return false; }
    let text = '';
    try { text = await file.text(); } catch { refuse(t('cst.io.refused', 'This file was not imported'), [{ path: '', reason: 'bad_json' }]); return false; }
    return importText(text);
  }, [refuse, importText]);

  const pick = useCallback(async () => { const f = await pickStudioFile(); if (f) await importFile(f); }, [importFile]);

  // ── Paste ───────────────────────────────────────────────────────────────────────────────
  /**
   * Ctrl+V: `input` is the clipboard's text, or the blocks this tab copied. Read by the same
   * package function as a file (a section), then placed with new ids, the copied containers'
   * blocks inside the copies of their containers, the top blocks a few steps down and right.
   * Returns false when the text was not a paste of blocks at all (the caller then tries the
   * blocks this tab copied), true otherwise, refused or not.
   */
  const pasteBlocks = useCallback(async (input) => {
    const { t, canvas, addBlocks, uid } = ref.current;
    const links = await loadStudioLinks();
    const r = parseBlocksPaste(input, serializeDoc(canvas).components || null, { links });
    if (!r.ok) {
      if (typeof input === 'string' && r.problems.every((p) => p.reason === 'bad_json' || p.reason === 'bad_format')) return false;
      refuse(t('cst.io.paste.refused', 'This paste was refused'), r.problems);
      return true;
    }
    const fresh = freshStudioFile(r.file, { uid, keepComponents: true, taken: canvas.blocks.map((b) => b.id) });
    const blocks = fresh.doc.blocks || [];
    if (!blocks.length) return true;
    addBlocks(blocks.map((b) => (b.parent ? b : { ...b, x: (Number(b.x) || 0) + GRID * 3, y: (Number(b.y) || 0) + GRID * 3 })));
    return true;
  }, [refuse]);

  // ── Drop ────────────────────────────────────────────────────────────────────────────────
  const dropProps = {
    onDragEnter: (e) => { if (!carriesFiles(e)) return; e.preventDefault(); depth.current += 1; setDragging(true); },
    onDragOver: (e) => { if (!carriesFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
    onDragLeave: (e) => { if (!carriesFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); },
    onDrop: (e) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth.current = 0; setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) importFile(file);
    },
  };

  return { exportPage, exportEntry, importFile, importText, pick, pasteBlocks, dropProps, dragging, refusal, closeRefusal: () => setRefusal(null) };
}
