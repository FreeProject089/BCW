// What the stack actually COSTS while it is being hit.
//
// The min-spec table in the report is an extrapolation: throughput per core, times an
// assumed per-user request rate. That answers "how many cores for N users" and says
// nothing about the thing an operator is actually sizing — how much CPU and memory each
// service eats, and which one runs out first. report.mjs admits as much ("Real memory is
// dominated by Postgres/Redis sizing"), and then leaves it to the reader.
//
// This samples `docker stats` while a level runs, so the report carries measured numbers
// beside the extrapolated ones. It is DESCRIPTIVE, not a benchmark of the host: the load
// generator runs on the same machine here, so its own CPU shows up too — which is exactly
// why the sampler reports per-service and never a single "the site uses X%".
import { spawn } from 'node:child_process';

/** One `docker stats --no-stream` sweep, as { service: { cpu, memMB } }. */
function sweep(timeoutMs = 4000) {
  return new Promise((resolve) => {
    // --no-stream so it prints one frame and exits. The format string keeps the parse to a
    // split on tabs rather than a regex over a table nobody promised to keep stable.
    const ps = spawn('docker', ['stats', '--no-stream', '--format', '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'], { windowsHide: true });
    let out = '';
    const done = (v) => { try { ps.kill(); } catch { /* already gone */ } resolve(v); };
    const timer = setTimeout(() => done(null), timeoutMs);
    ps.stdout.on('data', (d) => { out += d; });
    ps.on('error', () => { clearTimeout(timer); done(null); });   // no docker → no samples, not a crash
    ps.on('close', () => {
      clearTimeout(timer);
      const row = {};
      for (const line of out.split('\n')) {
        const [name, cpu, mem] = line.split('\t');
        if (!name || !cpu) continue;
        const c = parseFloat(String(cpu).replace('%', ''));
        // "89.12MiB / 15.51GiB" — the half before the slash is the one being used.
        const m = String(mem || '').split('/')[0].trim();
        const n = parseFloat(m);
        const unit = (m.match(/[A-Za-z]+$/) || [''])[0].toLowerCase();
        const memMB = Number.isFinite(n)
          ? (unit.startsWith('g') ? n * 1024 : unit.startsWith('k') ? n / 1024 : unit.startsWith('b') ? n / 1048576 : n)
          : null;
        if (Number.isFinite(c)) row[name] = { cpu: c, memMB: Number.isFinite(memMB) ? memMB : null };
      }
      done(Object.keys(row).length ? row : null);
    });
  });
}

/** Is docker reachable at all? Asked once, so a machine without it degrades to "no
 *  samples" instead of spawning a doomed process for every level of every scenario. */
export async function resourcesAvailable() {
  return (await sweep(6000)) !== null;
}

/** Sample until stop() is called, then reduce to peak + mean per service.
 *
 *  Peak AND mean, because they answer different questions: the mean is what the machine
 *  costs to run, the peak is what it has to survive. Sizing on the mean is how a box that
 *  looks comfortable falls over at the knee.
 */
export function sampleWhile(intervalMs = 1000) {
  const frames = [];
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      const f = await sweep();
      if (f) frames.push(f);
      // The sweep itself takes ~0.5-1s, so this paces rather than adds to it.
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();

  return {
    async stop() {
      stopped = true;
      await loop;
      if (!frames.length) return null;
      const names = [...new Set(frames.flatMap((f) => Object.keys(f)))];
      const per = {};
      for (const n of names) {
        const cpus = frames.map((f) => f[n]?.cpu).filter(Number.isFinite);
        const mems = frames.map((f) => f[n]?.memMB).filter(Number.isFinite);
        if (!cpus.length) continue;
        per[n] = {
          cpuPeak: Math.round(Math.max(...cpus) * 10) / 10,
          cpuMean: Math.round((cpus.reduce((a, b) => a + b, 0) / cpus.length) * 10) / 10,
          memPeakMB: mems.length ? Math.round(Math.max(...mems)) : null,
          memMeanMB: mems.length ? Math.round(mems.reduce((a, b) => a + b, 0) / mems.length) : null,
        };
      }
      const totalCpuPeak = Math.round(Object.values(per).reduce((a, s) => a + s.cpuPeak, 0) * 10) / 10;
      const totalMemPeak = Object.values(per).reduce((a, s) => a + (s.memPeakMB || 0), 0);
      // `busiest` is the one worth printing on a single line: sizing conversations are
      // about the service that saturates first, not about the sum.
      const busiest = Object.entries(per).sort((a, b) => b[1].cpuPeak - a[1].cpuPeak)[0];
      return {
        samples: frames.length,
        services: per,
        totalCpuPeak,
        totalMemPeakMB: Math.round(totalMemPeak),
        busiest: busiest ? { name: busiest[0], cpuPeak: busiest[1].cpuPeak } : null,
      };
    },
  };
}
