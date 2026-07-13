import { useEffect, useRef } from 'react';
import { Boxes, Music2, Server, Rocket, TrendingUp, Star, Newspaper } from 'lucide-react';

// Linear-style product showcase: a stylized app screenshot tilted in 3D that
// straightens as you scroll. Pure CSS 3D + a scroll listener (reliable everywhere).
export default function HeroShowcase() {
  const wrap = useRef(null);
  const card = useRef(null);
  useEffect(() => {
    const onScroll = () => {
      if (!wrap.current || !card.current) return;
      const rect = wrap.current.getBoundingClientRect();
      // progress 0 (just entering) → 1 (scrolled up past it)
      const p = Math.min(1, Math.max(0, 1 - (rect.top + rect.height * 0.3) / window.innerHeight));
      const rot = 24 * (1 - p);
      card.current.style.transform = `perspective(1600px) rotateX(${rot.toFixed(2)}deg) scale(${(0.96 + p * 0.04).toFixed(3)})`;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, []);

  const Stat = ({ icon: I, label, value }) => (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <I size={15} className="text-[var(--primary-2)]" />
      <div className="text-lg font-bold mt-1.5 leading-none">{value}</div>
      <div className="text-[10px] text-[var(--muted)] mt-1">{label}</div>
    </div>
  );

  return (
    <div ref={wrap} className="relative mt-4" style={{ perspectiveOrigin: 'center top' }}>
      {/* glow */}
      <div className="absolute inset-x-0 -top-10 mx-auto h-72 w-[80%] rounded-full blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(closest-side, var(--primary-glow), transparent)' }} />
      <div ref={card} className="relative will-change-transform" style={{ transformOrigin: 'center top', transition: 'transform .1s linear' }}>
        <div className="card overflow-hidden mx-auto max-w-4xl" style={{ boxShadow: '0 40px 90px -30px rgba(0,0,0,0.55)' }}>
          {/* window chrome */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--line)] bg-[var(--surface-2)]">
            <span className="w-3 h-3 rounded-full bg-red-400/70" /><span className="w-3 h-3 rounded-full bg-amber-400/70" /><span className="w-3 h-3 rounded-full bg-emerald-400/70" />
            <div className="flex-1 mx-4 h-6 rounded-md bg-[var(--bg-solid)] border border-[var(--line)] flex items-center px-3 text-[11px] text-[var(--faint)]">bettercommunity.app/dashboard</div>
          </div>
          {/* app body */}
          <div className="grid grid-cols-[150px_1fr] min-h-[300px] text-left">
            <aside className="border-r border-[var(--line)] p-3 bg-[var(--surface)] hidden sm:block">
              <div className="flex items-center gap-2 font-bold text-sm mb-4"><img src="/logo.png" alt="" className="w-5 h-5 rounded" /><span className="gradient-text">BC</span></div>
              {[[Boxes, 'BMM'], [Music2, 'BSM'], [Server, 'Repos'], [Rocket, 'Hosting'], [Newspaper, 'Blog']].map(([I, l], i) => (
                <div key={l} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs mb-0.5 ${i === 2 ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'}`}><I size={13} />{l}</div>
              ))}
            </aside>
            <main className="p-4">
              <div className="text-sm font-semibold mb-3">Overview</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
                <Stat icon={Boxes} label="Catalog items" value="128" />
                <Stat icon={Server} label="Server repos" value="34" />
                <Stat icon={TrendingUp} label="Pageviews" value="9.2k" />
                <Stat icon={Star} label="Featured" value="6" />
              </div>
              <div className="rounded-xl border border-[var(--line)] p-3">
                <div className="text-[11px] text-[var(--faint)] uppercase tracking-wider mb-2">Activity</div>
                <div className="flex items-end gap-1.5 h-20">
                  {[40, 65, 50, 80, 60, 95, 72, 88, 55, 78, 90, 68].map((h, i) => (
                    <div key={i} className="flex-1 rounded-t bg-gradient-to-t from-orange-500 to-amber-400" style={{ height: `${h}%`, opacity: 0.85 }} />
                  ))}
                </div>
              </div>
            </main>
          </div>
        </div>
      </div>
      {/* fade to background */}
      <div className="absolute inset-x-0 bottom-0 h-24 pointer-events-none" style={{ background: 'linear-gradient(to top, var(--bg), transparent)' }} />
    </div>
  );
}
