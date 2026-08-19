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
At your DNS provider, create records for the host you'll use:

| Type | Name | Value |
|---|---|---|
| `A` | `community.example.com` | your server's IPv4 |
| `AAAA` (optional) | `community.example.com` | your server's IPv6 |
| `A` (optional, telemetry) | `telemetry.example.com` | your server's IPv4 |
| `A` (storage) | `s3.example.com` | your server's IPv4 — see §5 |

Wait for DNS to propagate (`nslookup community.example.com` should return your IP).

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

**MinIO is NOT behind Caddy.** The `Caddyfile` has a block for the site and one for
telemetry, none for storage — MinIO publishes port 9000 directly. So giving
`S3_PUBLIC_ENDPOINT` an `https://s3.example.com` assumes you add the block that serves it:

```
s3.example.com {
	reverse_proxy minio:9000
}
```

Without it the only public entrance is plain `:9000` with no certificate — and the site's CSP
allows only `https:` in `connect-src`, so the browser would refuse the upload. The kind of
detail you meet at the first real user's first attachment.

- The local `5176:5176` port mapping in `docker-compose.yml` is only needed for local
  testing; in production traffic comes in on 80/443. You can leave it or remove it.
- To change the local port later, edit `SITE_DOMAIN` (e.g. `http://localhost:8080`) and
  the matching `ports:` mapping for the `caddy` service, then `docker compose up -d`.
