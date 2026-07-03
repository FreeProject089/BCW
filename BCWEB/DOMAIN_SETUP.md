# BCWEB — Domain & HTTPS setup / Mise en place du domaine

How to move BCWEB from the local `http://localhost:5176` to your own domain with
automatic HTTPS. Caddy provisions and renews a Let's Encrypt certificate for you — no
manual cert handling.

---

## 🇬🇧 English

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

---

## 🇫🇷 Français

### 0. Prérequis
- Un serveur (VPS) avec Docker + Docker Compose et une **IP publique**.
- Un domaine que vous contrôlez (ex. `community.example.com`).
- **Ports 80 et 443 ouverts** sur ce serveur (le 80 est requis pour le challenge ACME
  de Let's Encrypt, le 443 sert le HTTPS).

### 1. Pointer le DNS vers le serveur
Chez votre fournisseur DNS, créez les enregistrements :

| Type | Nom | Valeur |
|---|---|---|
| `A` | `community.example.com` | l'IPv4 de votre serveur |
| `AAAA` (optionnel) | `community.example.com` | l'IPv6 de votre serveur |
| `A` (optionnel, télémétrie) | `telemetry.example.com` | l'IPv4 de votre serveur |

Attendez la propagation (`nslookup community.example.com` doit renvoyer votre IP).

### 2. Définir le domaine dans `.env`
Éditez `infra/compose/.env` :

```dotenv
# Domaine nu (SANS http://) → Caddy provisionne + renouvelle le HTTPS automatiquement.
SITE_DOMAIN=community.example.com
# URL publique complète AVEC https:// → callbacks OAuth, redirections Stripe, liens.
SITE_URL=https://community.example.com
# Optionnel : dashboard télémétrie sur son propre sous-domaine
TELEMETRY_DOMAIN=telemetry.example.com
```

> Le dev local garde `http://localhost:5176`. La production utilise un **domaine nu**
> pour `SITE_DOMAIN` — c'est ce qui déclenche l'activation du HTTPS par Caddy.

### 3. Démarrer
```sh
cd infra/compose
docker compose up -d          # recrée caddy/api avec le nouveau domaine
```
Caddy demande le certificat au premier démarrage (`docker compose logs -f caddy` pour
suivre). Ouvrez ensuite `https://community.example.com` — vous devriez avoir un cadenas
valide.

### 4. Mettre à jour les intégrations qui codent l'URL en dur
- **OAuth** (si utilisé) : dans les réglages développeur GitHub/Discord, mettez les URLs
  de callback à `https://community.example.com/api/auth/oauth/github/callback`
  (et `…/discord/callback`).
- **Stripe** (si utilisé) : pointez le webhook sur
  `https://community.example.com/api/hosting/webhook` et utilisez les clés live.

### 5. Notes
- Le mapping de port local `5176:5176` dans `docker-compose.yml` ne sert qu'aux tests
  locaux ; en production le trafic arrive sur 80/443. Vous pouvez le garder ou le retirer.
- Pour changer le port local plus tard, éditez `SITE_DOMAIN` (ex. `http://localhost:8080`)
  et le mapping `ports:` correspondant du service `caddy`, puis `docker compose up -d`.
