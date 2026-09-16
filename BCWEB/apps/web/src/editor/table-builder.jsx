// Choosing a table's shape before writing it.
//
// The editor inserted a fixed 2×2 table. Every table that is not 2×2 then had to be widened by
// hand, and widening a markdown table means editing three things that must stay in step — the
// header row, the separator row and every body row. Miss one and it stops being a table at all,
// silently: it renders as a paragraph full of pipes, which reads as the editor being broken.
//
// So the shape is asked for, the way every other editor asks: a grid you drag across, plus
// exact numbers for the sizes a grid is clumsy for. Alignment is here too, because it is the
// other thing that lives in the separator row and is therefore the other thing people get
// wrong by hand.
import { useState } from 'react';
import { Table as TableIcon } from 'lucide-react';
import { Button, Modal, Select, Input } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';

import { MAX_C, MAX_R, buildTable } from '../lib/table-md.js';
export { buildTable };

export default function TableBuilder({ open, onClose, onInsert }) {
  const { t } = useI18n();
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(3);
  const [header, setHeader] = useState(true);
  const [align, setAlign] = useState('none');
  const [filled, setFilled] = useState(true);
  const [hover, setHover] = useState(null);

  const md = buildTable({ cols, rows, header, align, filled });
  const insert = () => { onInsert(md); onClose(); };

  // The drag-across grid, capped at the sizes that fit a page. Hovering previews the pick, so
  // the numbers below and the grid always agree about what is about to be inserted.
  const gc = hover?.c ?? cols;
  const gr = hover?.r ?? rows;

  return (
    <Modal open={open} onClose={onClose} title={t('tb.title', 'Insert a table')} icon={TableIcon} width="max-w-md"
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
        <Button variant="primary" onClick={insert}>{t('tb.insert', 'Insert {c}×{r}').replace('{c}', cols).replace('{r}', rows)}</Button>
      </>}>
      <div className="space-y-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('tb.size', 'Size')}</div>
          <div className="inline-grid gap-0.5 p-1 rounded-lg border border-[var(--line)]"
            style={{ gridTemplateColumns: `repeat(${MAX_C}, 18px)` }}
            onMouseLeave={() => setHover(null)}>
            {Array.from({ length: MAX_R * MAX_C }, (_, i) => {
              const c = (i % MAX_C) + 1, r = Math.floor(i / MAX_C) + 1;
              const on = c <= gc && r <= gr;
              return (
                <button key={i} type="button" aria-label={`${c}×${r}`}
                  onMouseEnter={() => setHover({ c, r })}
                  onFocus={() => setHover({ c, r })}
                  onClick={() => { setCols(c); setRows(r); setHover(null); }}
                  className="h-[18px] rounded-[3px] border"
                  style={{
                    background: on ? 'var(--primary)' : 'var(--surface-2)',
                    borderColor: on ? 'var(--primary)' : 'var(--line)',
                    opacity: on ? 0.9 : 1,
                  }} />
              );
            })}
          </div>
          <div className="text-xs text-[var(--muted)] mt-1.5 tabular-nums">
            {t('tb.shape', '{c} column(s) × {r} row(s)').replace('{c}', gc).replace('{r}', gr)}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--faint)] flex flex-col gap-1">
            {t('tb.cols', 'Columns')}
            <Input type="number" min={1} max={MAX_C} value={cols} onChange={(e) => setCols(Math.max(1, Math.min(MAX_C, Number(e.target.value) || 1)))}
              className="!w-24 !py-1 !text-sm" />
          </label>
          <label className="text-xs text-[var(--faint)] flex flex-col gap-1">
            {t('tb.rows', 'Rows')}
            <Input type="number" min={0} max={MAX_R} value={rows} onChange={(e) => setRows(Math.max(0, Math.min(MAX_R, Number(e.target.value) || 0)))}
              className="!w-24 !py-1 !text-sm" />
          </label>
          <label className="text-xs text-[var(--faint)] flex flex-col gap-1">
            {t('tb.align', 'Align')}
            <Select className="!w-auto !py-1 !text-sm" value={align} onChange={(e) => setAlign(e.target.value)}>
              <option value="none">{t('tb.align.none', 'Default')}</option>
              <option value="left">{t('tb.align.left', 'Left')}</option>
              <option value="center">{t('tb.align.center', 'Centre')}</option>
              <option value="right">{t('tb.align.right', 'Right')}</option>
            </Select>
          </label>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} />
            {t('tb.header', 'Name the columns')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={filled} onChange={(e) => setFilled(e.target.checked)} />
            {t('tb.filled', 'Fill the cells with placeholders')}
          </label>
        </div>

        {/* What is about to be inserted, as markdown. A table is the block people most often
            want to check before it lands, because a wrong one does not look wrong — it stops
            being a table. */}
        <pre className="text-[11px] font-mono rounded-lg border border-[var(--line)] p-2 overflow-x-auto whitespace-pre"
          style={{ background: 'var(--surface-2)', maxHeight: 150 }}>{md.trim()}</pre>
      </div>
    </Modal>
  );
}
