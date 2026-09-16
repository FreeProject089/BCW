// Roles, channels and members as things you recognise, not snowflakes you paste.
//
// Everything a Discord dashboard asks for is an id, and every id looks the same. The bot
// already sends what it knows on each heartbeat — the guild's roles (name, colour, position)
// and channels (name, type, parent) — and the member database answers a search. These
// controls read that and let you pick; the raw id box only comes back when the list is
// genuinely unavailable (bot offline, or a heartbeat older than the channel you just made),
// because a picker with nothing in it is worse than a box.
//
// One popover component underneath all of them: a search field, a filtered list, keyboard
// arrows, Escape to close. It is portalled and OPAQUE (`--bg-solid`, never a surface token) —
// the "Translucent surfaces" setting must not turn a menu into a window onto the card behind.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X, Hash, Volume2, Folder, MessagesSquare, Megaphone, AtSign, User } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { Input } from '../ui/ui.jsx';

// Discord channel types the heartbeat reports: 0 text · 2 voice · 4 category · 5 announcement
// · 15 forum. Each gets its own glyph so "a forum" and "a text channel" are told apart at a
// glance rather than by reading the type number in a tooltip.
export const CHANNEL_TYPES = { text: [0, 5], voice: [2], category: [4], forum: [15], postable: [0, 5] };
const TYPE_ICON = { 0: Hash, 2: Volume2, 4: Folder, 5: Megaphone, 15: MessagesSquare };
export const ChannelGlyph = ({ type, size = 12, className = '' }) => {
  const I = TYPE_ICON[type] || Hash;
  return <I size={size} className={className} />;
};

/** A role's colour, or null when Discord gives it none (`#000000` means "no colour" there). */
export const roleColor = (r) => (r?.color && r.color !== '#000000' ? r.color : null);

/** The name of a role / channel for the sentences that say where something goes. */
export const roleName = (roles, id) => (roles || []).find((r) => r.id === id)?.name || null;
export const channelOf = (channels, id) => (channels || []).find((c) => c.id === id) || null;

// ── The popover ───────────────────────────────────────────────────────────────────────────
/**
 * `items` is [{ id, label, sub, icon }]. `onPick(id)` closes. `footer` renders under the list
 * (the "use this id anyway" escape hatch). Search matches the label and the id, so somebody
 * who DOES have a snowflake on their clipboard can still paste it and find the row.
 */
function PickerPopover({ items, value, onPick, onClose, anchor, footer, searchPlaceholder, emptyText }) {
  const boxRef = useRef(null);
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items.slice(0, 200);
    return items.filter((o) => `${o.label} ${o.id}`.toLowerCase().includes(s)).slice(0, 200);
  }, [items, q]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const onListKey = (e) => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const opts = [...boxRef.current.querySelectorAll('[role="option"]')];
    const i = opts.indexOf(document.activeElement);
    opts[e.key === 'ArrowDown' ? Math.min(i + 1, opts.length - 1) : Math.max(i - 1, 0)]?.focus();
  };
  return createPortal(<>
    <div className="fixed inset-0 z-[70]" onClick={onClose} />
    <div ref={boxRef} onKeyDown={onListKey}
      className="fixed z-[71] rounded-xl border border-[var(--line-strong)] shadow-lg anim-pop overflow-hidden"
      style={{ top: anchor.top, left: anchor.left, width: anchor.width, background: 'var(--bg-solid)' }}>
      <div className="p-1.5 border-b border-[var(--line)] flex items-center gap-1.5">
        <Search size={13} className="text-[var(--faint)] shrink-0 ms-1" />
        
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder}
          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-xs py-1" />
      </div>
      <div role="listbox" className="max-h-64 overflow-auto scroll-thin p-1">
        {list.length === 0 && <div className="px-2 py-3 text-[11px] text-[var(--faint)] text-center">{emptyText}</div>}
        {list.map((o) => (
          <button key={o.id} type="button" role="option" aria-selected={o.id === value} onClick={() => onPick(o.id)}
            className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-start transition-colors ${o.id === value ? 'bg-[var(--surface-2)] font-medium' : 'hover:bg-[var(--surface-2)]'}`}>
            {o.icon}
            <span className="flex-1 truncate">{o.label}</span>
            {o.sub && <span className="text-[10px] text-[var(--faint)] shrink-0">{o.sub}</span>}
          </button>
        ))}
      </div>
      {footer && <div className="p-1.5 border-t border-[var(--line)]">{footer}</div>}
    </div>
  </>, document.body);
}

/** The button + popover pair. `render` draws what is currently chosen. */
function PickerButton({ items, value, onPick, render, placeholder, searchPlaceholder, emptyText, footer, className = '', disabled }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const btn = useRef(null);
  const openIt = () => {
    const r = btn.current?.getBoundingClientRect();
    if (r) setAnchor({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 230) - 8)), width: Math.max(r.width, 230) });
    setOpen(true);
  };
  return (<>
    <button ref={btn} type="button" disabled={disabled} onClick={() => (open ? setOpen(false) : openIt())}
      aria-haspopup="listbox" aria-expanded={open}
      className={`input !py-1 text-xs flex items-center gap-1.5 text-start disabled:opacity-50 ${className}`}>
      <span className="flex-1 min-w-0 truncate flex items-center gap-1.5">{render || <span className="text-[var(--faint)]">{placeholder}</span>}</span>
      <ChevronDown size={12} className={`text-[var(--muted)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && anchor && (
      <PickerPopover items={items} value={value} anchor={anchor} onClose={() => setOpen(false)} footer={footer}
        onPick={(id) => { setOpen(false); onPick(id); }} searchPlaceholder={searchPlaceholder} emptyText={emptyText} />
    )}
  </>);
}

// A plain id box: the fallback whenever the bot has told us nothing, and the escape hatch at
// the bottom of every picker. Digits only, because every Discord id is one.
function IdBox({ value, onChange, placeholder }) {
  return <Input className="!py-1 text-xs font-mono" value={value || ''} placeholder={placeholder}
    onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 32))} />;
}

// ── Roles ─────────────────────────────────────────────────────────────────────────────────
export const RoleTag = ({ role, id, size = 11 }) => {
  const col = roleColor(role);
  return (
    <span className="inline-flex items-center gap-1 min-w-0" style={col ? { color: col } : undefined}>
      <AtSign size={size} className="shrink-0 opacity-80" />
      <span className="truncate">{role?.name || id}</span>
    </span>
  );
};

/** One role. `value` is the id; '' is "none". */
export function RolePicker({ roles, value, onChange, placeholder, allowNone = true }) {
  const { t } = useI18n();
  const list = roles || [];
  if (!list.length) return <IdBox value={value} onChange={onChange} placeholder={placeholder || t('pick.role.ph', 'Role ID')} />;
  const items = [
    ...(allowNone ? [{ id: '', label: t('pick.none', 'None'), icon: <X size={12} className="text-[var(--faint)]" /> }] : []),
    ...list.map((r) => ({ id: r.id, label: r.name, icon: <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: roleColor(r) || 'var(--faint)' }} /> })),
  ];
  const cur = list.find((r) => r.id === value);
  return (
    <PickerButton items={items} value={value} onPick={onChange}
      render={value ? <RoleTag role={cur} id={value} /> : null}
      placeholder={placeholder || t('pick.role', 'Pick a role')}
      searchPlaceholder={t('pick.role.search', 'Search roles')}
      emptyText={t('pick.norole', 'No role matches.')}
      footer={<IdBox value={value} onChange={onChange} placeholder={t('pick.role.ph', 'Role ID')} />} />
  );
}

// ── Channels ──────────────────────────────────────────────────────────────────────────────
export const ChannelTag = ({ channel, id, size = 11 }) => (
  <span className="inline-flex items-center gap-1 min-w-0">
    <ChannelGlyph type={channel?.type ?? 0} size={size} className="shrink-0 text-[var(--faint)]" />
    <span className="truncate">{channel?.name || id}</span>
  </span>
);

/** One channel of the given types. `types` defaults to the ones you can post in. */
export function ChannelPicker({ channels, types = CHANNEL_TYPES.postable, value, onChange, placeholder, allowNone = true }) {
  const { t } = useI18n();
  const all = channels || [];
  const list = all.filter((c) => types.includes(c.type));
  if (!list.length) return <IdBox value={value} onChange={onChange} placeholder={placeholder || t('pick.chan.ph', 'Channel ID')} />;
  const parent = (c) => all.find((x) => x.id === c.parentId && x.type === 4)?.name || null;
  const items = [
    ...(allowNone ? [{ id: '', label: t('pick.none', 'None'), icon: <X size={12} className="text-[var(--faint)]" /> }] : []),
    ...list.map((c) => ({ id: c.id, label: c.name, sub: parent(c), icon: <ChannelGlyph type={c.type} className="text-[var(--faint)] shrink-0" /> })),
  ];
  const cur = list.find((c) => c.id === value);
  return (
    <PickerButton items={items} value={value} onPick={onChange}
      render={value ? <ChannelTag channel={cur} id={value} /> : null}
      placeholder={placeholder || t('pick.chan', 'Pick a channel')}
      searchPlaceholder={t('pick.chan.search', 'Search channels')}
      emptyText={t('pick.nochan', 'No channel matches.')}
      footer={<IdBox value={value} onChange={onChange} placeholder={t('pick.chan.ph', 'Channel ID')} />} />
  );
}

// ── Members ───────────────────────────────────────────────────────────────────────────────
/**
 * One member. There is no list in the heartbeat — there can be a hundred thousand of them —
 * so this asks: `search(q)` returns [{ discordId, username, nickname, avatar }]. The host
 * supplies it because the owner dashboard and the admin tab read different endpoints.
 */
export function MemberPicker({ search, value, onChange, placeholder }) {
  const { t } = useI18n();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [known, setKnown] = useState({});   // id → label, so a chosen member keeps its name
  // The search function is held in a ref and NOT in the deps. A host that passes a plain arrow
  // function hands us a new identity on every render, and an effect that depended on it would
  // fetch, set state, re-render, fetch — for ever.
  const searchRef = useRef(search);
  useEffect(() => { searchRef.current = search; }, [search]);
  useEffect(() => {
    if (!searchRef.current) return undefined;
    let alive = true;
    const h = setTimeout(() => {
      Promise.resolve(searchRef.current(q)).then((r) => { if (alive) setRows(Array.isArray(r) ? r : []); }).catch(() => { if (alive) setRows([]); });
    }, 200);
    return () => { alive = false; clearTimeout(h); };
  }, [q]);
  useEffect(() => {
    if (!rows.length) return;
    setKnown((k) => ({ ...k, ...Object.fromEntries(rows.map((r) => [r.discordId, r.nickname || r.username || r.discordId])) }));
  }, [rows]);
  if (!search) return <IdBox value={value} onChange={onChange} placeholder={placeholder || t('pick.user.ph', 'User ID')} />;
  const items = rows.map((r) => ({
    id: r.discordId, label: r.nickname || r.username || r.discordId, sub: r.username && r.nickname ? r.username : null,
    icon: r.avatar ? <img src={r.avatar} alt="" className="w-4 h-4 rounded-full shrink-0" /> : <User size={12} className="text-[var(--faint)] shrink-0" />,
  }));
  return (
    <MemberPickerInner q={q} setQ={setQ} items={items} value={value} onChange={onChange} label={known[value] || value}
      placeholder={placeholder || t('pick.user', 'Pick a member')} />
  );
}
// Split out so the search box drives the host's query rather than filtering a local list.
function MemberPickerInner({ q, setQ, items, value, onChange, label, placeholder }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const btn = useRef(null);
  const openIt = () => {
    const r = btn.current?.getBoundingClientRect();
    if (r) setAnchor({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 240) - 8)), width: Math.max(r.width, 240) });
    setOpen(true);
  };
  return (<>
    <button ref={btn} type="button" onClick={() => (open ? setOpen(false) : openIt())} aria-haspopup="listbox" aria-expanded={open}
      className="input !py-1 text-xs flex items-center gap-1.5 text-start">
      <span className="flex-1 min-w-0 truncate flex items-center gap-1.5">
        {value ? <><User size={11} className="text-[var(--faint)] shrink-0" />{label}</> : <span className="text-[var(--faint)]">{placeholder}</span>}
      </span>
      <ChevronDown size={12} className={`text-[var(--muted)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && anchor && createPortal(<>
      <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
      <div className="fixed z-[71] rounded-xl border border-[var(--line-strong)] shadow-lg anim-pop overflow-hidden"
        style={{ top: anchor.top, left: anchor.left, width: anchor.width, background: 'var(--bg-solid)' }}>
        <div className="p-1.5 border-b border-[var(--line)] flex items-center gap-1.5">
          <Search size={13} className="text-[var(--faint)] shrink-0 ms-1" />
          
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('pick.user.search', 'Search members')}
            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-xs py-1" />
        </div>
        <div role="listbox" className="max-h-64 overflow-auto scroll-thin p-1">
          {items.length === 0 && <div className="px-2 py-3 text-[11px] text-[var(--faint)] text-center">{t('pick.nouser', 'No member matches.')}</div>}
          {items.map((o) => (
            <button key={o.id} type="button" role="option" aria-selected={o.id === value} onClick={() => { setOpen(false); onChange(o.id); }}
              className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-start transition-colors ${o.id === value ? 'bg-[var(--surface-2)] font-medium' : 'hover:bg-[var(--surface-2)]'}`}>
              {o.icon}<span className="flex-1 truncate">{o.label}</span>
              {o.sub && <span className="text-[10px] text-[var(--faint)] shrink-0">{o.sub}</span>}
            </button>
          ))}
        </div>
        <div className="p-1.5 border-t border-[var(--line)]"><IdBox value={value} onChange={onChange} placeholder={t('pick.user.ph', 'User ID')} /></div>
      </div>
    </>, document.body)}
  </>);
}

// ── Lists of them ─────────────────────────────────────────────────────────────────────────
/**
 * Chips + one picker. `kind` picks which: 'role' | 'channel' | 'user'. The chips carry the
 * name and the colour, so a saved list reads as a list of roles rather than of numbers.
 */
export function PickerList({ kind, items, onChange, roles, channels, types, search, max = 100, placeholder }) {
  const { t } = useI18n();
  const list = Array.isArray(items) ? items : [];
  const add = (id) => { if (id && !list.includes(id) && list.length < max) onChange([...list, id]); };
  const drop = (id) => onChange(list.filter((x) => x !== id));
  const chip = (id) => {
    if (kind === 'role') { const r = (roles || []).find((x) => x.id === id); return <RoleTag role={r} id={id} />; }
    if (kind === 'channel') { const c = (channels || []).find((x) => x.id === id); return <ChannelTag channel={c} id={id} />; }
    return <span className="inline-flex items-center gap-1"><User size={11} className="text-[var(--faint)]" />{id}</span>;
  };
  return (
    <div className="space-y-1.5">
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 ps-2 pe-1 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[11px] max-w-[200px]">
              {chip(id)}
              <button type="button" onClick={() => drop(id)} className="text-[var(--faint)] hover:text-error shrink-0" title={t('common.remove', 'Remove')}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      {list.length < max && (
        kind === 'role' ? <RolePicker roles={roles} value="" onChange={add} placeholder={placeholder || t('pick.addrole', 'Add a role')} allowNone={false} />
          : kind === 'channel' ? <ChannelPicker channels={channels} types={types} value="" onChange={add} placeholder={placeholder || t('pick.addchan', 'Add a channel')} allowNone={false} />
            : <MemberPicker search={search} value="" onChange={add} placeholder={placeholder || t('pick.adduser', 'Add a member')} />
      )}
    </div>
  );
}
