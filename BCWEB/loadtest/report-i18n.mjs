// Strings for the stress report, EN + FR (the repo convention: every surface ships both —
// see guides/*_EN.md / *_FR.md). report.mjs emits KEYS, the renderers translate, so a new
// diagnosis line can't land in one language only.
//
// `**bold**` and `` `code` `` survive into both outputs: Markdown renders them natively and
// the HTML renderer converts them. Params interpolate as {name}.

export const DICT = {
  en: {
    'title': 'BCWEB stress report',
    'meta.target': 'Target',
    'meta.cores': 'cores',
    'meta.perLevel': 'Per level',
    'meta.levels': 'Levels',
    'meta.when': 'When',
    'meta.client': 'Client box',

    'readfirst': '**Read this first.** On loopback with one client box the upper levels are not real internet clients — one machine easily out-runs the server, and the anti-abuse rate limiter then sheds the flood **by design** (that shows up as non-2xx, *not* as errors). The honest signals are the **served req/s**, the **latency tail** (p99 / p99.9), and **where errors or timeouts first appear**.',

    'tile.peak': 'Peak clean throughput',
    'tile.anchor': 'Realistic blend (sizing anchor)',
    'tile.worstTail': 'Worst p99.9',
    'tile.noClean': 'no clean level',

    'headline': 'Headline',
    'headline.peak': '**Peak clean throughput:** ~**{rps} served req/s** (`{scenario}` @ {level}, {conns} conns) — p99 {p99}, p99.9 {p999}.',
    'headline.none': 'No fully clean level was recorded (every level saw an error or timeout) — the server is under-provisioned for even the lowest level tested, or the target was unreachable.',
    'headline.cwv': '**CWV note:** Core Web Vitals (LCP/INP/CLS) are browser-side and are collected by the in-app Web Vitals telemetry. The server-side lever on them is **TTFB**, which tracks the p50/p99 below — a faster served response is a faster TTFB is a faster LCP.',

    'chart.throughput': 'Throughput vs concurrency',
    'chart.throughput.desc': 'Where each curve stops rising is that path\'s ceiling on this hardware.',
    'chart.throughput.y': 'Served requests/sec (2xx only)',
    'chart.latency': 'Latency tail vs concurrency',
    'chart.latency.desc': 'p99.9 — the 1-in-1000 request. Log scale: a straight rise is an order-of-magnitude jump.',
    'chart.latency.y': 'p99.9 latency (ms · log scale)',

    'perScenario': 'Per scenario',
    'scenario': 'Scenario',

    'note.eventloop': '**Event-loop saturation** — a bare `/health` ping timed out or spiked past 1s during the flood, so the Node main thread is CPU-starved (a handler is doing too much synchronous work). This is the ceiling to raise first: profile the hottest handler, move CPU work off-thread (the native worker), add a replica.',
    'note.timeouts': '**Requests timed out** at the top of the ladder — the server accepted connections it could not finish in time. Past the knee it is over capacity; that concurrency needs another replica (or the work behind it is too slow).',
    'note.clean': '**No errors, no timeouts** at any level — the server stayed healthy under the whole ladder and shed excess load cleanly rather than falling over.',
    'note.throttled': 'At the top level, **most responses were non-2xx** — the anti-abuse rate limiter shedding the flood *by design*. That is protection, not a failure; "2xx/s" is the real served throughput. To measure a single route raw, raise `RATE_LIMIT_MAX` for the run or lower the levels.',
    'note.longtail': '**Long tail** (p99.9 ≫ p99) — a small fraction of requests hit something occasional and slow (GC pause, cold query, lock). Worth chasing for the p99.9 target specifically.',
    'note.knee': 'Cleanest sustained throughput ≈ **{rps} served req/s** at the **{level}** level ({conns} conns), p99 {p99}, p99.9 {p999}.',

    'minspec': 'Minimum server spec (extrapolated)',
    'minspec.intro': 'Anchored to the **`{scenario}`** scenario (the realistic blend / most conservative path, *not* the trivial /health peak): **{rps} served req/s on {cores} core(s)** (≈ {perCore} req/s/core), assuming **{rpm} requests/min per active user** ({usersPerCore} active users/core). Linear, conservative, and only as good as the anchor — a starting point, then measure.',
    'minspec.none': '_No clean capacity anchor was measured, so no extrapolation is given. Lower the levels or fix reachability, then re-run._',
    'minspec.users': 'Concurrent active users',
    'minspec.cpu': 'vCPU (API)',
    'minspec.ram': 'RAM (API)',
    'minspec.notes': 'Notes',
    'minspec.tier1': 'single small instance',
    'minspec.tier2': '1–2 replicas behind the edge',
    'minspec.tier3': 'horizontal replicas + managed Postgres + Redis',
    'minspec.tier4': 'multi-node + read replicas + CDN for static/feeds',
    'minspec.caveat': 'These are **API-tier** numbers. In practice the first ceiling is usually **Postgres** (connection pool + slow queries) and **Redis** memory, not API CPU — size those from the `db-read` scenario\'s knee, and put the static site + `catalog.json` behind a CDN so they never reach the origin. The API scales horizontally (stateless); the database does not for free.',

    'act': 'How to act on this',
    'act.1': '**Raise the knee** for whichever scenario saturates first: profile that handler, add DB indexes for the query, cache harder, or move CPU work to the native worker.',
    'act.2': '**Chase p99.9** where the long-tail note fired: it is almost always a cold query or a GC pause, not average throughput.',
    'act.3': '**Protect the origin**: the static site and `catalog.json` are the same bytes for everyone — a CDN in front makes the API numbers above almost irrelevant for public reads.',
    'act.4': '**Re-run after each change** and diff `report.json` — the knee moving up is the win condition.',

    'th.level': 'level', 'th.conns': 'conns', 'th.rps': 'req/s', 'th.ok': '2xx/s',
    'th.non2xx': 'non-2xx', 'th.err': 'err', 'th.to': 't/o', 'th.ping': 'ping p99',
    'generated': '_Escalating-concurrency load ladder across several endpoint mixes. Generated by `loadtest/run.mjs` — re-run to refresh. Machine-readable copy: `report.json`._',
  },

  fr: {
    'title': 'Rapport de stress BCWEB',
    'meta.target': 'Cible',
    'meta.cores': 'cœurs',
    'meta.perLevel': 'Par niveau',
    'meta.levels': 'Niveaux',
    'meta.when': 'Quand',
    'meta.client': 'Machine cliente',

    'readfirst': '**À lire d\'abord.** En loopback avec une seule machine cliente, les niveaux hauts ne représentent pas de vrais clients internet — une machine dépasse facilement le serveur, et le rate limiter anti-abus déleste alors le flood **par design** (ça apparaît en non-2xx, *pas* en erreurs). Les signaux honnêtes sont les **req/s servies**, la **queue de latence** (p99 / p99.9), et **où apparaissent les premières erreurs ou timeouts**.',

    'tile.peak': 'Débit propre maximal',
    'tile.anchor': 'Mélange réaliste (ancre de dimensionnement)',
    'tile.worstTail': 'Pire p99.9',
    'tile.noClean': 'aucun niveau propre',

    'headline': 'En résumé',
    'headline.peak': '**Débit propre maximal :** ~**{rps} req/s servies** (`{scenario}` @ {level}, {conns} connexions) — p99 {p99}, p99.9 {p999}.',
    'headline.none': 'Aucun niveau totalement propre n\'a été enregistré (chaque niveau a vu une erreur ou un timeout) — le serveur est sous-dimensionné même pour le niveau le plus bas testé, ou la cible était injoignable.',
    'headline.cwv': '**Note CWV :** les Core Web Vitals (LCP/INP/CLS) sont côté navigateur et sont collectés par la télémétrie Web Vitals de l\'app. Le levier côté serveur, c\'est le **TTFB**, qui suit les p50/p99 ci-dessous — une réponse servie plus vite = un TTFB plus court = un LCP plus court.',

    'chart.throughput': 'Débit selon la concurrence',
    'chart.throughput.desc': 'Là où chaque courbe cesse de monter, c\'est le plafond de ce chemin sur cette machine.',
    'chart.throughput.y': 'Requêtes/s servies (2xx uniquement)',
    'chart.latency': 'Queue de latence selon la concurrence',
    'chart.latency.desc': 'p99.9 — la requête sur 1000. Échelle log : une montée droite = un ordre de grandeur.',
    'chart.latency.y': 'Latence p99.9 (ms · échelle log)',

    'perScenario': 'Par scénario',
    'scenario': 'Scénario',

    'note.eventloop': '**Saturation de l\'event loop** — un simple ping `/health` a timeout ou dépassé 1s pendant le flood : le thread principal Node est affamé de CPU (un handler fait trop de travail synchrone). C\'est le plafond à relever en premier : profiler le handler le plus chaud, sortir le CPU du thread (le worker natif), ajouter une réplique.',
    'note.timeouts': '**Des requêtes ont timeout** en haut de l\'échelle — le serveur a accepté des connexions qu\'il ne pouvait pas finir à temps. Au-delà du coude, il est en surcapacité : cette concurrence demande une réplique de plus (ou le travail derrière est trop lent).',
    'note.clean': '**Aucune erreur, aucun timeout** à aucun niveau — le serveur est resté sain sur toute l\'échelle et a délesté le surplus proprement au lieu de tomber.',
    'note.throttled': 'Au niveau le plus haut, **la plupart des réponses étaient non-2xx** — le rate limiter anti-abus déleste le flood *par design*. C\'est une protection, pas un échec ; « 2xx/s » est le vrai débit servi. Pour mesurer une route brute, monte `RATE_LIMIT_MAX` le temps du run ou baisse les niveaux.',
    'note.longtail': '**Longue traîne** (p99.9 ≫ p99) — une petite fraction des requêtes tombe sur quelque chose d\'occasionnel et lent (pause GC, requête froide, verrou). À creuser spécifiquement pour l\'objectif p99.9.',
    'note.knee': 'Meilleur débit soutenu propre ≈ **{rps} req/s servies** au niveau **{level}** ({conns} connexions), p99 {p99}, p99.9 {p999}.',

    'minspec': 'Spécification serveur minimale (extrapolée)',
    'minspec.intro': 'Calée sur le scénario **`{scenario}`** (le mélange réaliste / le chemin le plus conservateur, *pas* le pic trivial de /health) : **{rps} req/s servies sur {cores} cœur(s)** (≈ {perCore} req/s/cœur), en supposant **{rpm} requêtes/min par utilisateur actif** ({usersPerCore} utilisateurs actifs/cœur). Linéaire, conservateur, et seulement aussi bon que son ancre — un point de départ, puis on mesure.',
    'minspec.none': '_Aucune ancre de capacité propre n\'a été mesurée, donc pas d\'extrapolation. Baisse les niveaux ou corrige l\'accessibilité, puis relance._',
    'minspec.users': 'Utilisateurs actifs simultanés',
    'minspec.cpu': 'vCPU (API)',
    'minspec.ram': 'RAM (API)',
    'minspec.notes': 'Notes',
    'minspec.tier1': 'une seule petite instance',
    'minspec.tier2': '1–2 répliques derrière l\'edge',
    'minspec.tier3': 'répliques horizontales + Postgres managé + Redis',
    'minspec.tier4': 'multi-nœuds + répliques de lecture + CDN pour le statique/les feeds',
    'minspec.caveat': 'Ce sont des chiffres **du tier API**. En pratique le premier plafond est généralement **Postgres** (pool de connexions + requêtes lentes) et la mémoire **Redis**, pas le CPU de l\'API — dimensionne-les depuis le coude du scénario `db-read`, et mets le site statique + `catalog.json` derrière un CDN pour qu\'ils n\'atteignent jamais l\'origine. L\'API scale horizontalement (sans état) ; la base de données non, pas gratuitement.',

    'act': 'Quoi en faire',
    'act.1': '**Relever le coude** du scénario qui sature en premier : profiler ce handler, ajouter des index DB pour la requête, cacher plus fort, ou sortir le CPU vers le worker natif.',
    'act.2': '**Chasser le p99.9** là où la note « longue traîne » s\'est déclenchée : c\'est presque toujours une requête froide ou une pause GC, pas le débit moyen.',
    'act.3': '**Protéger l\'origine** : le site statique et `catalog.json` sont les mêmes octets pour tout le monde — un CDN devant rend les chiffres ci-dessus presque sans objet pour les lectures publiques.',
    'act.4': '**Relancer après chaque changement** et differ `report.json` — le coude qui monte, c\'est la condition de victoire.',

    'th.level': 'niveau', 'th.conns': 'conn.', 'th.rps': 'req/s', 'th.ok': '2xx/s',
    'th.non2xx': 'non-2xx', 'th.err': 'err', 'th.to': 't/o', 'th.ping': 'ping p99',
    'generated': '_Échelle de charge à concurrence croissante sur plusieurs mélanges d\'endpoints. Généré par `loadtest/run.mjs` — relance pour rafraîchir. Copie lisible machine : `report.json`._',
  },
};

// Translator. Falls back to EN for a key a language hasn't got yet (so a missing string shows
// the English text rather than a raw key in the middle of a report).
export function tr(lang) {
  const d = DICT[lang] || DICT.en;
  return (key, params = {}) => {
    const s = d[key] ?? DICT.en[key] ?? key;
    return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? String(params[k]) : `{${k}}`));
  };
}

export const LANGS = Object.keys(DICT);

// Number grouping differs per language (1,835 vs 1 835) — the renderers format against this.
export const LOCALE = { en: 'en-US', fr: 'fr-FR' };
