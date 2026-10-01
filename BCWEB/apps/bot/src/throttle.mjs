// Rate limits and buffers for the bot's expensive work (agent-bcw-bot): AI calls (/ask, the AI
// automod check) and heavy rendering (welcome banners). Two pieces, both in memory and both
// bounded, so a burst on one server can neither spend the platform's AI allowance in a minute
// nor queue work without end.
//
//   Bucket   a token bucket per key (a guild, a member): `capacity` calls at once, refilled at
//            `perMinute`. take() says yes or no and, on no, how long until the next token.
//            Ported from the idea of OFD's rateLimit(key, n, window) (packages/services redis.ts),
//            without Redis: the bot is one process.
//   Queue    a work buffer: at most `concurrency` tasks run, at most `maxQueued` wait, each
//            waits at most `maxWaitMs`. A task past any of those is refused with a reason
//            ('busy' | 'timeout') instead of piling up behind a slow provider.
//
// The API meters the real budget (monthly allowance, credits); this is only the first gate, so
// a refused call here costs the server nothing.

export class Bucket {
  constructor({ capacity = 5, perMinute = 5, maxKeys = 5000, now = () => Date.now() } = {}) {
    this.capacity = Math.max(1, capacity);
    this.rate = Math.max(0.01, perMinute) / 60_000; // tokens per ms
    this.maxKeys = maxKeys;
    this.now = now;
    this.keys = new Map();
  }

  /** Take `cost` tokens for `key`. { ok: true } or { ok: false, retryMs }. */
  take(key, cost = 1) {
    const t = this.now();
    let e = this.keys.get(key);
    if (!e) {
      // Bounded: the oldest key goes first (a Map keeps insertion order).
      if (this.keys.size >= this.maxKeys) this.keys.delete(this.keys.keys().next().value);
      e = { tokens: this.capacity, at: t };
      this.keys.set(key, e);
    }
    e.tokens = Math.min(this.capacity, e.tokens + (t - e.at) * this.rate);
    e.at = t;
    if (e.tokens >= cost) { e.tokens -= cost; return { ok: true }; }
    return { ok: false, retryMs: Math.ceil((cost - e.tokens) / this.rate) };
  }
}

export class Queue {
  constructor({ concurrency = 2, maxQueued = 20, maxWaitMs = 15_000 } = {}) {
    this.concurrency = Math.max(1, concurrency);
    this.maxQueued = Math.max(0, maxQueued);
    this.maxWaitMs = maxWaitMs;
    this.running = 0;
    this.waiting = [];
    this.stats = { done: 0, refused: 0, timedOut: 0 };
  }

  /** Run `fn` when a slot is free. Rejects with Error('busy') or Error('timeout'). */
  run(fn) {
    if (this.running < this.concurrency) return this.#start(fn);
    if (this.waiting.length >= this.maxQueued) { this.stats.refused += 1; return Promise.reject(Object.assign(new Error('busy'), { reason: 'busy' })); }
    return new Promise((resolve, reject) => {
      const job = { fn, resolve, reject, timer: null };
      job.timer = setTimeout(() => {
        const i = this.waiting.indexOf(job);
        if (i >= 0) this.waiting.splice(i, 1);
        this.stats.timedOut += 1;
        reject(Object.assign(new Error('timeout'), { reason: 'timeout' }));
      }, this.maxWaitMs);
      job.timer.unref?.();
      this.waiting.push(job);
    });
  }

  async #start(fn) {
    this.running += 1;
    try { return await fn(); }
    finally {
      this.running -= 1;
      this.stats.done += 1;
      const next = this.waiting.shift();
      if (next) { clearTimeout(next.timer); this.#start(next.fn).then(next.resolve, next.reject); }
    }
  }

  get size() { return this.waiting.length; }
}

// The bot's shared gates. Numbers chosen for one bot process serving many servers; the API
// keeps its own per-guild burst limit behind these.
export const gates = {
  askGuild: new Bucket({ capacity: 6, perMinute: 6 }),
  askMember: new Bucket({ capacity: 2, perMinute: 2 }),
  aiAutomodGuild: new Bucket({ capacity: 20, perMinute: 30 }),
  ai: new Queue({ concurrency: 3, maxQueued: 30, maxWaitMs: 20_000 }),
  render: new Queue({ concurrency: 2, maxQueued: 50, maxWaitMs: 30_000 }),
};
