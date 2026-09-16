// Admin → Discord bot → Economy → Casino → Race: the circuit (random, a built-in, or one
// imported from Paddock-Manager), the laps, the six cars' colours, equal machines or a
// realistic grid, incidents and pit stops — and a live drawing of the circuit that is
// selected RIGHT NOW in the form.
//
// The preview used to be a GIF of the SAVED settings, which is the one thing it must not be:
// the person is choosing, and what they were shown was what they had chosen last time. It is
// now an SVG drawn from the circuit the API resolves for the current form (the same
// pickCircuit the renderer calls), with the animated film kept as a separate, deliberate
// action that also takes the current settings rather than the saved ones.
//   POST /admin/economy/race/circuit          a dropped or pasted file → the stored circuit
//   POST /admin/economy/race/circuit/resolve  the current choice → the circuit it runs on
//   POST /admin/economy/race/preview.gif      the film of the current settings
// The geometry lives in ../lib/circuit.js, checked point for point against the renderer in
// apps/web/test/circuit.test.mjs.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Upload, Trash2, Flag, Film, FileJson, X, Check } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { Button, Input, Field, Select, useToast } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { layoutCircuit, pathD, circuitInfo } from '../lib/circuit.js';

const BUILTIN = [['riviera', 'Riviera'], ['speedring', 'Speedring'], ['hairpin-park', 'Hairpin Park'], ['lakeside', 'Lakeside'], ['monza-nord', 'Monza Nord'], ['serpentine', 'Serpentine']];
const DEFAULT_COLOURS = ['#ef4444', '#3b82f6', '#22c55e', '#facc15', '#a855f7', '#f97316'];
const CAR_NAMES = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange'];
const SECTOR_COLOURS = ['#ef4444', '#3b82f6', '#facc15'];
const MAX_FILE = 4 * 1024 * 1024;

/** The circuit as an SVG: sector-coloured outline, the pit lane, the start/finish bar. */
function CircuitDrawing({ circuit, width = 420, height = 180, thumb = false }) {
  const L = useMemo(() => (circuit ? layoutCircuit(circuit, { width, height, pad: thumb ? 4 : 10 }) : null), [circuit, width, height, thumb]);
  if (!L) return null;
  const [nx, ny] = L.startNormal || [0, 1];
  const bar = thumb ? [] : [-3, -2, -1, 0, 1, 2].map((k) => ({ k, x: L.start[0] + nx * k * 3, y: L.start[1] + ny * k * 3 }));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full rounded-lg border border-[var(--line)] bg-[#0d1522]" role="img" aria-hidden="true">
      <path d={pathD(L.track, true)} fill="none" stroke="#2b3240" strokeWidth={thumb ? 7 : 14} strokeLinejoin="round" strokeLinecap="round" />
      {L.sectors.map((piece, i) => <path key={i} d={pathD(piece)} fill="none" stroke={SECTOR_COLOURS[i]} strokeWidth={thumb ? 2 : 3} strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />)}
      <path d={pathD(L.track, true)} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1" strokeDasharray="5 7" />
      {L.pit.length > 1 && <path d={pathD(L.pit)} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeDasharray="2 5" />}
      {bar.map(({ k, x, y }) => <rect key={k} x={x - 2} y={y - 2} width="4.2" height="3.2" fill={k % 2 ? '#fff' : '#111'} />)}
    </svg>
  );
}

/** One line of facts about a circuit: what the import carried, or what it did not. */
function CircuitFacts({ circuit }) {
  const { t } = useI18n();
  const info = circuitInfo(circuit);
  if (!info) return null;
  const pct = (v) => `${Math.round(v * 100)}%`;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--faint)]">
      <span className="font-semibold text-[var(--text)]">{info.name}</span>
      {info.corners != null && <span>{info.corners} {t('db.race.corners', 'corners')}</span>}
      {info.length != null && <span>{info.length} m</span>}
      <span>{t('db.race.sectors', 'Sectors')} {pct(info.sectors[0])} / {pct(info.sectors[1] - info.sectors[0])} / {pct(1 - info.sectors[1])}</span>
      {/* Only an import can carry a pit lane; every other circuit gets the drawn approximation,
          so saying "pit lane found" about one of those would be a fact that is not a fact. */}
      {info.imported && <span>{info.hasPit ? t('db.race.pitfound', 'pit lane found') : t('db.race.nopit', 'no pit lane in the file')}</span>}
      {info.imported && <span className="rounded-full border border-[var(--line)] px-1.5">{t('db.race.c.imported', 'imported')}</span>}
    </div>
  );
}

export function RaceConfig({ eco, set, Switch }) {
  const { t } = useI18n(); const toast = useToast();
  const race = eco.casino?.race || {};
  const setR = (k, v) => set('economy.casino.race', { ...race, [k]: v });
  const colours = Array.isArray(race.colours) && race.colours.length === 6 ? race.colours : DEFAULT_COLOURS;
  const circuits = useMemo(() => (Array.isArray(race.circuits) ? race.circuits : []), [race.circuits]);
  const laps = race.laps ?? 3;
  const choice = race.circuit || 'builtin';

  const [json, setJson] = useState('');
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [resolved, setResolved] = useState(null);
  const [pending, setPending] = useState(null);   // a parsed file, shown before it is added
  const [drag, setDrag] = useState(false);
  const [film, setFilm] = useState(null);         // an object URL for the rendered GIF
  const [filming, setFilming] = useState(false);
  const fileRef = useRef(null);

  // The circuit the current choice actually runs on. The API resolves it (pickCircuit), so
  // "one of the built-ins, at random" shows the one the film would use for this seed.
  const key = useMemo(() => circuits.map((c) => c.id).join(','), [circuits]);
  useEffect(() => {
    let off = false;
    api.post('/admin/economy/race/circuit/resolve', { circuit: choice, circuits, seed })
      .then((r) => { if (!off) setResolved(r?.circuit || null); })
      .catch(() => { if (!off) setResolved(null); });
    return () => { off = true; };
    // `circuits` is depended on through `key`: the list only matters when its membership changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, key, seed]);

  // The film is of the settings as they were when it was asked for: drop it the moment any of
  // them move, so a stale GIF is never sitting under a changed form.
  useEffect(() => { setFilm((u) => { if (u) URL.revokeObjectURL(u); return null; }); }, [choice, key, seed, laps, colours.join(','), race.equalStats, race.incidents, race.pitStops]);
  useEffect(() => () => { if (film) URL.revokeObjectURL(film); }, [film]);

  const addCircuits = useCallback((list) => {
    setR('circuits', [...circuits.filter((c) => !list.some((n) => n.id === c.id)), ...list]);
    toast.success(t('db.race.imported', 'Circuit(s) imported. Save the config to keep them.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circuits, race]);

  const parse = async (raw, label) => {
    let body;
    try { body = JSON.parse(raw); }
    catch { toast.error(t('db.race.notcircuit', 'That is not a circuit. A Paddock-Manager export carries a list of segments; a hand-written one needs a name and points.')); return; }
    try {
      const r = await api.post('/admin/economy/race/circuit', body);
      setPending({ label, list: r.circuits });
    } catch {
      toast.error(t('db.race.notcircuit', 'That is not a circuit. A Paddock-Manager export carries a list of segments; a hand-written one needs a name and points.'));
    }
  };

  const takeFile = async (file) => {
    if (!file) return;
    if (file.size > MAX_FILE) { toast.error(t('db.race.toobig', 'That file is too large for a circuit.')); return; }
    await parse(await file.text(), file.name);
  };

  const renderFilm = async () => {
    setFilming(true);
    try {
      const res = await fetch('/api/admin/economy/race/preview.gif', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ circuit: choice, circuits, seed, laps, colours, equalStats: race.equalStats !== false, incidents: race.incidents !== false, pitStops: race.pitStops !== false }),
      });
      if (!res.ok) throw new Error('render');
      const url = URL.createObjectURL(await res.blob());
      setFilm((old) => { if (old) URL.revokeObjectURL(old); return url; });
    } catch { toast.error(t('db.race.filmfail', 'The film could not be rendered.')); }
    finally { setFilming(false); }
  };

  return (
    <div className="rounded-lg border border-[var(--line)] panel p-3 space-y-3">
      <div className="text-xs font-semibold flex items-center gap-2"><Flag size={13} /> {t('db.race.title', 'Race')}</div>
      <p className="text-[11px] text-[var(--faint)] leading-snug">{t('db.race.d', 'The race film is a Paddock-Manager simulation run fast: a circuit, a few laps, six cars, pit stops, an incident now and then. The winner is drawn by the bot; the film ends on it. Pick where it runs and how.')}</p>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label={t('db.race.circuit', 'Circuit')} className="!mb-0">
          <Select value={choice} onChange={(e) => setR('circuit', e.target.value)}>
            <option value="builtin">{t('db.race.c.builtin', 'One of the built-ins, at random')}</option>
            <option value="random">{t('db.race.c.random', 'Generated, a new circuit every race')}</option>
            {BUILTIN.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            {circuits.map((c) => <option key={c.id} value={c.id}>{c.name} · {t('db.race.c.imported', 'imported')}</option>)}
          </Select>
        </Field>
        <Field label={t('db.race.laps', 'Laps')} className="!mb-0"><Input type="number" min={1} max={12} value={laps} onChange={(e) => setR('laps', Math.min(12, Math.max(1, Number(e.target.value) || 3)))} /></Field>
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
        {/* ── the live preview ─────────────────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <div className="text-[11px] text-[var(--faint)] flex items-center gap-2 flex-wrap">
            {t('db.race.preview', 'The circuit you have selected')}
            {(choice === 'random' || choice === 'builtin') && (
              <button type="button" className="inline-flex items-center gap-1 hover:text-[var(--text)]" onClick={() => setSeed(Math.floor(Math.random() * 1e9))}>
                <RefreshCw size={11} /> {t('db.race.another', 'another')}
              </button>
            )}
          </div>
          {resolved ? <CircuitDrawing circuit={resolved} /> : <div className="h-[180px] rounded-lg border border-[var(--line)] bg-[var(--surface-2)]" />}
          {resolved && <CircuitFacts circuit={resolved} />}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--faint)]">
            <span>{laps} {t('db.race.laps', 'Laps').toLowerCase()}</span>
            {colours.map((c, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />
                {t(`db.race.car.${i}`, CAR_NAMES[i])}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="ghost" onClick={renderFilm} disabled={filming}><Film size={13} /> {filming ? t('common.loading', 'Loading…') : t('db.race.film', 'Render the animated film')}</Button>
            <span className="text-[11px] text-[var(--faint)]">{t('db.race.filmHint', 'The settings above, as the bot will post them')}</span>
          </div>
          {film && <img src={film} alt="" className="w-full max-w-[480px] rounded-lg border border-[var(--line)]" />}
        </div>

        {/* ── the import ───────────────────────────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="text-[11px] text-[var(--faint)]">{t('db.race.import', 'Import circuits (Paddock-Manager export, JSON)')}</div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); takeFile(e.dataTransfer?.files?.[0]); }}
            className={`rounded-md border border-dashed p-3 text-center text-[11px] ${drag ? 'border-[var(--primary)] bg-[var(--surface-2)]' : 'border-[var(--line)]'}`}
          >
            <FileJson size={16} className="mx-auto mb-1 text-[var(--faint)]" />
            <div>{t('db.race.drop', 'Drop a Paddock-Manager .json file here')}</div>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { takeFile(e.target.files?.[0]); e.target.value = ''; }} />
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => fileRef.current?.click()}><Upload size={13} /> {t('db.race.choose', 'Choose a file')}</Button>
          </div>

          {pending && (
            <div className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-2 space-y-2">
              <div className="text-[11px] font-semibold">{t('db.race.parsed', 'Read from the file')}{pending.label ? ` · ${pending.label}` : ''}</div>
              {pending.list.map((c) => (
                <div key={c.id} className="space-y-1">
                  <CircuitDrawing circuit={c} width={240} height={120} thumb />
                  <CircuitFacts circuit={c} />
                </div>
              ))}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => { addCircuits(pending.list); setPending(null); setJson(''); }}><Check size={13} /> {t('db.race.add', 'Add')}</Button>
                <Button size="sm" variant="ghost" onClick={() => setPending(null)}><X size={13} /> {t('common.cancel', 'Cancel')}</Button>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <textarea className="w-full h-20 rounded-md border border-[var(--line)] bg-[var(--bg-solid)] p-2 text-[11px] font-mono" placeholder='{ "name": "Spa", "points": [[0.1,0.6],[0.4,0.6],[0.5,0.3],[0.8,0.2],[0.9,0.5],[0.6,0.8]], "sectors": [0.34,0.66], "pit": [0.015,0.13] }' value={json} onChange={(e) => setJson(e.target.value)} />
            <Button size="sm" onClick={() => parse(json, '')} disabled={!json.trim()}><Upload size={13} /> {t('db.race.importBtn', 'Import')}</Button>
            <p className="text-[11px] text-[var(--faint)]">{t('db.race.fmt', 'A hand-written circuit is a loop of points as fractions of the frame (0 to 1); the start/finish straight runs from the first point to the second. Sectors and pit lane are optional fractions of the lap. A Paddock-Manager export is taken as it is: its own sectors, its own pit lane, its own pace.')}</p>
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] text-[var(--faint)]">{t('db.race.list', 'Imported circuits')}</div>
            {circuits.length === 0 && <div className="text-[11px] text-[var(--faint)]">{t('db.race.none', 'None yet.')}</div>}
            <div className="grid grid-cols-2 gap-2">
              {circuits.map((c) => (
                <div key={c.id} className="rounded-md border border-[var(--line)] p-1.5 space-y-1">
                  <CircuitDrawing circuit={c} width={180} height={90} thumb />
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-[11px]">{c.name}</span>
                    <button type="button" className="text-[var(--faint)] hover:text-[var(--error)]" onClick={() => setR('circuits', circuits.filter((x) => x.id !== c.id))} aria-label={t('common.remove', 'Remove')} title={t('common.remove', 'Remove')}><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
