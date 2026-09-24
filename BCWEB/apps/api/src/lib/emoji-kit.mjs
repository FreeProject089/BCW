// The offline kit for the bot's icons: a zip with every icon as bc_<key>_<version>.png, and two
// scripts that upload the missing ones to Discord from the owner's own machine.
//
// THE SCRIPTS ARE FIXED FILES (lib/emoji-kit/). They are read once, from disk, and served as they
// are: nothing stored on the site is ever written into them. That is the whole security story
// of a downloadable script (pentest R5): a script assembled from stored strings is a script an
// admin who can edit one of those strings can make run anything on the owner's PC, and a script
// that embeds a token hands the token to whoever gets the file. So they take no data but their
// own folder, ask for the token at run time (or read DISCORD_TOKEN), and talk to discord.com
// only. test/emoji-sync.test.mjs (section "pentest R5") pins it: the served bytes are identical whatever the database
// holds, and contain none of the stored strings or secrets the test plants.
//
// Line endings are normalised here rather than trusted to the checkout: cmd.exe misparses a
// .bat with LF endings, and `sh` chokes on a CR at the end of `set -eu`.
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`./emoji-kit/${name}`, import.meta.url), 'utf8');
const lf = (s) => s.replace(/\r\n?/g, '\n');
const crlf = (s) => lf(s).replace(/\n/g, '\r\n');

export const KIT_FILES = Object.freeze({
  'sync-icons.bat': { body: crlf(read('sync-icons.bat')), type: 'application/x-bat; charset=utf-8' },
  'sync-icons.sh': { body: lf(read('sync-icons.sh')), type: 'application/x-sh; charset=utf-8' },
  'README.txt': { body: crlf(read('README.txt')), type: 'text/plain; charset=utf-8' },
});

const FILE_NAME_RE = /^bc_[a-z0-9_]+_[0-9a-f]{8}$/;

/**
 * The zip. `icons` = [{ want }] (the emoji name, bc_<key>_<version>); `renderPng(key)` draws
 * one. A key whose name is not the strict shape is left out rather than written as a path.
 */
export async function buildEmojiKit(icons, renderPng) {
  const { default: archiver } = await import('archiver');
  const chunks = [];
  const zip = archiver('zip', { zlib: { level: 6 } });
  const done = new Promise((res, rej) => { zip.on('data', (d) => chunks.push(d)); zip.on('end', res); zip.on('error', rej); });
  const mode = { 'sync-icons.sh': 0o755 };
  for (const [name, f] of Object.entries(KIT_FILES)) zip.append(f.body, { name: `bettercommunity-icons/${name}`, mode: mode[name] || 0o644 });
  let n = 0;
  for (const s of icons) {
    if (!FILE_NAME_RE.test(s.want || '')) continue;
    const png = await renderPng(s.key);
    if (!png || !png.length) continue;
    zip.append(Buffer.from(png), { name: `bettercommunity-icons/icons/${s.want}.png` });
    n += 1;
  }
  zip.finalize();
  await done;
  return { zip: Buffer.concat(chunks), count: n };
}
