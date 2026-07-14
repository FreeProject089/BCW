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

Wait for DNS to propagate (`nslookup community.example.com` should return your IP).

### 2. Set the domain in `.env`
Edit `infra/compose/.env`:

```dotenv
# Bare domain (NO http://) → Caddy auto-provisions + renews HTTPS.
SITE_DOMAIN=community.example.com
# Full public URL WITH https:// → used for OAuth callbacks, Stripe redirects, links.
SITE_URL=https://community.example.com
# Optional: telemetry dashboard on its own subdomain
TELEMETRY_DOMAIN=telemetry.example.com
```

> Local dev keeps `http://localhost:5176`. Production uses a **bare domain** for
> `SITE_DOMAIN` (that's the switch that makes Caddy turn on HTTPS).

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
- The local `5176:5176` port mapping in `docker-compose.yml` is only needed for local
  testing; in production traffic comes in on 80/443. You can leave it or remove it.
- To change the local port later, edit `SITE_DOMAIN` (e.g. `http://localhost:8080`) and
  the matching `ports:` mapping for the `caddy` service, then `docker compose up -d`.
