// The bot's icon set ON DISCORD: which of the ~100 icons really exist as application emojis,
// how to put them all there at once, and how to add one emoji of your own.
//
// The bot already uploads its set on boot (apps/bot/src/features/icons.mjs), but nothing on the
// site could say whether that worked, and the only way to add an emoji by hand was to paste
// `<:name:id>` into one of a hundred boxes. So:
//   1. the owner runs apps/bot/scripts/sync-app-emojis.mjs with the bot token (on their own
//      machine; the token never comes to the site). It uploads what is missing, skips what is
//      there at the current version, and sends the resulting `name → id` map to the site;
//   2. or they import that map here (the file it wrote, or Discord's raw emoji list);
//   3. each icon then shows present / outdated / missing, from GET /admin/bot/emoji-status.
// One custom emoji is a key → `<:name:id>` entry in economy.icons (the host's config draft,
// saved with the page): an existing key is overridden, a new key becomes usable as {ic:key}.
//
// And an icon OF YOUR OWN, which used to need a code change. The set was `ICONS` in the API's
// lib/bot-emoji.mjs — a frozen object in the source — so a new picture meant editing that file
// and redeploying. `Icons of your own` below writes AdminSetting `bot.customIcons` instead: an
// uploaded image (re-drawn server-side into the 128x128 PNG Discord takes, refused above its
// 256 KiB) or a glyph from the families the site already draws. It joins /bot/emoji/keys, so
// the bot uploads it on its next icon sync exactly like a built-in.
import { useMemo, useRef, useState } from 'react';
import { Copy, Upload, FileJson, CheckCircle2, AlertTriangle, XCircle, Plus, Trash2, Terminal, RefreshCw, Smile, ImagePlus, Shapes } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { api } from '../lib/api.js';
import { Button, Card, Input, Textarea, Field, Explain, Spinner, useToast, useDialog, copyText, ColorInput } from '../ui/ui.jsx';
import { SP, Panel, Eyebrow } from '../ui/discord-kit.jsx';
import { useAsync, Loading } from './pages.jsx';
import { parseEmojiPaste, parseEmojiToken, EMOJI_KEY_RE } from '../lib/app-emojis.js';

const CMD_DRY = 'cd apps/bot && node scripts/sync-app-emojis.mjs';
const CMD_APPLY = 'cd apps/bot && node scripts/sync-app-emojis.mjs --apply';

const TONE = {
  present: { I: CheckCircle2, cls: 'text-success' },
  outdated: { I: AlertTriangle, cls: 'text-warning' },
  missing: { I: XCircle, cls: 'text-error' },
};

function CommandLine({ cmd }) {
  const { t } = useI18n(); const toast = useToast();
  return (
    <div className="flex items-start gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-2">
      <Terminal size={13} className="shrink-0 mt-0.5 text-[var(--faint)]" />
      <code className="flex-1 min-w-0 break-all text-[12px] font-mono text-[var(--text)]">{cmd}</code>
      <button type="button" onClick={async () => { if (await copyText(cmd)) toast.success(t('em.copied', 'Copied.')); }} className="p-1 -m-1 shrink-0 text-[var(--muted)] hover:text-[var(--text)]" title={t('em.copy', 'Copy')}><Copy size={13} /></button>
    </div>
  );
}

/**
 * Icons an admin adds - the half of the set that is NOT in the source.
 *
 * Two ways in, because they answer different needs: an image you have (a logo, a drawing) and
 * a glyph the site already ships (any lucide name, or `ph:rocket`) on a tile in a colour you
 * pick, which is exactly how the built-in icons are drawn.
 *
 * The file is read to a data URL here and validated for real on the server: the browser's
 * `file.type` is what the file is NAMED, and the server sniffs what it IS. The size shown is
 * the source cap; the server also refuses anything whose 128x128 PNG lands over Discord's own
 * per-emoji limit, so the refusal happens here rather than mid-upload on Discord.
 */
function CustomIcons({ onReload }) {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const { data, loading, reload } = useAsync(() => api.get('/admin/bot/custom-icons'), []);
  const [form, setForm] = useState({ key: '', label: '', source: 'glyph', icon: 'sparkles', color: '#5865f2', image: '', filename: '' });
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState([]);
  const fileRef = useRef(null);
  const icons = data?.icons || [];
  const maxKiB = data?.maxImageKiB || 2048;
  const keyOk = EMOJI_KEY_RE.test(form.key);
  const ready = keyOk && form.label.trim() && (form.source === 'glyph' ? !!form.icon.trim() : !!form.image);

  const pickFile = (file) => {
    if (!file) return;
    if (file.size > maxKiB * 1024) { toast.error(t('ci.toobig', 'That image is over {n} KiB.').replace('{n}', maxKiB)); return; }
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, image: String(reader.result || ''), filename: file.name, source: 'image', label: f.label || file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 60) }));
    reader.onerror = () => toast.error(t('common.failed', 'Failed.'));
    reader.readAsDataURL(file);
  };

  const add = async () => {
    if (!ready) return;
    setBusy(true); setIssues([]);
    try {
      const body = { key: form.key, label: form.label.trim(), source: form.source };
      if (form.source === 'glyph') { body.icon = form.icon.trim(); body.color = form.color; }
      else body.image = form.image;
      await api.post('/admin/bot/custom-icons', body);
      toast.success(t('ci.added', 'Added. The bot uploads it to Discord at its next icon sync.'));
      setForm({ key: '', label: '', source: form.source, icon: 'sparkles', color: '#5865f2', image: '', filename: '' });
      reload(); onReload?.();
    } catch (x) {
      setIssues(x?.data?.issues || []);
      toast.error(t('ci.refused', 'The site refused that icon. The reasons are listed below.'));
    } finally { setBusy(false); }
  };

  const remove = async (k) => {
    const yes = await dialog.confirm({ title: t('ci.rm.t', 'Remove this icon?'), body: t('ci.rm.b', 'It leaves the set the bot uploads. The emoji already on Discord stays until the sync script runs with --prune.'), danger: true });
    if (!yes) return;
    // undo: the confirm above is the window. Nothing is lost either way — the emoji stays on
    // Discord until --prune, and re-adding the icon is the same two fields that created it.
    try { await api.del(`/admin/bot/custom-icons/${k}`); reload(); onReload?.(); toast.success(t('ci.removed', 'Removed.')); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };

  return (
    <Panel className={SP.stack}>
      <Eyebrow>{t('ci.title', 'Icons of your own')}</Eyebrow>
      <p className="text-[11.5px] text-[var(--muted)]">
        {t('ci.d', 'An icon added here joins the set the bot puts on Discord, with no code change: it appears in the list above and is uploaded at the next sync. {n} of {m} used.')
          .replace('{n}', icons.length).replace('{m}', data?.max ?? 50)}
      </p>

      {loading ? <Loading /> : icons.length > 0 && (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {icons.map((ic) => (
            <div key={ic.key} className="flex items-start gap-2.5 rounded-lg border border-[var(--line)] px-2.5 py-2 min-w-0">
              <img src={`/api/admin/bot/emoji-icon/${ic.key}.png?v=${ic.version}`} alt="" loading="lazy" className="w-6 h-6 rounded shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium break-words">{ic.label}</div>
                <code className="text-[11px] font-mono text-[var(--faint)] break-all">{`{ic:${ic.key}}`}</code>
              </div>
              <button type="button" onClick={() => remove(ic.key)} className="p-1 shrink-0 text-[var(--faint)] hover:text-error" title={t('common.remove', 'Remove')}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {[['glyph', Shapes, t('ci.glyph', 'A glyph on a tile')], ['image', ImagePlus, t('ci.image', 'An image of mine')]].map(([k, I, label]) => (
          <button key={k} type="button" onClick={() => setForm({ ...form, source: k })} aria-pressed={form.source === k}
            className={`inline-flex items-center gap-1.5 text-[11.5px] px-2 py-1 rounded-lg border transition-colors ${form.source === k ? 'b-primary tint-primary text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)]'}`}><I size={12} /> {label}</button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        <Field label={t('ci.key', 'Key')} hint={t('ci.key.h', 'Used in bot texts as {ic:key}.')}>
          <Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32) })} placeholder="party" />
        </Field>
        <Field label={t('ci.label', 'Name')}>
          <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value.slice(0, 60) })} placeholder={t('ci.label.ph', 'Party popper')} />
        </Field>
      </div>

      {form.source === 'glyph' ? (
        <div className="grid sm:grid-cols-[minmax(0,1fr)_auto] gap-2 items-end">
          <Field label={t('ci.icon', 'Glyph')} hint={t('ci.icon.h', 'A lucide name (party-popper), or ph:rocket for Phosphor.')}>
            <Input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value.slice(0, 200) })} placeholder="party-popper" className="font-mono" />
          </Field>
          <Field label={t('ci.color', 'Tile')}>
            <ColorInput value={form.color} onChange={(v) => setForm({ ...form, color: v })} />
          </Field>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}><ImagePlus size={13} /> {t('ci.choose', 'Choose an image')}</Button>
          {form.image
            ? <span className="inline-flex items-center gap-2 text-[11.5px] text-[var(--muted)] min-w-0"><img src={form.image} alt="" className="w-6 h-6 rounded object-contain shrink-0" /><span className="truncate" title={form.filename}>{form.filename}</span></span>
            : <span className="text-[11px] text-[var(--faint)]">{t('ci.limits', 'PNG, JPEG, GIF or WebP, up to {n} KiB. It is redrawn as the 128x128 PNG Discord takes.').replace('{n}', maxKiB)}</span>}
        </div>
      )}

      {issues.length > 0 && <ul className="text-[11.5px] text-error list-disc ps-5">{issues.map((x) => <li key={x} className="break-words">{x}</li>)}</ul>}
      {form.key && !keyOk && <p className="text-[11.5px] text-error">{t('em.one.badkey', 'A key is 2 to 32 lower-case letters, digits or _.')}</p>}
      <div className="flex justify-end">
        <Button size="sm" variant="primary" disabled={!ready || busy} onClick={add}>{busy ? <Spinner /> : <><Plus size={13} /> {t('ci.add', 'Add to the set')}</>}</Button>
      </div>
    </Panel>
  );
}

/**
 * `icons` is economy.icons from the host's config draft ({ key: '<:name:id>' }); `onChange(key,
 * value)` writes one entry of it ('' clears it). The host saves it with the page.
 */
export function BotEmojiSyncCard({ icons = {}, onChange }) {
  const { t } = useI18n(); const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/admin/bot/emoji-status'), []);
  const [filter, setFilter] = useState('attention');
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState([]);
  const fileRef = useRef(null);
  const [nk, setNk] = useState({ key: '', token: '' });

  const list = data?.icons || [];
  const counts = data?.counts || { present: 0, outdated: 0, missing: 0 };
  const parsed = useMemo(() => (paste.trim() ? parseEmojiPaste(paste) : null), [paste]);
  const shown = list.filter((s) => (filter === 'all' ? true : filter === 'attention' ? s.status !== 'present' : s.status === filter));
  const iconKeys = new Set(list.map((s) => s.key));
  const custom = Object.entries(icons || {}).filter(([k, v]) => !iconKeys.has(k) && typeof v === 'string' && v.trim());
  const available = data?.available || [];

  const importMap = async () => {
    if (!parsed?.ok) return;
    setBusy(true); setIssues([]);
    try {
      await api.put('/admin/bot/emoji-map', { emojis: parsed.emojis, animated: parsed.animated, ...(parsed.appId ? { appId: parsed.appId } : {}), mode: 'replace' });
      toast.success(t('em.imported', 'Imported: {n} emoji(s).').replace('{n}', Object.keys(parsed.emojis).length));
      setPaste(''); reload();
    } catch (x) {
      setIssues(x?.data?.issues || []);
      toast.error(x?.data?.error === 'invalid_emoji_map' ? t('em.bad', 'The site refused this map. The reasons are listed under the box.') : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  const readFile = async (file) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast.error(t('em.toobig', 'That file is too large to be an emoji map.'));
    try { setPaste(await file.text()); } catch { toast.error(t('common.failed', 'Failed.')); }
  };

  const tokenParsed = parseEmojiToken(nk.token);
  const keyOk = EMOJI_KEY_RE.test(nk.key);
  const addCustom = () => {
    if (!keyOk || !tokenParsed) return;
    onChange(nk.key, tokenParsed.token);
    toast.success(iconKeys.has(nk.key) ? t('em.custom.over', 'Set. Save the page to apply it.') : t('em.custom.added', 'Added. Save the page, then use it as {ic:{k}}.').replace('{k}', nk.key));
    setNk({ key: '', token: '' });
  };

  const FILTERS = [
    ['attention', t('em.f.attention', 'Needs attention ({n})').replace('{n}', counts.outdated + counts.missing)],
    ['missing', t('em.f.missing', 'Missing ({n})').replace('{n}', counts.missing)],
    ['outdated', t('em.f.outdated', 'Outdated ({n})').replace('{n}', counts.outdated)],
    ['present', t('em.f.present', 'On Discord ({n})').replace('{n}', counts.present)],
    ['all', t('em.f.all', 'All ({n})').replace('{n}', list.length)],
  ];
  const STATUS = { present: t('em.s.present', 'on Discord'), outdated: t('em.s.outdated', 'an older drawing'), missing: t('em.s.missing', 'missing') };

  return (
    <Card className="p-4 mb-4">
      <div className={SP.page}>
        <div className="flex items-start gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Smile size={14} className="text-[var(--accent-ink)] shrink-0" /> {t('em.title', 'Icons on Discord')}</h3>
            <p className="text-[11.5px] text-[var(--muted)] mt-0.5">{t('em.sub', 'The bot draws every icon as an application emoji. Here is which ones Discord really has, and how to add them all at once.')}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={reload} title={t('em.refresh', 'Refresh')}><RefreshCw size={13} /></Button>
        </div>

        {/* The state of the set, in three numbers. */}
        {loading ? <Loading /> : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
            {['present', 'outdated', 'missing'].map((k) => { const { I, cls } = TONE[k]; return <span key={k} className={`inline-flex items-center gap-1.5 ${cls}`}><I size={13} className="shrink-0" /> <span className="tabular-nums font-semibold">{counts[k]}</span> <span className="text-[var(--muted)]">{STATUS[k]}</span></span>; })}
            <span className="text-[11px] text-[var(--faint)] ms-auto">
              {data?.updatedAt
                ? t('em.last', 'Map from {d}, by {s}.').replace('{d}', new Date(data.updatedAt).toLocaleString()).replace('{s}', data.source === 'script' ? t('em.src.script', 'the script') : t('em.src.dash', 'an import here'))
                : t('em.never', 'No map yet: every icon shows as missing until the script runs or a map is imported.')}
            </span>
          </div>
        )}

        {/* 1. Put them all on Discord. */}
        <Panel className={SP.stack}>
          <Eyebrow>{t('em.step1', 'Add every icon at once')}</Eyebrow>
          <p className="text-[11.5px] text-[var(--muted)]">{t('em.step1.d', 'On the machine that runs the bot, with its token in the environment. First a dry run, which only prints what it would do:')}</p>
          <CommandLine cmd={CMD_DRY} />
          <p className="text-[11.5px] text-[var(--muted)]">{t('em.step1.d2', 'Then the real run. It uploads what is missing, skips what is already there, writes app-emojis.json and sends the map to this page:')}</p>
          <CommandLine cmd={CMD_APPLY} />
          <Explain summary={t('em.env.s', 'It reads DISCORD_TOKEN, BCWEB_API_URL and BOT_SHARED_SECRET from the environment.')}>
            <p>{t('em.env.d', 'The token is used only to talk to Discord and is never printed or sent to the site. --prune also deletes the older drawings of our own icons; emojis that are not ours are never touched. When the site cannot be reached, import app-emojis.json below instead.')}</p>
          </Explain>
        </Panel>

        {/* 2. Or import the map. */}
        <Panel className={SP.stack}>
          <Eyebrow>{t('em.step2', 'Import the map')}</Eyebrow>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ''; }} />
            <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}><FileJson size={13} /> {t('em.file', 'Choose app-emojis.json')}</Button>
            <span className="text-[11px] text-[var(--faint)]">{t('em.or', 'or paste it, or Discord’s own emoji list, below.')}</span>
          </div>
          <Textarea rows={4} value={paste} onChange={(e) => { setPaste(e.target.value); setIssues([]); }} className="font-mono !text-[11.5px]"
            placeholder='{ "emojis": { "bc_shop_1a2b3c4d": "123456789012345678" } }' aria-label={t('em.paste', 'The map, as JSON')} />
          {parsed && (
            <p className={`text-[11.5px] ${parsed.ok ? 'text-[var(--muted)]' : 'text-error'}`}>
              {parsed.ok
                ? [t('em.p.ok', '{n} emoji(s), {o} of them the bot’s own.').replace('{n}', Object.keys(parsed.emojis).length).replace('{o}', parsed.ours),
                  parsed.ignored ? t('em.p.ign', '{n} left out: a name must be lower-case letters, digits and _.').replace('{n}', parsed.ignored) : ''].filter(Boolean).join(' ')
                : parsed.error === 'json' ? t('em.p.json', 'This is not JSON.') : t('em.p.none', 'No emoji found in it.')}
            </p>
          )}
          {issues.length > 0 && <ul className="text-[11.5px] text-error list-disc ps-5">{issues.map((x) => <li key={x} className="break-words">{x}</li>)}</ul>}
          <div className="flex justify-end">
            <Button size="sm" variant="primary" disabled={!parsed?.ok || busy} onClick={importMap}>{busy ? <Spinner /> : <><Upload size={13} /> {t('em.import', 'Import')}</>}</Button>
          </div>
        </Panel>

        {/* 3. Every icon, and where it stands. */}
        <div className={SP.tight}>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
                className={`text-[11.5px] px-2 py-1 rounded-lg border transition-colors ${filter === k ? 'b-primary tint-primary text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)]'}`}>{label}</button>
            ))}
          </div>
          {!loading && (shown.length ? (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {shown.map((s) => {
                const { I, cls } = TONE[s.status];
                return (
                  <div key={s.key} className="flex items-start gap-2.5 rounded-lg border border-[var(--line)] px-2.5 py-2 min-w-0">
                    <img src={`/api/admin/bot/emoji-icon/${s.key}.png`} alt="" loading="lazy" className="w-6 h-6 rounded shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium break-words">{s.label}</div>
                      <div className="text-[11px] font-mono text-[var(--faint)] break-all">{s.status === 'present' ? s.emoji.name : s.want}</div>
                      {s.override && <div className="text-[11px] text-[var(--muted)]">{t('em.override', 'Your own emoji is used instead.')}</div>}
                    </div>
                    <span className={`inline-flex items-center gap-1 text-[11.5px] shrink-0 ${cls}`} title={STATUS[s.status]}><I size={12} className="shrink-0" /> {STATUS[s.status]}</span>
                  </div>
                );
              })}
            </div>
          ) : <p className="text-[11.5px] text-[var(--faint)]">{filter === 'attention' ? t('em.allgood', 'Every icon is on Discord at its current drawing.') : t('em.nothing', 'Nothing here.')}</p>)}
        </div>

        {/* 4. An icon of your own, added to the set without a code change. */}
        <CustomIcons onReload={reload} />

        {/* 4. One emoji of your own. */}
        <Panel className={SP.stack}>
          <Eyebrow>{t('em.one', 'Add one emoji of your own')}</Eyebrow>
          <p className="text-[11.5px] text-[var(--muted)]">{t('em.one.d', 'In Discord, type \\:emoji: and send it to copy its <:name:id>. An icon key replaces that icon everywhere; a new key can be used in bot texts as {ic:key}.')}</p>
          <div className="grid sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] gap-2 items-end">
            <Field label={t('em.one.key', 'Key')}>
              <Input value={nk.key} list="bot-emoji-keys" onChange={(e) => setNk({ ...nk, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32) })} placeholder="party" />
              <datalist id="bot-emoji-keys">{list.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</datalist>
            </Field>
            <Field label={t('em.one.token', 'The emoji')}>
              <Input value={nk.token} onChange={(e) => setNk({ ...nk, token: e.target.value })} placeholder="<:party:123456789012345678>" className="font-mono" />
            </Field>
            <Button size="sm" variant="primary" disabled={!keyOk || !tokenParsed} onClick={addCustom}><Plus size={13} /> {t('em.one.add', 'Add')}</Button>
          </div>
          {/* Or pick one the bot already carries. The map the script pushed lists every
              application emoji; these are the ones that are not ours, so an admin who
              uploaded an emoji on Discord can claim it for a key without copying a snowflake
              out of the developer portal by hand. */}
          {available.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] text-[var(--faint)]">{t('em.pick', 'Or pick one the bot already has:')}</div>
              <div className="flex flex-wrap gap-1.5">
                {available.slice(0, 40).map((e) => (
                  <button key={e.id} type="button" onClick={() => setNk((n) => ({ key: n.key || e.name.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32), token: e.token }))}
                    className={`inline-flex items-center gap-1.5 text-[11.5px] px-2 py-1 rounded-lg border transition-colors ${nk.token === e.token ? 'b-primary tint-primary text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)]'}`} title={e.token}>
                    <img src={`https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? 'gif' : 'png'}?size=32`} alt="" width={14} height={14} loading="lazy" className="rounded-sm" />
                    <span className="max-w-32 truncate" title={e.name}>{e.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {nk.token.trim() && !tokenParsed && <p className="text-[11.5px] text-error">{t('em.one.badtoken', 'That is not a custom emoji. It looks like <:name:123456789012345678>.')}</p>}
          {nk.key && !keyOk && <p className="text-[11.5px] text-error">{t('em.one.badkey', 'A key is 2 to 32 lower-case letters, digits or _.')}</p>}
          {custom.length > 0 && (
            <div className="space-y-1.5">
              {custom.map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 text-[12px]">
                  <code className="font-mono text-[var(--text)] shrink-0">{`{ic:${k}}`}</code>
                  <code className="font-mono text-[var(--faint)] min-w-0 flex-1 break-all">{v}</code>
                  <button type="button" onClick={() => onChange(k, '')} className="p-1 shrink-0 text-[var(--faint)] hover:text-error" title={t('common.remove', 'Remove')}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </Card>
  );
}

export default BotEmojiSyncCard;
