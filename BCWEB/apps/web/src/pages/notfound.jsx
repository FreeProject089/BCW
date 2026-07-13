import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Home as HomeIcon, Trophy, Play, RotateCcw, Gamepad2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from './auth.jsx';
import { Card, Button } from '../ui/ui.jsx';
import Avatar from '../ui/Avatar.jsx';

const W = 340, H = 460;

// A tiny "Orb Fall" catcher — move the paddle to catch the orange BetterCommunity orbs
// (+1) and dodge the red ones (game over). Runs entirely client-side (canvas + rAF); the
// score is submitted to a leaderboard only if you're signed in. This is the 404 page.
export default function NotFound() {
  const { t } = useI18n(); const { user } = useAuth();
  const canvasRef = useRef(null);
  const g = useRef(null);                 // mutable game state (kept out of React)
  const [phase, setPhase] = useState('ready'); // ready | playing | over
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [board, setBoard] = useState([]);
  const [saved, setSaved] = useState(null); // { improved } after submitting

  const loadBoard = () => api.get('/game/leaderboard?game=orbfall').then((r) => setBoard(r.leaderboard || [])).catch(() => {});
  useEffect(() => { loadBoard(); }, []);

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
    const st = { px: W / 2, pw: 62, orbs: [], spawn: 0, speed: 1, score: 0, last: performance.now(), raf: 0, alive: true };
    g.current = st; setScore(0); setSaved(null); setPhase('playing');
    const loop = (now) => {
      if (!st.alive) return;
      const dt = Math.min(50, now - st.last); st.last = now; const f = dt / 16;
      st.speed += dt / 60000;                                  // gentle ramp
      st.spawn -= dt;
      if (st.spawn <= 0) { st.spawn = Math.max(360, 900 - st.score * 12); const bad = Math.random() < Math.min(0.42, 0.14 + st.score * 0.01); st.orbs.push({ x: 18 + Math.random() * (W - 36), y: -14, r: 11, bad, vy: (1.6 + Math.random() * 1.1) * st.speed }); }
      const py = H - 26;
      for (const o of st.orbs) o.y += o.vy * f;
      st.orbs = st.orbs.filter((o) => {
        if (o.y >= py - 10 && o.y <= py + 14 && Math.abs(o.x - st.px) < st.pw / 2 + o.r) {
          if (o.bad) { st.alive = false; end(st.score); return false; }
          st.score += 1; setScore(st.score); return false;
        }
        return o.y < H + 20;
      });
      // draw
      ctx.clearRect(0, 0, W, H);
      for (const o of st.orbs) {
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 7); ctx.fillStyle = o.bad ? '#ef4444' : col.primary; ctx.fill();
        ctx.beginPath(); ctx.arc(o.x - 3, o.y - 3, o.r / 3, 0, 7); ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fill();
      }
      ctx.fillStyle = col.primary; roundRect(ctx, st.px - st.pw / 2, py, st.pw, 9, 5); ctx.fill();
      st.raf = requestAnimationFrame(loop);
    };
    st.raf = requestAnimationFrame(loop);
  };

  // Controls — pointer / touch position the paddle; arrow keys nudge it.
  const move = (clientX) => { const st = g.current, c = canvasRef.current; if (!st?.alive || !c) return; const rect = c.getBoundingClientRect(); st.px = Math.max(st.pw / 2, Math.min(W - st.pw / 2, (clientX - rect.left) * (W / rect.width))); };
  useEffect(() => {
    const onKey = (e) => { const st = g.current; if (!st?.alive) return; if (e.key === 'ArrowLeft') st.px = Math.max(st.pw / 2, st.px - 26); if (e.key === 'ArrowRight') st.px = Math.min(W - st.pw / 2, st.px + 26); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); cancelAnimationFrame(g.current?.raf); if (g.current) g.current.alive = false; };
  }, []);

  return (
    <div className="max-w-4xl mx-auto text-center py-6">
      <div className="text-[86px] leading-none font-black text-[var(--primary)] tracking-tight select-none">404</div>
      <h1 className="text-2xl font-extrabold mt-1">{t('nf.title', 'Lost in space')}</h1>
      <p className="text-[var(--muted)] mt-1.5 mb-7">{t('nf.sub', "That page doesn't exist — but here's a game while you're here.")}</p>

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
                  {saved?.improved ? <div className="text-xs text-emerald-400 mb-2 inline-flex items-center gap-1"><Trophy size={12} /> {t('nf.newbest', 'New personal best!')}</div>
                    : user ? <div className="text-xs text-[var(--faint)] mb-2">{t('nf.best', 'Your best: {n}').replace('{n}', best)}</div>
                    : <div className="text-xs text-[var(--faint)] mb-2"><Link to="/auth" className="text-[var(--primary-2)] underline">{t('nf.signin', 'Sign in')}</Link> {t('nf.tosave', 'to save your score')}</div>}
                </>}
                <Button variant="primary" onClick={start}>{phase === 'over' ? <><RotateCcw size={16} /> {t('nf.again', 'Play again')}</> : <><Play size={16} /> {t('nf.play', 'Play')}</>}</Button>
                <div className="text-[11px] text-[var(--faint)] mt-3 leading-relaxed">{t('nf.how', 'Catch the orange orbs · dodge the red ones. Move with your mouse, finger, or ← →.')}</div>
              </div>
            </div>
          )}
        </div>

        {/* Leaderboard */}
        <Card className="p-4 w-full md:max-w-xs text-left">
          <div className="text-sm font-semibold flex items-center gap-2 mb-3"><Trophy size={15} className="text-amber-400" /> {t('nf.leaderboard', 'Leaderboard')}</div>
          {board.length ? <div className="space-y-1.5">
            {board.map((r) => (
              <div key={r.rank} className="flex items-center gap-2.5 text-sm">
                <span className={`w-5 text-center font-bold tabular-nums ${r.rank <= 3 ? 'text-amber-400' : 'text-[var(--faint)]'}`}>{r.rank}</span>
                {r.user ? <Avatar user={r.user} size={22} /> : <span className="w-[22px] h-[22px] rounded-full bg-[var(--surface-2)] grid place-items-center"><Gamepad2 size={12} className="text-[var(--faint)]" /></span>}
                <span className="flex-1 min-w-0 truncate">{r.user?.displayName || t('nf.anon', 'Anonymous')}</span>
                <span className="font-bold tabular-nums text-[var(--primary-2)]">{r.score}</span>
              </div>
            ))}
          </div> : <div className="text-sm text-[var(--faint)] py-3 text-center">{t('nf.noscores', 'No scores yet — be the first!')}</div>}
        </Card>
      </div>

      <Link to="/" className="inline-flex items-center gap-1.5 mt-8 text-sm text-[var(--muted)] hover:text-[var(--text)] transition"><HomeIcon size={15} /> {t('nf.home', 'Back to home')}</Link>
    </div>
  );
}

function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
