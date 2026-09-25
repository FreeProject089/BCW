// The Prisma CLI, run WITHOUT npm/npx.
//
// The api image ships no npm at runtime: apps/api/Dockerfile deletes npm, npx, corepack and
// yarn from the final stage, because the npm bundled with node:22-alpine carried HIGH and
// CRITICAL advisories (tar, brace-expansion, cross-spawn, …) in code the API never runs, and
// an `npx` at runtime is also a way to download and execute a package nobody reviewed.
// boot-migrate.mjs (every container start) and setup.mjs (first deploy) used to shell out to
// `npx prisma …`; they call this instead: the same node binary that runs the API, on the CLI
// entry of the `prisma` package the lockfile installed (package.json "bin": build/index.js).
//
// Resolved through Node's module resolution from this file, so it is the same answer in the
// image (/app/node_modules/prisma) and in a checkout (apps/api/node_modules/prisma).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Absolute path of the prisma CLI entry point (throws if prisma is not installed). */
export function prismaCliPath() {
  return require.resolve('prisma/build/index.js');
}

/** [executable, argsPrefix] for spawn/spawnSync: `node <prisma cli> ...args`. */
export function prismaSpawn(args = []) {
  return [process.execPath, [prismaCliPath(), ...args]];
}

/** The same, as one shell command string for execSync (both paths quoted: they may hold spaces). */
export function prismaShell(argString = '') {
  return `"${process.execPath}" "${prismaCliPath()}" ${argString}`.trim();
}
