// Replace the placeholder secrets in infra/compose/.env with real ones.
//
// Why this exists: .env still carries the literal `change-me…` values from .env.example, and
// .env.example is committed to a PUBLIC repo. Anyone who reads the repo knows them. While
// everything listens on localhost that is theoretical; the moment a tunnel is opened, a known
// JWT_SECRET means anyone can forge an admin session.
//
// Why it is a script and not four commands: POSTGRES_PASSWORD has TWO sides. Postgres baked
// the password into its data volume the first time it started, and the env var is only read on
// that first init. Change .env alone and the API simply stops being able to connect. Both
// sides have to move together, and if anything fails in between, both have to go back.
//
//   node infra/rotate-secrets.mjs            # do it
//   node infra/rotate-secrets.mjs --dry-run  # show what would change, touch nothing
//
// Run it from the BCWEB directory.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DRY = process.argv.includes('--dry-run');
const HERE = dirname(fileURLToPath(import.meta.url));
const ENV = join(HERE, 'compose', '.env');
const BACKUP = ENV + '.bak';

// TELEMETRY_API_KEY is deliberately NOT here. BMM sends it, so rotating it breaks telemetry
// until the desktop app carries the new value — that is a two-repo change, not this one.
const ROTATE = ['JWT_SECRET', 'POSTGRES_PASSWORD', 'S3_SECRET_KEY', 'TELEMETRY_ADMIN_KEY'];

const gen = (n) => randomBytes(n).toString('base64url');
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

if (!existsSync(ENV)) {
    console.error(`No .env at ${ENV}. Run this from the BCWEB directory.`);
    process.exit(1);
}

const before = readFileSync(ENV, 'utf8');
const values = { JWT_SECRET: gen(48), POSTGRES_PASSWORD: gen(24), S3_SECRET_KEY: gen(24), TELEMETRY_ADMIN_KEY: gen(24) };

// Every key must actually be present. A regex that matches nothing would leave the placeholder
// in place and report success — the exact shape of failure this whole rotation is about.
let after = before;
for (const key of ROTATE) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (!re.test(after)) {
        console.error(`${key} is not in .env — nothing was changed.`);
        process.exit(1);
    }
    after = after.replace(re, `${key}=${values[key]}`);
}

if (DRY) {
    console.log('Would rotate:', ROTATE.join(', '));
    console.log('Would run ALTER USER against bcweb-db-1, then docker compose up -d.');
    console.log('Nothing was changed.');
    process.exit(0);
}

copyFileSync(ENV, BACKUP);
console.log(`Backed up .env → ${BACKUP}`);

// Postgres first. If this fails, .env is still the old one and the stack keeps working.
try {
    sh('docker', ['exec', 'bcweb-db-1', 'psql', '-U', 'bcweb', '-d', 'bcweb', '-c',
        `ALTER USER bcweb WITH PASSWORD '${values.POSTGRES_PASSWORD}';`]);
    console.log('Postgres password changed.');
} catch (e) {
    console.error('Could not change the Postgres password — is the stack up? Nothing was changed.');
    console.error(String(e.stderr || e.message).trim());
    process.exit(1);
}

// From here the two sides are out of step, so any failure restores BOTH.
const rollback = (why) => {
    console.error(`\n${why}\nRolling back…`);
    writeFileSync(ENV, before, 'utf8');
    try {
        const old = /^POSTGRES_PASSWORD=(.*)$/m.exec(before)[1];
        sh('docker', ['exec', 'bcweb-db-1', 'psql', '-U', 'bcweb', '-d', 'bcweb', '-c',
            `ALTER USER bcweb WITH PASSWORD '${old}';`]);
        sh('docker', ['compose', '--project-directory', join(HERE, 'compose'), 'up', '-d']);
        console.error('Rolled back. The stack is as it was.');
    } catch {
        console.error(`Rollback failed. Restore by hand: copy ${BACKUP} over .env, then`);
        console.error("  docker exec bcweb-db-1 psql -U bcweb -d bcweb -c \"ALTER USER bcweb WITH PASSWORD '<the old one from the backup>';\"");
    }
    process.exit(1);
};

writeFileSync(ENV, after, 'utf8');
console.log('.env updated.');

try {
    sh('docker', ['compose', '--project-directory', join(HERE, 'compose'), 'up', '-d']);
} catch (e) {
    rollback('The stack did not come back up.');
}

// Restarted is not the same as working: the API can be up and unable to reach the database.
// Poll rather than sleep-and-hope, and treat a still-failing probe as a failed rotation.
let ok = false;
for (let i = 0; i < 20; i++) {
    try {
        const out = sh('docker', ['exec', 'bcweb-api-1', 'node', '-e',
            "fetch('http://127.0.0.1:3000/ready').then(r=>process.stdout.write(String(r.status))).catch(()=>process.stdout.write('0'))"]);
        if (out.trim() === '200') { ok = true; break; }
    } catch { /* container still starting */ }
    execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},1500)']);
}
if (!ok) rollback('The API never became ready — it probably cannot reach the database.');

console.log('\nDone. The API is ready and talking to the database.');
console.log(`Old values are in ${BACKUP} — delete it once you are happy.`);
console.log('Everyone signed in has been signed out: rotating JWT_SECRET invalidates every session.');
