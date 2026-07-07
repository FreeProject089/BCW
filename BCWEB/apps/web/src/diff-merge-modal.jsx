import { useMemo, useState } from 'react';
import { Modal, Button } from './ui.jsx';
import { merge3Hunks, assembleHunks, lineStat } from './merge3.js';
import { GitMerge, Check, ChevronDown, ChevronRight, User as UserIcon, Users } from 'lucide-react';

// GitHub-style visual conflict resolver. Given the common ancestor + both edited
// versions, it computes hunks (merge3Hunks) and lets the editor resolve each conflict
// hunk with one click — "yours", "theirs", or "both" — instead of hand-editing raw
// <<<<<<< markers in the textarea. Auto-merged / unchanged regions show as context.
// onResolve(text) receives the assembled result.
export default function DiffMergeModal({ open, onClose, base, mine, theirs, labels = { mine: 'Your version', theirs: 'Their version' }, langLabel, onResolve }) {
  const { hunks, conflicts } = useMemo(() => merge3Hunks(base, mine, theirs), [base, mine, theirs]);
  const [choices, setChoices] = useState({});      // conflict-hunk index → 'mine'|'theirs'|'both'|'theirs-mine'
  const [expanded, setExpanded] = useState({});    // common-hunk index → bool (context expand)

  const conflictIdxs = hunks.map((h, i) => h.type === 'conflict' ? i : -1).filter((i) => i >= 0);
  const resolvedCount = conflictIdxs.filter((i) => choices[i]).length;
  const allResolved = resolvedCount === conflictIdxs.length;
  // Overall line-diff of what the other editor changed (base → theirs).
  const stat = useMemo(() => lineStat(base, theirs), [base, theirs]);

  // Toggle: re-clicking the active choice clears it (deselect). `cycle` (Both) steps
  // both → theirs-mine → off so it's also fully deselectable.
  const pick = (i, choice) => setChoices((c) => { const n = { ...c }; if (n[i] === choice) delete n[i]; else n[i] = choice; return n; });
  const cycleBoth = (i) => setChoices((c) => { const n = { ...c }; const cur = n[i]; if (cur === 'both') n[i] = 'theirs-mine'; else if (cur === 'theirs-mine') delete n[i]; else n[i] = 'both'; return n; });
  const acceptAll = (choice) => setChoices(Object.fromEntries(conflictIdxs.map((i) => [i, choice])));
  const apply = () => { onResolve(assembleHunks(hunks, choices)); onClose(); };

  // A block of code lines with a colored gutter, GitHub-diff style.
  const Lines = ({ lines, tone }) => (
    <div className={`font-mono text-[12.5px] leading-[1.6] ${tone === 'add' ? 'bg-emerald-500/[0.07]' : tone === 'del' ? 'bg-red-500/[0.07]' : ''}`}>
      {(lines.length ? lines : ['']).map((ln, k) => (
        <div key={k} className="flex">
          <span className={`select-none w-6 shrink-0 text-center ${tone === 'add' ? 'text-emerald-500' : tone === 'del' ? 'text-red-500' : 'text-transparent'}`}>{tone === 'add' ? '+' : tone === 'del' ? '−' : ''}</span>
          <span className="whitespace-pre-wrap break-words flex-1 pr-2">{ln || ' '}</span>
        </div>
      ))}
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title={`Resolve conflicts${langLabel ? ` · ${langLabel}` : ''}`} icon={GitMerge} width="max-w-4xl"
      footer={<>
        <span className="text-xs mr-auto flex items-center gap-2 flex-wrap" style={{ color: allResolved ? 'var(--success, #10b981)' : 'var(--muted)' }}>
          <span className="flex items-center gap-1.5">{allResolved ? <Check size={14} /> : <GitMerge size={14} />} {resolvedCount}/{conflictIdxs.length} conflict{conflictIdxs.length === 1 ? '' : 's'} resolved</span>
          <span className="font-mono text-[11px]"><span className="text-emerald-400">+{stat.added}</span> <span className="text-red-400">−{stat.removed}</span> <span className="text-[var(--faint)]">their changes</span></span>
        </span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!allResolved} onClick={apply}><Check size={14} /> Apply resolution</Button>
      </>}>
      {/* Bulk actions */}
      {conflictIdxs.length > 1 && (
        <div className="flex items-center gap-2 mb-3 text-xs">
          <span className="text-[var(--muted)]">Resolve all as:</span>
          <button onClick={() => acceptAll('mine')} className="px-2 py-1 rounded-md border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10">Yours</button>
          <button onClick={() => acceptAll('theirs')} className="px-2 py-1 rounded-md border border-sky-500/40 text-sky-400 hover:bg-sky-500/10">Theirs</button>
          <button onClick={() => acceptAll('both')} className="px-2 py-1 rounded-md border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-2)]">Both</button>
        </div>
      )}

      <div className="rounded-xl border border-[var(--line)] overflow-hidden divide-y divide-[var(--line)] max-h-[60vh] overflow-y-auto">
        {hunks.map((h, i) => {
          if (h.type === 'common') {
            const long = h.lines.length > 6;
            const show = expanded[i] || !long;
            const shown = show ? h.lines : [...h.lines.slice(0, 2), '…', ...h.lines.slice(-2)];
            return (
              <div key={i} className="bg-[var(--surface)]/40">
                {long && (
                  <button onClick={() => setExpanded((e) => ({ ...e, [i]: !e[i] }))} className="w-full flex items-center gap-1 px-2 py-1 text-[11px] text-[var(--faint)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]">
                    {show ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {show ? 'collapse' : `${h.lines.length} unchanged lines`}
                  </button>
                )}
                <Lines lines={shown} tone="ctx" />
              </div>
            );
          }
          // conflict hunk
          const choice = choices[i];
          return (
            <div key={i} className="bg-[var(--bg-solid)]">
              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-amber-500/10 border-b border-amber-500/20">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-500 flex items-center gap-1.5">
                  <GitMerge size={12} /> Conflict {conflictIdxs.indexOf(i) + 1}
                  <span className="font-mono normal-case tracking-normal ml-1"><span className="text-emerald-400">+{h.mine.length}</span> <span className="text-red-400">−{h.theirs.length}</span></span>
                </span>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <ChoiceBtn active={choice === 'mine'} onClick={() => pick(i, 'mine')} tone="emerald" icon={UserIcon}>Yours</ChoiceBtn>
                  <ChoiceBtn active={choice === 'theirs'} onClick={() => pick(i, 'theirs')} tone="sky" icon={UserIcon}>Theirs</ChoiceBtn>
                  <ChoiceBtn active={choice === 'both' || choice === 'theirs-mine'} onClick={() => cycleBoth(i)} tone="slate" icon={Users}>
                    Both{choice === 'theirs-mine' ? ' (T→Y)' : choice === 'both' ? ' (Y→T)' : ''}
                  </ChoiceBtn>
                </div>
              </div>
              {/* Preview reflects the current choice; unresolved shows both stacked. */}
              {choice === 'mine' ? <div className="ring-1 ring-inset ring-emerald-500/30"><SideHdr tone="emerald" label={labels.mine} /><Lines lines={h.mine} tone="add" /></div>
                : choice === 'theirs' ? <div className="ring-1 ring-inset ring-sky-500/30"><SideHdr tone="sky" label={labels.theirs} /><Lines lines={h.theirs} tone="add" /></div>
                : choice === 'both' ? <><SideHdr tone="emerald" label={labels.mine} /><Lines lines={h.mine} tone="add" /><SideHdr tone="sky" label={labels.theirs} /><Lines lines={h.theirs} tone="add" /></>
                : choice === 'theirs-mine' ? <><SideHdr tone="sky" label={labels.theirs} /><Lines lines={h.theirs} tone="add" /><SideHdr tone="emerald" label={labels.mine} /><Lines lines={h.mine} tone="add" /></>
                : <>
                    <SideHdr tone="emerald" label={labels.mine} /><Lines lines={h.mine} tone="add" />
                    <SideHdr tone="sky" label={labels.theirs} /><Lines lines={h.theirs} tone="del" />
                  </>}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function ChoiceBtn({ active, onClick, tone, icon: Icon, children }) {
  const tones = {
    emerald: active ? 'bg-emerald-500 text-white border-emerald-500' : 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10',
    sky: active ? 'bg-sky-500 text-white border-sky-500' : 'border-sky-500/40 text-sky-400 hover:bg-sky-500/10',
    slate: active ? 'bg-[var(--text)] text-[var(--bg-solid)] border-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-2)]',
  };
  return <button onClick={onClick} className={`px-2 py-0.5 rounded-md border font-medium flex items-center gap-1 transition ${tones[tone]}`}><Icon size={11} /> {children}</button>;
}
function SideHdr({ tone, label }) {
  const c = tone === 'emerald' ? 'text-emerald-400' : tone === 'sky' ? 'text-sky-400' : 'text-[var(--muted)]';
  return <div className={`px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${c} bg-[var(--surface-2)]/50`}>{label}</div>;
}
