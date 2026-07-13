import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/ui.jsx';

// Shortcut builder: pick Windows or macOS style, toggle modifiers, type the key —
// live preview, then insert `:kbd[…]`. Touch-friendly (all taps, one text field).
const MODS = [
  { id: 'ctrl', win: 'Ctrl', mac: '⌃' },
  { id: 'alt', win: 'Alt', mac: '⌥' },
  { id: 'shift', win: 'Shift', mac: '⇧' },
  { id: 'meta', win: 'Win', mac: '⌘' },
];
const COMMON_KEYS = ['A', 'C', 'V', 'S', 'Z', 'F', 'K', 'P', 'Enter', 'Esc', 'Tab', 'Space', 'F5', '↑', '↓', '←', '→'];

export default function KbdPicker({ onPick, onClose }) {
  const [os, setOs] = useState('win');
  const [mods, setMods] = useState({ ctrl: true, alt: false, shift: false, meta: false });
  const [key, setKey] = useState('S');
  const parts = [...MODS.filter((m) => mods[m.id]).map((m) => (os === 'mac' ? m.mac : m.win)), ...(key.trim() ? [key.trim()] : [])];
  const combo = parts.join('+');
  const insert = () => { if (combo) { onPick(combo); onClose(); } };
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4" style={{ background: 'rgba(4,5,8,0.55)', backdropFilter: 'blur(3px)' }} onMouseDown={onClose}>
      <div className="card modal-card w-full max-w-sm p-0 overflow-hidden anim-pop" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line)]">
          <span className="font-semibold">Insert a shortcut</span>
          <button onClick={onClose} className="text-[var(--faint)] hover:text-[var(--text)]"><X size={16} /></button>
        </div>
        <div className="p-4 space-y-4">
          {/* OS style */}
          <div className="inline-flex rounded-xl border border-[var(--line)] p-0.5">
            {[['win', 'Windows'], ['mac', 'macOS']].map(([v, label]) => (
              <button key={v} type="button" onClick={() => setOs(v)}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-medium ${os === v ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'}`}>{label}</button>
            ))}
          </div>
          {/* modifiers */}
          <div className="flex flex-wrap gap-2">
            {MODS.map((m) => (
              <button key={m.id} type="button" onClick={() => setMods((s) => ({ ...s, [m.id]: !s[m.id] }))}
                className={`min-w-[52px] px-3 py-2 rounded-lg border text-sm font-bold transition ${mods[m.id] ? 'border-[var(--primary)] bg-[var(--primary)]/12 text-[var(--primary)]' : 'border-[var(--line)] text-[var(--muted)]'}`}>
                {os === 'mac' ? `${m.mac} ${m.id === 'meta' ? 'Cmd' : m.id[0].toUpperCase() + m.id.slice(1)}` : m.win}
              </button>
            ))}
          </div>
          {/* key */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mb-1.5">Key</div>
            <input value={key} onChange={(e) => setKey(e.target.value)} maxLength={8} placeholder="S"
              className="input !py-2 !text-sm !w-28 text-center font-bold" />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {COMMON_KEYS.map((k) => (
                <button key={k} type="button" onClick={() => setKey(k)}
                  className={`px-2 py-1 rounded-md border text-xs font-semibold ${key === k ? 'border-[var(--primary)] text-[var(--primary)]' : 'border-[var(--line)] text-[var(--muted)]'}`}>{k}</button>
              ))}
            </div>
          </div>
          {/* preview + insert */}
          <div className="flex items-center justify-between gap-3 pt-1 border-t border-[var(--line)]">
            <span className="doc-kbd pt-2">{parts.map((p, i) => <kbd key={i}>{p}</kbd>)}</span>
            <Button size="sm" variant="primary" disabled={!combo} onClick={insert}>Insert</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
