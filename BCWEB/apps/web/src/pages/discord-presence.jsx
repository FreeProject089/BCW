// The bot's Discord status: the coloured dot under its name and the line beside it.
//
// `config.presence` in the bot config (see the bot's features/presence.mjs and
// DEFAULT_BOT_CONFIG in the API's routes/bot.mjs). A controlled editor: the host owns the
// config object and saves it with the rest through PUT /admin/bot/config, so this file never
// writes on its own and cannot race the page's Save.
//
// THE PREVIEW IS THE POINT. The fields are a status, a type, a template with variables and two
// takeovers that replace the line when something is wrong. Nobody can read "Watching" + "{guilds}
// servers" + "health on" and know what members will see during an incident, so the preview
// runs the bot's own rule (lib/bot-presence.js, pinned against the bot by
// apps/bot/test/presence-parity.test.mjs) under three situations you pick.
import { useState } from 'react';
import { Plus, Trash2, ChevronLeft, ChevronRight, HeartPulse, CreditCard } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { Input, Field, Dropdown, Button, Explain } from '../ui/ui.jsx';
import { SP, Panel, Eyebrow, Check, NumField } from '../ui/discord-kit.jsx';
import { normPresence, presenceForSave, presencePreview, PRESENCE_VARS, PRESENCE_MAX_TEXT, PRESENCE_MAX_ROTATE, PRESENCE_MAX_INCIDENT, PRESENCE_MIN_ROTATE_SEC } from '../lib/bot-presence.js';
import { clamp } from '../lib/discord-config.js';

const DOT = { online: 'var(--success)', idle: 'var(--warning)', dnd: 'var(--error)', invisible: 'var(--faint)' };

/** A text field with its variables as one-click inserts and a count against Discord's 128. */
function LineField({ label, hint, value, onChange, vars, placeholder }) {
  const { t } = useI18n();
  return (
    <Field label={label} hint={hint}>
      <Input value={value} maxLength={PRESENCE_MAX_TEXT} placeholder={placeholder} aria-label={label}
        onChange={(e) => onChange(e.target.value)} />
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        {vars.map((v) => (
          <button key={v} type="button" onClick={() => onChange(`${value || ''}${value && !/\s$/.test(value) ? ' ' : ''}${v}`.slice(0, PRESENCE_MAX_TEXT))}
            className="text-[11px] font-mono px-1.5 py-0.5 rounded-md border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--line-strong)]"
            title={t('pr.ed.insert', 'Insert {v}').replace('{v}', v)}>{v}</button>
        ))}
        <span className="ms-auto text-[11px] text-[var(--faint)] tabular-nums">{(value || '').length}/{PRESENCE_MAX_TEXT}</span>
      </div>
    </Field>
  );
}

/**
 * `value` is `config.presence` as stored (any shape), `onChange` gets the next one, already in
 * the shape the bot reads. `status` is the heartbeat from GET /admin/bot/config, for real
 * numbers in the preview (optional).
 */
export function BotPresencePanel({ value, onChange, status, botName = 'BetterCommunity' }) {
  const { t } = useI18n();
  const v = normPresence(value);
  const set = (patch) => onChange(presenceForSave({ ...v, ...patch }));
  // Rotation rows are edited in the normalised shape (empty rows allowed while typing) and
  // cleaned only when another field changes; saving drops blank lines, as the bot would.
  const setRotate = (rotate) => onChange({ ...presenceForSave(v), rotate });
  const setIncident = (incidentLines) => onChange({ ...presenceForSave(v), incidentLines });
  const [scene, setScene] = useState('ok');
  const [tick, setTick] = useState(0);

  const guilds = Number(status?.guilds) || 12;
  const members = (status?.guildList || []).reduce((a, g) => a + (Number(g?.memberCount) || 0), 0) || Number(status?.users) || 3456;
  const TYPE = {
    playing: t('pr.type.playing', 'Playing'), watching: t('pr.type.watching', 'Watching'), listening: t('pr.type.listening', 'Listening to'),
    competing: t('pr.type.competing', 'Competing in'), custom: t('pr.type.custom', 'Custom status (the line alone)'),
  };
  const STATUS = { online: t('pr.st.online', 'Online'), idle: t('pr.st.idle', 'Idle'), dnd: t('pr.st.dnd', 'Do not disturb'), invisible: t('pr.st.invisible', 'Invisible') };
  const SITE_WORDS = { operational: t('pr.site.operational', 'all systems operational'), partial: t('pr.site.partial', 'partial outage'), major: t('pr.site.major', 'major outage'), unknown: t('pr.site.unknown', 'status unknown') };
  const SCENES = {
    ok: { label: t('pr.scene.ok', 'Everything is fine'), site: { state: 'operational', services: [], stripe: { state: 'operational', description: 'All Systems Operational' } } },
    incident: { label: t('pr.scene.incident', 'An incident on the status page'), site: { state: 'major', services: [{ label: 'API', state: 'down' }, { label: t('pr.scene.web', 'Website'), state: 'down' }], stripe: null } },
    stripe: { label: t('pr.scene.stripe', 'Stripe degraded'), site: { state: 'operational', services: [], stripe: { state: 'minor', description: 'Partially Degraded Service' } } },
  };
  const lines = [v.text, ...v.rotate].map((x) => x.trim()).filter(Boolean);
  const incLines = [v.healthText, ...v.incidentLines].map((x) => x.trim()).filter(Boolean);
  const shown = presencePreview({ ...v, enabled: true }, { guilds, members, site: SCENES[scene].site, tick, statusLabel: (s) => SITE_WORDS[s] });
  const prefix = shown && shown.type !== 'custom' ? TYPE[shown.type] : '';
  // How many different lines this situation cycles through: the arrows step through them.
  const cycle = shown?.incident ? (v.incidentMode === 'alternate' && lines.length ? 2 * Math.max(lines.length, incLines.length) : incLines.length) : shown?.source === 'stripe' ? 1 : lines.length;
  const why = !v.enabled ? t('pr.why.off', 'Off: the bot keeps the plain online dot and shows no line. This is what it would show once on.')
    : shown?.incident && v.incidentMode === 'alternate' ? t('prs.why.alt', 'During an incident, an incident line and one of your lines take turns every {s} seconds; the dot stays on the incident.').replace('{s}', v.rotateSec)
      : shown?.source === 'health' ? (incLines.length > 1
        ? t('prs.why.healthn', 'The incident lines have taken over, in turn every {s} seconds, and the dot follows how bad it is.').replace('{s}', v.rotateSec)
        : t('pr.why.health', 'The incident line has taken over, and the dot follows how bad it is.'))
        : shown?.source === 'stripe' ? t('pr.why.stripe', 'Stripe’s own status has taken over the line, and an online dot turns idle.')
          : lines.length > 1 ? t('pr.why.rotate', 'Line {i} of {n}, changing every {s} seconds.').replace('{i}', (tick % lines.length) + 1).replace('{n}', lines.length).replace('{s}', v.rotateSec)
            : null;

  return (
    <div className={SP.page}>
      <Check checked={v.enabled} onChange={(on) => set({ enabled: on })} className="!text-sm font-medium">{t('pr.enabled', 'Show a status on Discord')}</Check>

      {/* What members will see, under the situation picked beside it. */}
      <Panel className={SP.stack}>
        <div className="flex items-center gap-2 flex-wrap">
          <Eyebrow>{t('pr.preview', 'What members see')}</Eyebrow>
          <div className="flex flex-wrap gap-1.5 ms-auto">
            {Object.entries(SCENES).map(([k, s]) => (
              <button key={k} type="button" onClick={() => setScene(k)} aria-pressed={scene === k}
                className={`text-[11px] px-2 py-1 rounded-lg border transition-colors ${scene === k ? 'b-primary tint-primary text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)]'}`}>{s.label}</button>
            ))}
          </div>
        </div>
        <div className={`flex items-start gap-3 rounded-lg bg-[var(--surface-2)] px-3 py-2.5 ${v.enabled ? '' : 'opacity-60'}`}>
          <span className="relative shrink-0">
            <span className="grid place-items-center w-9 h-9 rounded-full bg-[var(--bg-solid)] text-[13px] font-semibold text-[var(--accent-ink)]">{botName.slice(0, 1)}</span>
            <span className="absolute -bottom-0.5 -end-0.5 w-3.5 h-3.5 rounded-full border-2 border-[var(--surface-2)]" style={{ background: DOT[shown?.status || 'online'] }} title={STATUS[shown?.status || 'online']} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-[var(--text)] break-words">{botName} <span className="text-[11px] font-normal text-[var(--faint)]">{STATUS[shown?.status || 'online']}</span></div>
            <div className="text-[12px] text-[var(--muted)] break-words">
              {shown?.text ? <>{prefix ? <span className="font-medium">{prefix} </span> : null}{shown.text}</> : <span className="text-[var(--faint)]">{t('pr.noline', 'No line: every line is empty.')}</span>}
            </div>
          </div>
          {cycle > 1 && (
            <span className="flex items-center gap-0.5 shrink-0">
              <button type="button" onClick={() => setTick((n) => (n + cycle - 1) % cycle)} className="p-1 rounded-md text-[var(--muted)] hover:text-[var(--text)]" title={t('pr.prev', 'Previous line')} aria-label={t('pr.prev', 'Previous line')}><ChevronLeft size={14} /></button>
              <button type="button" onClick={() => setTick((n) => (n + 1) % cycle)} className="p-1 rounded-md text-[var(--muted)] hover:text-[var(--text)]" title={t('pr.next', 'Next line')} aria-label={t('pr.next', 'Next line')}><ChevronRight size={14} /></button>
            </span>
          )}
        </div>
        {why && <p className="text-[11.5px] text-[var(--muted)]">{why}</p>}
      </Panel>

      <div className={`grid sm:grid-cols-2 ${SP.grid}`}>
        <Field label={t('pr.status', 'Dot')}>
          <Dropdown className="w-full" value={v.status} onChange={(s) => set({ status: s })} options={Object.entries(STATUS).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label={t('pr.type', 'Activity')}>
          <Dropdown className="w-full" value={v.type} onChange={(s) => set({ type: s })} options={Object.entries(TYPE).map(([value, label]) => ({ value, label }))} />
        </Field>
      </div>

      <LineField label={t('pr.text', 'The line')} value={v.text} onChange={(x) => set({ text: x })} vars={PRESENCE_VARS} placeholder="{guilds} servers"
        hint={t('pr.text.h', '{guilds} servers the bot is in, {members} members across them, {status} the status page in words, {stripe} Stripe’s own status.')} />

      {/* More lines, shown in turn. */}
      <div className={SP.tight}>
        <Eyebrow>{t('pr.rotate', 'More lines, shown in turn')}</Eyebrow>
        {v.rotate.map((line, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input className="flex-1 min-w-0" value={line} maxLength={PRESENCE_MAX_TEXT} aria-label={t('pr.rotate.n', 'Line {n}').replace('{n}', i + 2)}
              placeholder={t('pr.rotate.ph', 'e.g. {members} members')} onChange={(e) => setRotate(v.rotate.map((x, k) => (k === i ? e.target.value : x)))} />
            <button type="button" onClick={() => setRotate(v.rotate.filter((_, k) => k !== i))} className="p-1 text-[var(--faint)] hover:text-error shrink-0" title={t('common.remove', 'Remove')}><Trash2 size={13} /></button>
          </div>
        ))}
        <div className="flex items-center gap-3 flex-wrap">
          {v.rotate.length < PRESENCE_MAX_ROTATE && (
            <Button size="sm" variant="ghost" onClick={() => setRotate([...v.rotate, ''])}><Plus size={13} /> {t('pr.rotate.add', 'Add a line')}</Button>
          )}
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--muted)] ms-auto">
            {t('pr.rotate.every', 'Change every')}
            <NumField value={v.rotateSec} f={{ min: PRESENCE_MIN_ROTATE_SEC, max: 3600, int: true }} clamp={clamp} ariaLabel={t('pr.rotate.sec', 'seconds (30 minimum)')} onCommit={(n) => set({ rotateSec: n })} />
            {t('pr.rotate.sec', 'seconds (30 minimum)')}
          </span>
        </div>
      </div>

      {/* The two takeovers. */}
      <Panel className={SP.stack}>
        <Eyebrow>{t('pr.take', 'When something is wrong, the line changes')}</Eyebrow>
        <Check checked={v.health} onChange={(on) => set({ health: on })}>
          <HeartPulse size={12} className="shrink-0 text-[var(--faint)]" /> {t('pr.health', 'An incident on the status page takes over the line, and the dot turns idle or do not disturb')}
        </Check>
        {v.health && <LineField label={t('pr.healthText', 'Incident line')} value={v.healthText} onChange={(x) => set({ healthText: x })} vars={['{services}', ...PRESENCE_VARS]} placeholder="Incident: {services}"
          hint={t('pr.healthText.h', '{services} is what is down, in the status page’s own words.')} />}
        {v.health && (
          <div className={`${SP.tight} ps-5`}>
            {/* More incident lines, shown in turn during an incident. */}
            {v.incidentLines.map((line, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input className="flex-1 min-w-0" value={line} maxLength={PRESENCE_MAX_TEXT} aria-label={t('prs.inc.n', 'Incident line {n}').replace('{n}', i + 2)}
                  placeholder={t('prs.inc.ph', 'e.g. We are on it: {services}')} onChange={(e) => setIncident(v.incidentLines.map((x, k) => (k === i ? e.target.value : x)))} />
                <button type="button" onClick={() => setIncident(v.incidentLines.filter((_, k) => k !== i))} className="p-1 text-[var(--faint)] hover:text-error shrink-0" title={t('common.remove', 'Remove')} aria-label={t('common.remove', 'Remove')}><Trash2 size={13} /></button>
              </div>
            ))}
            {v.incidentLines.length < PRESENCE_MAX_INCIDENT && (
              <Button size="sm" variant="ghost" onClick={() => setIncident([...v.incidentLines, ''])}><Plus size={13} /> {t('prs.inc.add', 'Add an incident line')}</Button>
            )}
            {/* Switch to the incident lines, or add them to the rotation. */}
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('prs.mode', 'During an incident')}>
              {[['replace', t('prs.mode.replace', 'Show only the incident lines')], ['alternate', t('prs.mode.alternate', 'Mix them with my lines')]].map(([k, label]) => (
                <button key={k} type="button" onClick={() => set({ incidentMode: k })} aria-pressed={v.incidentMode === k}
                  className={`text-[11.5px] px-2 py-1 rounded-lg border transition-colors ${v.incidentMode === k ? 'b-primary tint-primary text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)]'}`}>{label}</button>
              ))}
            </div>
            <p className="text-[11px] text-[var(--faint)]">{t('prs.vars', 'Only {guilds}, {members}, {status}, {stripe} and {services} are filled in; anything else in braces is shown as typed.')}</p>
          </div>
        )}
        <Check checked={v.stripe} onChange={(on) => set({ stripe: on })}>
          <CreditCard size={12} className="shrink-0 text-[var(--faint)]" /> {t('pr.stripe', 'Stripe not fully working takes over the line (Stripe’s own published status)')}
        </Check>
        {v.stripe && <LineField label={t('pr.stripeText', 'Stripe line')} value={v.stripeText} onChange={(x) => set({ stripeText: x })} vars={PRESENCE_VARS} placeholder="Stripe: {stripe}" />}
        <Explain summary={t('pr.take.s', 'An incident wins over Stripe, and both win over the lines above.')}>
          <p>{t('pr.take.d', 'The bot checks the site’s status page and Stripe’s published status every two minutes. A failed check keeps the last answer: no answer never shows as an outage.')}</p>
        </Explain>
      </Panel>
    </div>
  );
}

export default BotPresencePanel;
