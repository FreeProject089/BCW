#!/usr/bin/env node
// Every variable docker-compose reads must be documented in .env.example, or listed here as
// deliberately internal.
//
// WHY
//
// 31 of the 58 variables compose reads were in neither place. Most were harmless plumbing,
// and three were not:
//
//   BOT_SHARED_SECRET   defaults to "dev-bot-secret"
//   LINK_LOOKUP_SECRET  defaults to "dev-link-secret"
//   REDIS_PASSWORD      defaults to "bcweb-redis-internal"
//
// Defaults written in the repository, undocumented in the template a deployer copies. Follow
// .env.example to production and you ship with all three — and nothing anywhere tells you,
// because the stack starts perfectly well on them.
//
// SMTP was the other kind of miss: EMAIL_ENABLED and SMTP_* were read by compose and absent
// from the example, so a deployer had no way to know e-mail needed configuring at all. No
// e-mail means no address verification and no password reset, discovered by a user who
// cannot sign up.
//
// This is a documentation gate, not a value gate: it checks that a variable is DESCRIBED
// somewhere a human will read, never what it is set to. Nothing here reads a real .env, and
// no secret is compared.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPOSE = join(HERE, '../../../infra/compose/docker-compose.yml');
const EXAMPLE = join(HERE, '../../../infra/compose/.env.example');

// Read by compose, never set by a deployer: container-to-container addresses, values the
// compose file computes, and the two the tunnel script writes at runtime. Listed rather than
// pattern-matched so adding one is a decision somebody makes on purpose.
const INTERNAL = new Set([
    // Service addresses inside the compose network.
    'DB_HOST', 'DB_PORT', 'DB_HOST_PORT', 'DB_URL_PARAMS',
    'DATABASE_URL', 'DIRECT_DATABASE_URL',
    'PGBOUNCER_UPSTREAM_HOST', 'PGBOUNCER_UPSTREAM_PORT',
    'S3_ENDPOINT', 'S3_REGION',
    'TELEMETRY_DATABASE_URL', 'TELEMETRY_INTERNAL_URL',
    'MINIO_API_CORS_ALLOW_ORIGIN',
    'NODE_OPTIONS',
    // Written by infra/tunnel.mjs while a tunnel is up, removed when it stops. Documenting
    // them as things to set would invite somebody to set them by hand and wonder why the
    // script keeps overwriting their value.
    'TUNNEL_DOMAIN', 'TELEMETRY_TUNNEL_DOMAIN',
]);

const compose = readFileSync(COMPOSE, 'utf8');
const example = readFileSync(EXAMPLE, 'utf8');

// Every substitution form compose accepts, not just the one with a default. `${VAR:?msg}`
// (error if unset) was missed by an earlier version of this pattern, which then reported
// JWT_SECRET as documented-but-unused — a check confidently telling somebody their session
// secret was dead configuration.
const referenced = new Set(
    [...compose.matchAll(/\$\{([A-Z0-9_]+)\s*(?::?[-?+][^}]*)?\}/g)].map((m) => m[1]),
);

// A COMMENTED `#VAR=` counts as documented, and that is the whole point of this file.
//
// Most of these variables are optional, and the example shows them commented out with the
// value to uncomment and a paragraph on what it costs to get wrong. An earlier version of
// this check counted only uncommented lines and reported 31 variables as "documented
// nowhere" — every one of which was documented, and better than the block I then appended
// on top of them.
//
// So the question is "is this variable DESCRIBED where a deployer will read it", never "is
// it switched on". Whether it is active is the deployer's business, not a gate's.
const documented = new Set(
    example.split('\n')
        .map((l) => l.trim().replace(/^#\s*/, ''))
        .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l))
        .map((l) => l.split('=', 1)[0].trim()),
);

const missing = [...referenced].filter((k) => !documented.has(k) && !INTERNAL.has(k)).sort();

// The other direction: a documented variable compose no longer reads is a line telling a
// deployer to configure something that does nothing.
const stale = [...documented].filter((k) => !referenced.has(k)).sort();

if (missing.length) {
    console.error('check-env-documented FAILED\n');
    console.error(`  ${missing.length} variable(s) read by docker-compose and documented nowhere:\n`);
    for (const k of missing) {
        const def = new RegExp(`\\$\\{${k}:?-([^}]*)\\}`).exec(compose)?.[1];
        console.error(`    ${k}${def ? `   (falls back to "${def}")` : ''}`);
    }
    console.error(
        '\n  Add each to infra/compose/.env.example with a comment saying what it does and what\n' +
        '  it should be in production — or to INTERNAL in this script if a deployer never sets it.\n' +
        '\n  A variable with a fallback is the dangerous kind: the stack starts fine without it,\n' +
        '  so nothing reveals that production is running on a value written in this repository.',
    );
    process.exit(1);
}

if (stale.length) {
    console.log(`ℹ .env.example documents ${stale.length} variable(s) compose no longer reads: ${stale.join(', ')}`);
}

console.log(`✓ env documented — ${referenced.size} compose variable(s): ${documented.size} in .env.example, ${INTERNAL.size} internal`);
