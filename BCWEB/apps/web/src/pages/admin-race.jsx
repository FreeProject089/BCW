// Admin → Discord bot → Economy → Casino → Race: the circuit (random, a built-in, or one
// imported from Paddock-Manager), the laps, the six cars' colours, equal machines or a
// realistic grid, incidents and pit stops — and a live preview of the film the bot posts.
// The settings live in the bot config at `economy.casino.race`; the API's renderer reads
// them for every race GIF (apps/api/src/lib/casino-race.mjs).
import { useMemo, useState } from 'react';
import { RefreshCw, Upload, Trash2, Flag } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { Button, Input, Field, Select, useToast } from '../ui/ui.jsx';

const BUILTIN = [['riviera', 'Riviera'], ['speedring', 'Speedring'], ['hairpin-park', 'Hairpin Park'], ['lakeside', 'Lakeside'], ['monza-nord', 'Monza Nord'], ['serpentine', 'Serpentine']];
const DEFAULT_COLOURS = ['#ef4444', '#3b82f6', '#22c55e', '#facc15', '#a855f7', '#f97316'];
const CAR_NAMES = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange'];

/** The imported-circuit shape (the Paddock-Manager export): one object or an array of them. */
function parseCircuits(text) {
  const raw = JSON.parse(text);
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.circuits) ? raw.circuits : [raw];
  return list.map((c) => {
    const pts = Array.isArray(c?.points) ? c.points : Array.isArray(c?.pts) ? c.pts : null;
    if (!pts || pts.length < 6) throw new Error('points');
    return { id: String(c.id || c.name || 'custom').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32), name: String(c.name || 'Custom').slice(0, 24), points: pts.map((p) => [Number(p[0]), Number(p[1])]), sectors: c.sectors, pit: c.pit };
  });
}

export function RaceConfig({ eco, set, Switch }) {
  const { t } = useI18n(); const toast = useToast();
  const race = eco.casino?.race || {};
  const setR = (k, v) => set('economy.casino.race', { ...race, [k]: v });
  const colours = Array.isArray(race.colours) && race.colours.length === 6 ? race.colours : DEFAULT_COLOURS;
  const circuits = Array.isArray(race.circuits) ? race.circuits : [];
  const [json, setJson] = useState('');
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const preview = useMemo(() => `/api/og/casino/race/win.gif?d=2|2&a=100&s=${seed}`, [seed]);
  const importJson = () => {
    try { const list = parseCircuits(json); setR('circuits', [...circuits.filter((c) => !list.some((n) => n.id === c.id)), ...list]); setJson(''); toast.success(t('db.race.imported', 'Circuit(s) imported. Save the config to keep them.')); }
    catch { toast.error(t('db.race.badjson', 'Not a circuit: expected { name, points: [[x, y], …] } with x and y between 0 and 1, at least 6 points.')); }
  };
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/40 p-3 space-y-3">
      <div className="text-xs font-semibold flex items-center gap-2"><Flag size={13} /> {t('db.race.title', 'Race')}</div>
      <p className="text-[11px] text-[var(--faint)] leading-snug">{t('db.race.d', 'The race film is a Paddock-Manager simulation run fast: a circuit, a few laps, six cars, pit stops, an incident now and then. The winner is drawn by the bot; the film ends on it. Pick where it runs and how.')}</p>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label={t('db.race.circuit', 'Circuit')} className="!mb-0">
          <Select value={race.circuit || 'builtin'} onChange={(e) => setR('circuit', e.target.value)}>
            <option value="builtin">{t('db.race.c.builtin', 'One of the built-ins, at random')}</option>
            <option value="random">{t('db.race.c.random', 'Generated — a new circuit every race')}</option>
            {BUILTIN.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            {circuits.map((c) => <option key={c.id} value={c.id}>{c.name} · {t('db.race.c.imported', 'imported')}</option>)}
          </Select>
        </Field>
        <Field label={t('db.race.laps', 'Laps')} className="!mb-0"><Input type="number" min={1} max={12} value={race.laps ?? 3} onChange={(e) => setR('laps', Math.min(12, Math.max(1, Number(e.target.value) || 3)))} /></Field>
        <div className="space-y-1.5 text-xs">
          <label className="flex items-center gap-2 cursor-pointer"><Switch checked={race.equalStats !== false} onChange={(v) => setR('equalStats', v)} /> <span>{t('db.race.equal', 'Equal cars (same machine for every seat)')}</span></label>
          <label className="flex items-center gap-2 cursor-pointer"><Switch checked={race.incidents !== false} onChange={(v) => setR('incidents', v)} /> <span>{t('db.race.incidents', 'Incidents and safety car')}</span></label>
          <label className="flex items-center gap-2 cursor-pointer"><Switch checked={race.pitStops !== false} onChange={(v) => setR('pitStops', v)} /> <span>{t('db.race.pits', 'Pit stops')}</span></label>
        </div>
      </div>
      <div>
        <div className="text-[11px] text-[var(--faint)] mb-1">{t('db.race.colours', 'Car colours')}</div>
        <div className="flex flex-wrap gap-2">
          {colours.map((c, i) => (
            <label key={i} className="flex items-center gap-1.5 text-[11px]">
              <input type="color" value={c} onChange={(e) => setR('colours', colours.map((x, j) => (j === i ? e.target.value : x)))} className="h-6 w-8 rounded border border-[var(--line)] bg-transparent p-0" aria-label={CAR_NAMES[i]} />
              <span>{t(`db.race.car.${i}`, CAR_NAMES[i])}</span>
            </label>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setR('colours', DEFAULT_COLOURS)}>{t('common.reset', 'Reset')}</Button>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <div className="text-[11px] text-[var(--faint)]">{t('db.race.import', 'Import circuits (Paddock-Manager export, JSON)')}</div>
          <textarea className="w-full h-24 rounded-md border border-[var(--line)] bg-[var(--bg-solid)] p-2 text-[11px] font-mono" placeholder='{ "name": "Spa", "points": [[0.1,0.6],[0.4,0.6],[0.5,0.3],[0.8,0.2],[0.9,0.5],[0.6,0.8]], "sectors": [0.34,0.66], "pit": [0.015,0.13] }' value={json} onChange={(e) => setJson(e.target.value)} />
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" onClick={importJson} disabled={!json.trim()}><Upload size={13} /> {t('db.race.importBtn', 'Import')}</Button>
            {circuits.map((c) => <span key={c.id} className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px]">{c.name}<button type="button" onClick={() => setR('circuits', circuits.filter((x) => x.id !== c.id))} aria-label={t('common.remove', 'Remove')}><Trash2 size={11} /></button></span>)}
          </div>
          <p className="text-[11px] text-[var(--faint)]">{t('db.race.fmt', 'Points are the corners of the loop as fractions of the frame (0–1); the start/finish straight runs from the first point to the second. Sectors and pit lane are optional fractions of the lap.')}</p>
        </div>
        <div className="space-y-1.5">
          <div className="text-[11px] text-[var(--faint)] flex items-center gap-2">{t('db.race.preview', 'Preview (saved settings)')} <button type="button" className="inline-flex items-center gap-1 hover:text-[var(--text)]" onClick={() => setSeed(Math.floor(Math.random() * 1e9))}><RefreshCw size={11} /> {t('db.race.another', 'another')}</button></div>
          <img src={preview} alt="" className="w-full max-w-[480px] rounded-lg border border-[var(--line)]" />
        </div>
      </div>
    </div>
  );
}
