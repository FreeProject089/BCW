# Other sites and apps on the same server

*🇫🇷 [Version française](CADDY_SITES_FR.md).*

You have another project that should answer on your domain — `shop.example.com`,
`docs.example.com`, `example.com/status` — over real HTTPS, on the normal ports 80 and 443,
on the same server as BetterCommunity. This guide is how, without touching the
BetterCommunity part of the Caddy config, and without one typo taking every site down.

**The short version:** one DNS record, one command.

```sh
node infra/caddy/site.mjs add host --domain shop.example.com --port 8081
```

The command writes one file, checks the **whole** Caddy config with Caddy itself, shows you
what changes, and only then reloads Caddy. If Caddy would refuse the config, nothing is
installed and the sites keep running.

---

## How it fits together

| Piece | What it is | Who edits it |
|---|---|---|
| `infra/caddy/Caddyfile` | BetterCommunity's config. Imports the two folders below. | nobody, to add a site |
| `infra/caddy/sites.d/` | one file per extra (sub-)domain | you, or `site.mjs add` |
| `infra/caddy/paths.d/` | one file per app on a path of the main domain | you, or `site.mjs add path` |
| `infra/caddy/templates/` | one commented template per case below | — |
| `infra/caddy/live/Caddyfile` | the ONE file Caddy runs: the base with every drop-in pasted in. Generated. | `site.mjs apply` only |
| `infra/caddy/backups/` | the previous live file, before every change (last 20) | `site.mjs` |
| `infra/caddy/entrypoint.sh` | picks the config Caddy starts with (see [At restart](#at-restart)) | — |

The drop-in folders are the **source of truth**; the live file is an **output**, regenerated
from them. That is what lets you regenerate it at any time, look at it, and install it either
automatically or by hand.

`sites.d/`, `paths.d/`, `static/`, `live/` and `backups/` belong to one server and are
git-ignored (`infra/caddy/.gitignore`): a `git pull` never touches them.

**HTTPS is Caddy's job, as it already is for the main site.** Caddy listens on 80 and 443,
gets a Let's Encrypt certificate for each name the first time the config loads, and renews
it. There is nothing to configure beyond the DNS record.

---

## Once: let Caddy see the folder

Today compose mounts **only** the base `Caddyfile` into the container, so Caddy cannot see
`sites.d/`, `live/` or `static/`. Two lines in the `caddy` service of
`infra/compose/docker-compose.yml`:

```yaml
  caddy:
    image: caddy:2-alpine
    command: ["sh", "/etc/caddy/entrypoint.sh"]      # ← add
    # …
    volumes:
      - ../caddy:/etc/caddy:ro                         # ← replaces ../caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
```

Keep `extra_hosts: - "host.docker.internal:host-gateway"` — the host case needs it. Then,
once (a few seconds of downtime):

```sh
cd infra/compose
docker compose up -d caddy
node ../caddy/site.mjs status        # "infra/caddy/ is mounted as a folder"
```

Two side benefits. A folder mount sees a file that `git pull` **replaced** (a single-file
mount keeps showing the old one until the container is recreated), and the start-up script
refuses to let one bad file take the platform down.

Until this is done, `site.mjs add … --no-apply`, `build` and `diff` work, and `apply` refuses
with these same lines.

---

## Add a site in three steps

1. **DNS.** At your DNS provider, an `A` record for the name → the server's public IPv4 (plus
   `AAAA` → its IPv6 if it has one). Same server as BetterCommunity, same IP.
2. **Run the other project on its own port** — anything except 80 and 443 (see below).
3. **`node infra/caddy/site.mjs add <case> …`** with the case from this table.

| Case | Command | DNS record |
|---|---|---|
| a program on this machine, on a port it already uses | `add host --domain shop.example.com --port 8081` | `A shop.example.com` → server IP |
| a container on the stack's Docker network | `add service --domain app.example.com --to myapp:3000` | `A app.example.com` → server IP |
| an app on a path of the main domain | `add path --path /status --to myapp:3000` (or `--port 8081`) | none — it is the site's own name |
| a folder of static files | `add static --domain docs.example.com --dir docs [--spa]` | `A docs.example.com` → server IP |
| `www.` (or an old name) → the main domain | `add redirect --domain www.example.com --to https://example.com` | `A www.example.com` → server IP |

Run it with no flags to be asked each question instead. Other flags: `--name` (file name),
`--force` (replace), `--no-apply` (write and validate only), `--dry-run` (print the file),
`--yes` (no confirmation — required from a script). `--http` serves plain HTTP, for local
tests on `*.localhost` names only.

After an apply the command also checks the two things that go wrong next: whether the name
resolves (and to what), and whether Caddy can actually reach the program behind it.

### "It must use ports 80 and 443"

It does — through Caddy. Only one program on a machine can listen on port 443, and here that
is Caddy. Visitors still reach `https://shop.example.com` on 443; Caddy terminates HTTPS and
forwards to the program on its own port. What changes is only the **program's** port:

- a program that insists on 80/443 by default (another nginx, another Caddy, a Node app with
  `PORT=80`): give it another port, e.g. 8081, and use the `host` case;
- another `docker compose` project that publishes `"80:80"` / `"443:443"`: remove those
  `ports:` lines — or change them to `"127.0.0.1:8081:80"` and use the `host` case — or,
  better, publish nothing and join this stack's network (next section);
- a program that terminates its own HTTPS: turn that off and let it speak plain HTTP on its
  port — Caddy does the HTTPS. Proxying to a program's own HTTPS (`reverse_proxy https://…`)
  is possible but needs certificate settings that this guide and the templates do not cover.

### Another compose project on the same network

The cleanest option for a containerised project: no host port at all, so nothing can clash.
In **that** project's compose file:

```yaml
services:
  myapp:
    # no `ports:` needed
    networks: [default, bcweb]
networks:
  bcweb:
    external: true
    name: bcweb_default
```

then `add service --domain app.example.com --to myapp:3000` — `3000` being the port the
program listens on **inside** its container. (`bcweb_default` is this stack's network: compose
names it after `name: bcweb`.)

### An app on a path — read this first

`example.com/status` shares the **origin** of BetterCommunity. Its JavaScript can call `/api`
with the visitor's session, so a flaw in that app is a flaw in BetterCommunity. It also
inherits the site's security headers, the Content-Security-Policy included, and it must be
built for a base path (an app that links to `/style.css` gets BetterCommunity's). The CLI
refuses the paths the site already routes (`/api`, `/hosting`, `/oauth2`, `/.well-known`,
…), but not the site's own pages: a path that is also a BetterCommunity page (`/blog`)
replaces that page. A sub-domain has none of these problems — prefer it.

---

## Regenerate, then replace: automatically or by hand

Everything goes through the same gate: **generate → validate with Caddy → show the diff →
back up → swap → reload**. A config Caddy refuses is never installed.

| I want to… | Command |
|---|---|
| see what would change | `node infra/caddy/site.mjs diff` (exit 1 when something differs) |
| regenerate and install it, automatically | `node infra/caddy/site.mjs apply` (asks; `--yes` to not ask) |
| regenerate into a file I read first | `node infra/caddy/site.mjs build --out review/Caddyfile` |
| install that reviewed file, with a backup | `node infra/caddy/site.mjs apply --from review/Caddyfile` |
| …or swap it in myself | copy it over `infra/caddy/live/Caddyfile`, then `node infra/caddy/site.mjs reload` |
| undo the last change | `node infra/caddy/site.mjs rollback` (`rollback list`, `rollback <name>`) |
| see every extra site and whether it is live | `node infra/caddy/site.mjs list` |
| turn one off | `node infra/caddy/site.mjs remove shop-example-com` (renamed to `.caddy.off`, kept) |
| know where things stand | `node infra/caddy/site.mjs status` |

- **Manual swap**: `reload` validates the installed file before reloading and refuses one that
  does not validate — do not skip it by calling `caddy reload` directly.
- **Editing by hand**: open the file in `sites.d/` (or copy a template there and replace its
  `__PLACEHOLDERS__`), then `apply`. Never edit `live/Caddyfile`: the next apply rewrites it.
- **After a `git pull`** that changed the base `Caddyfile`, the live file does not change on
  its own — that is the point of reviewing it. `status` says the sources moved; `diff` shows
  how; `apply` installs it.
- **Rollback** restores what Caddy runs, not your sources. If the change came from a drop-in,
  fix or `remove` it, or the next `apply` brings it back.
- An error from Caddy names the line **in your file**: `…Caddyfile.next:521 (=
  infra/caddy/sites.d/shop-example-com.caddy line 24)`.

Validation runs `caddy validate` in the stack's own caddy service (`docker compose run`), so
it uses your real `.env` — a second block for your main domain, for instance, is caught. Node
18+ and the docker CLI are all it needs on the server.

### At restart

`entrypoint.sh` starts Caddy on the **first** of these that validates, and logs its choice:

1. `live/Caddyfile` (the generated file, once one has been applied);
2. the base `Caddyfile` with `sites.d/` and `paths.d/`;
3. the base alone — BetterCommunity keeps running, only the extra sites are missing.

```sh
docker compose logs caddy | grep bcweb-caddy
```

A `WARNING` there means a file was edited by hand into something Caddy refuses: fix it, then
`site.mjs apply`.

---

## Security, briefly

- **Session cookies are stripped.** In production BetterCommunity's cookies are scoped to the
  parent domain (`COOKIE_DOMAIN=.example.com`) so the telemetry sub-domain can read them —
  which means every sub-domain receives them. The `service`, `host` and `path` templates
  remove `bcw_session`, `bcw_elevated` and `tele_session` before the request reaches the
  other app. If you write a drop-in by hand, keep that `header_up Cookie` line.
- **What stripping does not stop**: an app on a sub-domain can still *set* a cookie for the
  parent domain. Put only software you trust on a sub-domain of the BetterCommunity domain;
  a stranger's app belongs on a different domain.
- **HSTS covers every sub-domain.** The site sends `includeSubDomains`, so a browser that
  visited it will only use HTTPS for any `*.example.com`. Every site made here is HTTPS, so
  that is fine — but a sub-domain served by some **other** server must be HTTPS too.
- The CLI accepts only a strict alphabet in every value (host names, `name:port`, paths,
  an origin for redirects); nothing typed can open a directive or a block of its own.

---

## Troubleshooting

**The certificate is not issued** (browser warning, `docker compose logs caddy` shows
`obtaining certificate … error`):
- the name does not resolve to **this** server yet: `nslookup shop.example.com`. The CLI
  prints what it resolves to after an add. DNS can take minutes to hours to propagate;
- port 80 or 443 is closed to the internet (cloud firewall, `ufw`) — Let's Encrypt must reach
  port 80 or 443 of this server;
- a `CAA` record that does not allow `letsencrypt.org` (see [Domain & HTTPS](DOMAIN_SETUP_EN.md));
- the name is proxied by a CDN (Cloudflare "orange cloud"): set it to DNS-only while the
  certificate is issued;
- too many attempts: Let's Encrypt rate-limits failures. Fix the cause and wait — Caddy
  retries by itself.

**"Port already in use"** (`bind: address already in use` / `port is already allocated`):
- when starting the caddy container → another program holds 80 or 443. Find it with
  `sudo ss -ltnp 'sport = :443'`, move it to another port, and add it with the `host` case;
- when starting the **other** project → it tries to publish 80/443 itself: see
  ["It must use ports 80 and 443"](#it-must-use-ports-80-and-443).

**502 Bad Gateway** — Caddy is fine, the program behind it did not answer. `add` checks this
and prints Caddy's own reason; to re-check later:
`docker compose exec caddy wget -O /dev/null http://host.docker.internal:8081/`.
- `Connection refused` on a `host` site: the program is not running, is on another port, or
  listens only on `127.0.0.1`. From inside Docker on Linux, the host is the Docker bridge
  address, not `127.0.0.1`: make the program listen on `0.0.0.0` (with the port closed in
  the firewall) or on the bridge address (`ip -4 addr show docker0`, usually `172.17.0.1`);
- the same with `ufw` enabled: allow the Docker networks in —
  `sudo ufw allow from 172.16.0.0/12 to any port 8081 proto tcp`;
- `bad address 'myapp'` on a `service` site: no container by that name on Caddy's network —
  is it running, and did it join `bcweb_default`?
- the port after `:` is the one **inside** the container, not the published one.

**An empty page with status 200** — the name reaches Caddy but no block claims it: the site
was never applied (`site.mjs list` says "pending apply"), or the DNS points here for a name
you never added.

**A redirect loop on a path app** — a hand-written `paths.d/` file without the `vars … bc_mount
yes` line: the site's trailing-slash rule and the app fight over `/status/`. Start again from
`templates/path.caddy`.

**`apply` says the container does not see infra/caddy/** — the compose change in
[Once](#once-let-caddy-see-the-folder) is not in place (or the container was not recreated).

**Git Bash on Windows turns `--path /status` into `C:/Program Files/Git/status`** — write
`--path status`; the CLI adds the slash.
