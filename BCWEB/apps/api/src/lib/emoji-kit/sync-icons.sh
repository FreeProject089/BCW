#!/bin/sh
# BetterCommunity - put the bot's icons on Discord as application emojis (macOS / Linux).
#
# This file is the same for everybody: it is not generated from anything stored on the site,
# it holds no token and no address, and it downloads nothing. It reads the PNGs in the
# "icons" folder next to it, asks Discord which of them the application already has, uploads
# the ones it is missing, and writes app-emojis.json for you to import on the site.
#
# The bot token is asked for when it runs (typed hidden), or read from the DISCORD_TOKEN
# environment variable. It is sent to discord.com only, and never written to disk.
# Set BC_YES=1 to skip the "upload now?" question. Needs python3 (standard library only).
#
#   sh sync-icons.sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is needed to run this script (it only uses its standard library)."
  exit 1
fi
PROG=$(cat <<'PY'
import base64, getpass, json, os, re, sys, time, urllib.error, urllib.request
from datetime import datetime, timezone

API = 'https://discord.com/api/v10'
UA = 'DiscordBot (https://bettercommunity.ch, 1.0) BetterCommunity-emoji-kit'
HERE = sys.argv[1]
ICONS = os.path.join(HERE, 'icons')
OUT = os.path.join(HERE, 'app-emojis.json')
FILE_RE = re.compile(r'^bc_([a-z0-9_]+?)_([0-9a-f]{8})\.png$')
NAME_RE = re.compile(r'^[a-z0-9_]{2,32}$')
ID_RE = re.compile(r'^[0-9]{17,20}$')

print('')
print('BetterCommunity: bot icons to Discord application emojis')
print('---------------------------------------------------------')
if not os.path.isdir(ICONS):
    print("There is no 'icons' folder next to this script. Unzip the whole kit, then run it again.")
    sys.exit(1)
files = sorted(f for f in os.listdir(ICONS) if FILE_RE.match(f) and os.path.getsize(os.path.join(ICONS, f)) <= 262144)
if not files:
    print('The icons folder holds no bc_<key>_<version>.png file.')
    sys.exit(1)

token = os.environ.get('DISCORD_TOKEN', '').strip()
if not token:
    print('Paste the bot token (Discord Developer Portal > your application > Bot > Reset Token).')
    print('It is typed hidden, sent to discord.com only, and not saved anywhere.')
    token = getpass.getpass('Bot token: ').strip()
if not token:
    print('No token given. Nothing was done.')
    sys.exit(1)


def scrub(s):
    return str(s).replace(token, '[token]')


def call(method, path, body=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    headers = {'Authorization': 'Bot ' + token, 'User-Agent': UA}
    if data is not None:
        headers['Content-Type'] = 'application/json'
    for attempt in range(5):
        req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                if r.headers.get('X-RateLimit-Remaining') == '0' and r.headers.get('X-RateLimit-Reset-After'):
                    time.sleep(float(r.headers.get('X-RateLimit-Reset-After')) + 0.1)
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                j = json.loads(raw)
            except Exception:
                j = {}
            if e.code == 429:
                wait = float(j.get('retry_after', 1) or 1)
                print('  Discord asks to wait %.1fs' % wait)
                time.sleep(wait + 0.25)
                continue
            if e.code >= 500:
                time.sleep(attempt + 1)
                continue
            raise RuntimeError(scrub('Discord answered %d %s' % (e.code, j.get('message', ''))))
    raise RuntimeError('Discord is still rate limiting after 5 attempts.')


try:
    app_id = str(call('GET', '/applications/@me')['id'])
    items = list((call('GET', '/applications/%s/emojis' % app_id) or {}).get('items') or [])
except Exception as e:
    print('Could not read the application: ' + scrub(e))
    print('Check the token: it is the BOT token of the application, not a user token or the client secret.')
    sys.exit(1)

have = {str(e.get('name')): e for e in items if e and e.get('name')}
plan = []
for f in files:
    name = f[:-4]
    key = FILE_RE.match(f).group(1)
    older = [n for n in have if n != name and re.match(r'^bc_' + re.escape(key) + r'_[0-9a-f]{8}$', n)]
    status = 'present' if name in have else ('mismatched' if older else 'missing')
    plan.append((name, os.path.join(ICONS, f), status))

todo = [p for p in plan if p[2] != 'present']
print('')
print('Application: %d emoji(s) on Discord. Icons in this kit: %d.' % (len(items), len(plan)))
print('  on Discord: %d   older drawing only: %d   missing: %d' % (
    sum(1 for p in plan if p[2] == 'present'), sum(1 for p in plan if p[2] == 'mismatched'), sum(1 for p in plan if p[2] == 'missing')))
for name, _, status in todo:
    print('  %-11s %s' % (status, name))

failed = 0
if todo:
    if 2000 - len(items) < len(todo):
        print('Only room for %d more emoji(s): Discord allows 2000 per application.' % max(0, 2000 - len(items)))
    go = os.environ.get('BC_YES') == '1'
    if not go:
        try:
            go = re.match(r'^(y|yes|o|oui)$', input('Upload these %d icon(s) now? [y/N] ' % len(todo)).strip().lower()) is not None
        except EOFError:
            go = False
    if not go:
        print('Nothing uploaded.')
    else:
        for n, (name, path, _) in enumerate(todo, 1):
            try:
                with open(path, 'rb') as fh:
                    b64 = base64.b64encode(fh.read()).decode('ascii')
                e = call('POST', '/applications/%s/emojis' % app_id, {'name': name, 'image': 'data:image/png;base64,' + b64})
                have[str(e.get('name'))] = e
                print('  [%d/%d] uploaded %s' % (n, len(todo), name))
            except Exception as err:
                failed += 1
                print('  [%d/%d] FAILED %s: %s' % (n, len(todo), name, scrub(err)))
else:
    print('Every icon in the kit is already on Discord.')

# The map the site imports: every application emoji whose name and id it accepts.
emojis, animated = {}, []
for e in have.values():
    nm, i = str(e.get('name') or ''), str(e.get('id') or '')
    if NAME_RE.match(nm) and ID_RE.match(i):
        emojis[nm] = i
        if e.get('animated'):
            animated.append(nm)
with open(OUT, 'w', encoding='utf-8') as fh:
    json.dump({'appId': app_id, 'generatedAt': datetime.now(timezone.utc).isoformat(), 'emojis': emojis, 'animated': animated}, fh, indent=2)
    fh.write('\n')
print('')
print('Wrote %s (%d emoji(s)).' % (OUT, len(emojis)))
print('Last step: on the site, Discord bot > Icons on Discord > Import the map, choose app-emojis.json.')
if failed:
    print('%d upload(s) failed; run the script again to retry them.' % failed)
    sys.exit(2)
PY
)
exec python3 -c "$PROG" "$here"
