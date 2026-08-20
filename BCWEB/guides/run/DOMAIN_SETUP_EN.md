# BCWEB — Domain & HTTPS setup

*🇫🇷 [Version française](DOMAIN_SETUP_FR.md).*

How to move BCWEB from the local `http://localhost:5176` to your own domain with
automatic HTTPS. Caddy provisions and renews a Let's Encrypt certificate for you — no
manual cert handling.

---

### 0. Prerequisites
- A server (VPS/box) with Docker + Docker Compose and a **public IP**.
- A domain you control (e.g. `community.example.com`).
- **Ports 80 and 443 open** to the internet on that server (80 is required for the
  Let's Encrypt ACME challenge, 443 serves HTTPS).

### 1. Point DNS at the server

**A choice first.** Serving BCWEB from the bare domain (`example.com`) replaces whatever that
domain serves today — check it serves nothing else before touching its `A` record. A
sub-domain (`app.example.com`) leaves the rest alone and is undone in a minute, which is the
careful choice until the production run has actually gone well once.

At your DNS provider, create:

| Type | Name | Value | Why |
|---|---|---|---|
| `A` | `example.com` (or `app.`) | the server's IPv4 | the site |
| `AAAA` *(if you have IPv6)* | same | the server's IPv6 | — |
| `A` | `telemetry.example.com` | the same IPv4 | telemetry dashboard |
| `A` | `s3.example.com` | the same IPv4 | uploads — see §5, it also needs a Caddy block |

**Do not create `www.`** without first adding the Caddy block that redirects it: the
`Caddyfile` has a block for the site and one for telemetry only, so `www.` would answer an
empty 200 — not an error, a blank page.

**If you have a `CAA` record**, it must allow `letsencrypt.org`, or Caddy cannot get a
certificate and will fail in a loop:

```
example.com. CAA 0 issue "letsencrypt.org"
```

With no `CAA` at all any authority may issue — that is the default, and it works.

**Mail does not go through this stack** and its records are separate. If verification e-mails
come from a mailbox on your domain you need an `SPF` including your provider, `DKIM`, and a
`DMARC`. Mind `p=reject`: a message that fails alignment is not put in spam, it is **refused**
— so the sender in `SMTP_FROM` has to be a mailbox on that domain, not an address elsewhere.

Wait for propagation, then check all three:

```sh
nslookup example.com            # should return the server's IP
nslookup telemetry.example.com
nslookup s3.example.com
```

### 2. Set the domain in `.env`
Edit `infra/compose/.env`. **Six values** carry `localhost` in the template and all six have
to change — missing one breaks nothing at startup, only later and somewhere else:

```dotenv
# Bare domain (NO http://) → Caddy provisions + renews HTTPS automatically.
SITE_DOMAIN=community.example.com
# Full public URL WITH https:// → OAuth callbacks, Stripe redirects, e-mail links.
SITE_URL=https://community.example.com

# Session-cookie domain. ⚠ LEFT ON `localhost`, NOBODY CAN SIGN IN: a page served from
# community.example.com cannot accept a cookie scoped to localhost — the browser drops it
# without a word. Sign-in answers "welcome" and the next request arrives anonymous.
# The leading dot shares it with sub-domains (needed for telemetry).
COOKIE_DOMAIN=.example.com

# MinIO as the BROWSER sees it. Uploads never pass through the API: the browser gets a
# pre-signed URL and PUTs the bytes straight here. On localhost that is the visitor's own
# machine — attaching a file then does nothing, with no error.
S3_PUBLIC_ENDPOINT=https://s3.example.com

# Public base for hosted repos — this value goes INTO the addresses handed to BMM.
REPO_PUBLIC_BASE=https://community.example.com/repos

# Optional: telemetry dashboard on its own sub-domain (both, not just one).
TELEMETRY_DOMAIN=telemetry.example.com
TELEMETRY_PUBLIC_URL=https://telemetry.example.com
```

> Local dev keeps `http://localhost:5176`. Production uses a **bare domain** for
> `SITE_DOMAIN` — that is what turns Caddy's HTTPS on.

> **Secrets are mandatory in production.** The API **refuses to start** with
> `NODE_ENV=production` if `JWT_SECRET`, `BOT_SHARED_SECRET` or `LINK_LOOKUP_SECRET` are
> still at their repository values. `openssl rand -hex 32` for each. That refusal is
> deliberate: those values are readable by anyone who has the repository.

### 3. Bring it up
```sh
cd infra/compose
docker compose up -d          # recreates caddy/api with the new domain
```
Caddy will request the certificate on first boot (watch `docker compose logs -f caddy`).
Then open `https://community.example.com` — you should have a valid padlock.

### 4. Update the integrations that hardcode the URL
- **OAuth** (if used): in GitHub/Discord developer settings, set the callback URLs to
  `https://community.example.com/api/auth/oauth/github/callback` (and `…/discord/callback`).
- **Stripe** (if used): point the webhook endpoint at
  `https://community.example.com/api/hosting/webhook` and use live keys.

### 5. Notes

**Storage has its own block, inert by default.** Uploads never pass through the API: the
browser gets a pre-signed URL and PUTs the bytes straight at MinIO, so MinIO needs a public
address — and the site's CSP allows only `https:`, so a plain `:9000` would be refused by the
browser before it even left.

The `Caddyfile` already carries the block. Turning it on is **two** values plus the DNS
record:

```dotenv
S3_DOMAIN=s3.example.com                  # what Caddy serves (and certifies itself)
S3_PUBLIC_ENDPOINT=https://s3.example.com # what the browser gets inside the signed URL
```

then `docker compose up -d caddy api`. With no `S3_DOMAIN` the block carries a hostname
nobody can request and MinIO stays reachable on `:9000` as it is locally — which is what you
want in development.

⚠ Do **not** put a path prefix on that block. An S3 signature covers the host **and** the
path: rewriting either makes MinIO compute a different signature and answer
`403 SignatureDoesNotMatch`, which reads as "wrong credentials" and is nothing of the sort.

- The local `5176:5176` port mapping in `docker-compose.yml` is only needed for local
  testing; in production traffic comes in on 80/443. You can leave it or remove it.
- To change the local port later, edit `SITE_DOMAIN` (e.g. `http://localhost:8080`) and
  the matching `ports:` mapping for the `caddy` service, then `docker compose up -d`.
