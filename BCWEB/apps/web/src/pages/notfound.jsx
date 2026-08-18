import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Home as HomeIcon, Trophy, Play, RotateCcw, Gamepad2, ChevronDown, Timer } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from './auth.jsx';
import { Card, Button } from '../ui/ui.jsx';
import Avatar from '../ui/Avatar.jsx';

const W = 340, H = 460;

// A tiny "Orb Fall" catcher — move the paddle to catch the orange BetterCommunity orbs
// (+1) and dodge the red ones (game over). Runs entirely client-side (canvas + rAF); the
// score is submitted to a leaderboard only if you're signed in. This is the 404 page.
/**
 * How much of the season is left, in the largest unit that is still honest.
 *
 * "Resets on the 1st" was true and useless: on the 2nd it means a month, on the 31st it means
 * hours, and the whole reason to look at a monthly board is to know which of those you are in.
 *
 * Days while there are days, then hours, then minutes — never "0 days", which reads as over
 * when there are still twenty hours to play. Returns null once the season has passed, so the
 * caller shows nothing rather than a negative number.
 */
function timeLeft(endsAt, t) {
    if (!endsAt) return null;
    const ms = new Date(endsAt).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const mins = Math.floor(ms / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (days >= 1) return t('nf.leftD', '{n} days left').replace('{n}', String(days));
    if (hours >= 1) return t('nf.leftH', '{n}h left').replace('{n}', String(hours));
    return t('nf.leftM', '{n} min left').replace('{n}', String(Math.max(1, mins)));
}

export default function NotFound() {
  const { t } = useI18n(); const { user } = useAuth();
  const canvasRef = useRef(null);
  const g = useRef(null);                 // mutable game state (kept out of React)
  const [phase, setPhase] = useState('ready'); // ready | playing | over
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [board, setBoard] = useState([]);
  const [saved, setSaved] = useState(null); // { improved } after submitting
  // The countdown is text, not state — but it has to be RECOMPUTED for the page to keep
  // telling the truth. A 404 with a leaderboard is a page people leave open; a minute tick is
  // enough for a unit that never gets finer than minutes, and cheap enough not to matter.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const [boardOpen, setBoardOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768); // collapsed by default on phones

  // Everything the endpoint says about the season, not a hand-copied subset.
  //
  // This used to be `{ season: r.season, prizes: r.prizes }`, and adding endsAt to the API
  // changed nothing on screen: the field arrived and was dropped one line later, silently,
  // exactly the way an allowlist serialiser drops a new column. A projection that has to be
  // edited every time the endpoint grows is a projection that will be forgotten.
  const [season, setSeason] = useState(null);   // the /game/leaderboard payload, minus the board
  const [awards, setAwards] = useState(null);   // last month's podium

  const loadBoard = () => api.get('/game/leaderboard?game=orbfall')
    .then((r) => { const { leaderboard, ...rest } = r; setBoard(leaderboard || []); setSeason(rest); })
    .catch(() => {});
  useEffect(() => {
    loadBoard();
    // Last month's podium, and — if you are on it — your code. Signed in or not: the winners
    // are public, the code is only ever returned to the person who won it.
    api.get('/game/awards?game=orbfall').then((r) => setAwards(r)).catch(() => {});
  }, []);

  // Resolve theme colours once (canvas can't use CSS vars directly).
  const colors = () => { const cs = getComputedStyle(document.documentElement); return {
    primary: cs.getPropertyValue('--primary').trim() || '#f97316',
    line: cs.getPropertyValue('--line-strong').trim() || 'rgba(128,128,128,.3)',
    text: cs.getPropertyValue('--text').trim() || '#1a1714',
  }; };

  const end = (finalScore) => {
    cancelAnimationFrame(g.current?.raf);
    setPhase('over'); setBest((b) => Math.max(b, finalScore));
    if (user) api.post('/game/score', { game: 'orbfall', score: finalScore }).then((r) => { setSaved({ improved: r.improved }); loadBoard(); }).catch(() => {});
    else setSaved(null);
  };

  const start = () => {
    const c = canvasRef.current; if (!c) return; const ctx = c.getContext('2d');
    const col = colors();
    // Slow-drifting starfield for depth (regenerated each game).
    const stars = Array.from({ length: 46 }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.4 + 0.3, s: Math.random() * 0.25 + 0.05 }));
    const st = { px: W / 2, kv: 0, pw: 60, orbs: [], parts: [], spawn: 0, speed: 1, score: 0, shake: 0, last: performance.now(), raf: 0, alive: true, stars };
    g.current = st; setScore(0); setSaved(null); setPhase('playing');
    const loop = (now) => {
      if (!st.alive) return;
      const dt = Math.min(50, now - st.last); st.last = now; const f = dt / 16;
      st.speed += dt / 34000;                                  // steeper ramp = harder over time
      st.pw = Math.max(38, 60 - st.score * 0.45);              // paddle shrinks as you score
      st.spawn -= dt;
      if (st.spawn <= 0) {
        st.spawn = Math.max(260, 820 - st.score * 16);          // faster spawns
        const bad = Math.random() < Math.min(0.52, 0.16 + st.score * 0.014); // more red over time
        const drift = (Math.random() - 0.5) * Math.min(1.6, st.score * 0.05); // sideways drift late-game
        st.orbs.push({ x: 20 + Math.random() * (W - 40), y: -14, r: bad ? 12 : 11, bad, vy: (1.9 + Math.random() * 1.2) * st.speed, vx: drift });
      }
      // Keyboard: accelerate towards a top speed, and stop dead when nothing is held. The
      // paddle is clamped to the walls rather than bouncing — a wall is where you park.
      const want = (keys.current.right ? 1 : 0) - (keys.current.left ? 1 : 0);
      st.kv = want ? Math.max(-7.2, Math.min(7.2, (st.kv || 0) + want * 0.9 * f)) : (st.kv || 0) * Math.pow(0.72, f);
      if (Math.abs(st.kv) < 0.02) st.kv = 0;
      if (st.kv) st.px = Math.max(st.pw / 2, Math.min(W - st.pw / 2, st.px + st.kv * f));

      const py = H - 26;
      for (const o of st.orbs) { o.y += o.vy * f; o.x += (o.vx || 0) * f; if (o.x < o.r || o.x > W - o.r) o.vx = -(o.vx || 0); }
      st.orbs = st.orbs.filter((o) => {
        if (o.y >= py - 12 && o.y <= py + 16 && Math.abs(o.x - st.px) < st.pw / 2 + o.r) {
          if (o.bad) { st.alive = false; burst(st, o.x, o.y, '#ef4444', 18); st.shake = 12; end(st.score); return false; }
          st.score += 1; setScore(st.score); burst(st, o.x, py, col.primary, 8); return false;
        }
        return o.y < H + 20;
      });
      // particles
      for (const pt of st.parts) { pt.x += pt.vx * f; pt.y += pt.vy * f; pt.vy += 0.12 * f; pt.life -= dt; }
      st.parts = st.parts.filter((pt) => pt.life > 0);
      st.shake = Math.max(0, st.shake - dt * 0.05);

      // ── draw ──
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      if (st.shake > 0.5) ctx.translate((Math.random() - 0.5) * st.shake, (Math.random() - 0.5) * st.shake);
      // starfield
      for (const s of st.stars) { s.y += s.s * f; if (s.y > H) { s.y = 0; s.x = Math.random() * W; } ctx.fillStyle = `rgba(255,255,255,${0.10 + s.r * 0.12})`; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill(); }
      // orbs (glow + highlight + faint trail)
      for (const o of st.orbs) {
        const cc = o.bad ? '#ef4444' : col.primary;
        ctx.globalAlpha = 0.18; ctx.fillStyle = cc; ctx.beginPath(); ctx.arc(o.x, o.y - o.vy, o.r * 0.9, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
        ctx.shadowColor = cc; ctx.shadowBlur = 14; ctx.fillStyle = cc; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.arc(o.x - o.r / 3, o.y - o.r / 3, o.r / 3.2, 0, 7); ctx.fill();
      }
      // particles
      for (const pt of st.parts) { ctx.globalAlpha = Math.max(0, pt.life / 400); ctx.fillStyle = pt.c; ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1;
      // paddle (glow)
      ctx.shadowColor = col.primary; ctx.shadowBlur = 12; ctx.fillStyle = col.primary; roundRect(ctx, st.px - st.pw / 2, py, st.pw, 9, 5); ctx.fill(); ctx.shadowBlur = 0;
      ctx.restore();
      st.raf = requestAnimationFrame(loop);
    };
    st.raf = requestAnimationFrame(loop);
  };
  // Spawn a little particle burst (catch / crash feedback).
  function burst(st, x, y, c, n) { for (let i = 0; i < n; i++) { const a = Math.random() * 7, sp = Math.random() * 2.6 + 0.6; st.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, r: Math.random() * 2 + 1, c, life: 400 }); } }

  // Controls — pointer / touch position the paddle; the keyboard drives it.
  const move = (clientX) => { const st = g.current, c = canvasRef.current; if (!st?.alive || !c) return; const rect = c.getBoundingClientRect(); st.px = Math.max(st.pw / 2, Math.min(W - st.pw / 2, (clientX - rect.left) * (W / rect.width))); };

  /**
   * Which arrow keys are DOWN, read by the game loop.
   *
   * It used to jump the paddle 26 px per keydown event, which meant the paddle moved at
   * whatever rate the operating system chose to repeat a held key: nothing for the first
   * half-second, then a stutter, and a different speed on every machine. Holding a key is a
   * state, so it is held as one and the loop accelerates towards a top speed — same frame,
   * same physics, same feel as the mouse.
   */
  const keys = useRef({ left: false, right: false });
  useEffect(() => {
    const which = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A' || e.key === 'q' || e.key === 'Q') return 'left';
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') return 'right';
      return null;
    };
    const down = (e) => {
      const k = which(e);
      if (!k) return;
      // Or the page scrolls under the game every time somebody dodges.
      e.preventDefault();
      keys.current[k] = true;
    };
    const up = (e) => { const k = which(e); if (k) keys.current[k] = false; };
    // A key held while the tab loses focus is never released, and the paddle would sail
    // into the wall and stay there.
    const blur = () => { keys.current.left = false; keys.current.right = false; };
    window.addEventListener('keydown', down, { passive: false });
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      cancelAnimationFrame(g.current?.raf); if (g.current) g.current.alive = false;
    };
  }, []);

  return (
    <div className="max-w-4xl mx-auto text-center py-6">
      {/* The page number, and one line. There were two headings above the game saying the
          same thing in different words — "Lost in space" over "that page doesn't exist" —
          and neither told anybody anything they had not worked out from the 404. */}
      <div className="text-[86px] leading-none font-black text-[var(--primary)] tracking-tight select-none">404</div>
      <p className="text-[var(--muted)] mt-1 mb-7">{t('nf.sub', 'That page does not exist. Have a game instead.')}</p>

      <div className="flex flex-col md:flex-row gap-6 items-start justify-center">
        {/* Game */}
        <div className="relative shrink-0 mx-auto" style={{ width: W }}>
          <canvas ref={canvasRef} width={W} height={H} onPointerMove={(e) => move(e.clientX)} onTouchMove={(e) => move(e.touches[0].clientX)}
            className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)]/40 touch-none w-full" style={{ aspectRatio: `${W}/${H}`, maxWidth: '100%' }} />
          <div className="absolute top-2.5 left-3 text-sm font-bold tabular-nums text-[var(--text)] bg-[var(--bg-solid)]/70 px-2 py-0.5 rounded-md backdrop-blur">{score}</div>
          {phase !== 'playing' && (
            <div className="absolute inset-0 grid place-items-center rounded-2xl bg-[var(--bg-solid)]/70 backdrop-blur-sm">
              <div className="text-center px-4">
                {phase === 'over' && <>
                  <div className="text-xs uppercase tracking-wider text-[var(--faint)]">{t('nf.gameover', 'Game over')}</div>
                  <div className="text-4xl font-black text-[var(--primary)] my-1">{score}</div>
                  {saved?.improved ? <div className="text-xs text-success mb-2 inline-flex items-center gap-1"><Trophy size={12} /> {t('nf.newbest', 'New personal best!')}</div>
                    : user ? <div className="text-xs text-[var(--faint)] mb-2">{t('nf.best', 'Your best: {n}').replace('{n}', best)}</div>
                    : <div className="text-xs text-[var(--faint)] mb-2"><Link to="/auth" className="text-[var(--primary-2)] underline">{t('nf.signin', 'Sign in')}</Link> {t('nf.tosave', 'to save your score')}</div>}
                </>}
                <Button variant="primary" onClick={start}>{phase === 'over' ? <><RotateCcw size={16} /> {t('nf.again', 'Play again')}</> : <><Play size={16} /> {t('nf.play', 'Play')}</>}</Button>
                <div className="text-[11px] text-[var(--faint)] mt-3 leading-relaxed">{t('nf.how', 'Catch orange, dodge red. Mouse, finger, or hold ← →.')}</div>
              </div>
            </div>
          )}
        </div>

        {/* Leaderboard — collapsible (collapsed by default on phones). */}
        <Card className="p-4 w-full md:max-w-xs text-left">
          <button onClick={() => setBoardOpen((v) => !v)} className="w-full text-sm font-semibold flex items-center gap-2 md:cursor-default" aria-expanded={boardOpen}>
            <Trophy size={15} className="text-warning" /> <span className="flex-1 text-left">{t('nf.leaderboard', 'Leaderboard')}</span>
            <ChevronDown size={16} className={`md:hidden text-[var(--faint)] transition-transform ${boardOpen ? 'rotate-180' : ''}`} />
          </button>
          {boardOpen && (board.length ? <div className="space-y-1.5 mt-3">
            {board.map((r) => (
              <div key={r.rank} className="flex items-center gap-2.5 text-sm">
                <span className={`w-5 text-center font-bold tabular-nums ${r.rank <= 3 ? 'text-warning' : 'text-[var(--faint)]'}`}>{r.rank}</span>
                {r.user ? <Avatar user={r.user} size={22} /> : <span className="w-[22px] h-[22px] rounded-full bg-[var(--surface-2)] grid place-items-center"><Gamepad2 size={12} className="text-[var(--faint)]" /></span>}
                <span className="flex-1 min-w-0 truncate">{r.user?.displayName || t('nf.anon', 'Anonymous')}</span>
                <span className="font-bold tabular-nums text-[var(--primary-2)]">{r.score}</span>
              </div>
            ))}
          </div> : <div className="text-sm text-[var(--faint)] py-3 text-center">{t('nf.noscores', 'No scores yet — be the first!')}</div>)}

          {/* What the month is for. The numbers come from the API rather than being written
              here, because they are the same numbers the codes are minted with and a page
              that disagrees with them is a page that promises the wrong discount. */}
          {boardOpen && season?.prizes && (
            <div className="mt-3 pt-3 border-t border-[var(--line)] text-[12px] text-[var(--muted)]">
              <div className="font-semibold text-[var(--text)] mb-1">
                {t('nf.prizes', 'Top 3 this month win a code')}
              </div>
              <div className="flex gap-1.5 flex-wrap mb-1.5">
                {season.prizes.podium.map((x) => (
                  <span key={x.rank} className="px-1.5 py-0.5 rounded bg-[var(--surface-2)] tabular-nums">
                    #{x.rank} · −{x.percentOff}%
                  </span>
                ))}
              </div>
              <div className="text-[11px] text-[var(--faint)]">
                {t('nf.prizeterms', 'On a {m}-month term or a basket of ${a} or more. One code, one person, not combinable.')
                  .replace('{m}', String(season.prizes.minMonths))
                  .replace('${a}', `$${Math.round(season.prizes.minAmountCents / 100)}`)}
              </div>
              {/* The code's own expiry, said where the prize is described rather than
                  discovered later: a code that outlives its season is a code somebody is
                  saving for a purchase they will make too late. */}
              {season.prizes.validDays != null && (
                <div className="text-[11px] text-[var(--faint)] mt-1">
                  {t('nf.prizevalid', 'A won code is valid for {n} days from the day it is awarded.')
                    .replace('{n}', String(season.prizes.validDays))}
                </div>
              )}
              <div className="text-[11px] text-[var(--faint)] mt-1 inline-flex items-center gap-1.5">
                <Timer size={11} className="shrink-0" />
                <span>
                  {t('nf.season', 'Board for {s}').replace('{s}', season.season)}
                  {timeLeft(season.endsAt, t)
                    ? ` \u00b7 ${timeLeft(season.endsAt, t)}`
                    : ` \u00b7 ${t('nf.resets', 'resets on the 1st')}`}
                </span>
              </div>
            </div>
          )}

          {/* Last month's podium. Your own code appears here and nowhere else. */}
          {boardOpen && awards?.awards?.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[var(--line)]">
              <div className="text-[12px] font-semibold mb-1.5">
                {t('nf.lastmonth', 'Winners — {s}').replace('{s}', awards.season)}
              </div>
              <div className="space-y-1">
                {awards.awards.map((a) => (
                  <div key={a.rank} className="flex items-center gap-2 text-[12px]">
                    <span className="w-4 text-center font-bold text-warning tabular-nums">{a.rank}</span>
                    <span className="flex-1 min-w-0 truncate">{a.user?.displayName || t('nf.anon', 'Anonymous')}</span>
                    <span className="tabular-nums text-[var(--muted)]">−{a.percentOff}%</span>
                  </div>
                ))}
              </div>
              {awards.awards.some((a) => a.code) && (
                <div className="mt-2 rounded-lg border border-[var(--primary)] p-2">
                  <div className="text-[11px] text-[var(--muted)]">{t('nf.yourcode', 'Your code')}</div>
                  <div className="font-mono text-[13px] font-bold text-[var(--primary-2)] break-all">
                    {awards.awards.find((a) => a.code).code}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <Link to="/" className="inline-flex items-center gap-1.5 mt-8 text-sm text-[var(--muted)] hover:text-[var(--text)] transition"><HomeIcon size={15} /> {t('nf.home', 'Back to home')}</Link>
    </div>
  );
}

function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
