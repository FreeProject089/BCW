# BCWEB — Mise en place du domaine & HTTPS

*🇬🇧 [English version](DOMAIN_SETUP_EN.md).*

Comment faire passer BCWEB du `http://localhost:5176` local à votre propre domaine avec
HTTPS automatique. Caddy provisionne et renouvelle un certificat Let's Encrypt pour vous —
aucune gestion manuelle de certificat.

---

### 0. Prérequis
- Un serveur (VPS) avec Docker + Docker Compose et une **IP publique**.
- Un domaine que vous contrôlez (ex. `community.example.com`).
- **Ports 80 et 443 ouverts** sur ce serveur (le 80 est requis pour le challenge ACME de
  Let's Encrypt, le 443 sert le HTTPS).

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

> Le dev local garde `http://localhost:5176`. La production utilise un **domaine nu** pour
> `SITE_DOMAIN` — c'est ce qui déclenche l'activation du HTTPS par Caddy.

### 3. Démarrer
```sh
cd infra/compose
docker compose up -d          # recrée caddy/api avec le nouveau domaine
```
Caddy demande le certificat au premier démarrage (`docker compose logs -f caddy` pour
suivre). Ouvrez ensuite `https://community.example.com` — vous devriez avoir un cadenas
valide.

### 4. Mettre à jour les intégrations qui codent l'URL en dur
- **OAuth** (si utilisé) : dans les réglages développeur GitHub/Discord, mettez les URLs de
  callback à `https://community.example.com/api/auth/oauth/github/callback`
  (et `…/discord/callback`).
- **Stripe** (si utilisé) : pointez le webhook sur
  `https://community.example.com/api/hosting/webhook` et utilisez les clés live.

### 5. Notes
- Le mapping de port local `5176:5176` dans `docker-compose.yml` ne sert qu'aux tests
  locaux ; en production le trafic arrive sur 80/443. Vous pouvez le garder ou le retirer.
- Pour changer le port local plus tard, éditez `SITE_DOMAIN` (ex. `http://localhost:8080`)
  et le mapping `ports:` correspondant du service `caddy`, puis `docker compose up -d`.
