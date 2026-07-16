# BCWEB — Guide de déploiement en production (FR)

> 🇬🇧 English version: [DEPLOY_EN.md](DEPLOY_EN.md)

Comment déployer toute la stack BetterCommunity Web (SPA + API Fastify + Postgres +
Redis + MinIO + bot Discord + télémétrie + Caddy) sur un vrai serveur, avec HTTPS
automatique. Tout tourne dans Docker Compose derrière Caddy.

---

## 1. Ce qu'il te faut

- Un serveur Linux (VPS ou box) avec **Docker + Docker Compose v2** et une **IP publique**.
- **Ports 80 et 443 ouverts** sur Internet (80 est requis pour le challenge ACME de
  Let's Encrypt, 443 sert le HTTPS).
- Un **domaine** que tu contrôles (ex. `community.example.com`) — et éventuellement un
  sous-domaine `telemetry.example.com`.
- Des clés Stripe (test ou live) si tu veux l'hébergement/boosts payants.

## 2. Cloner & configurer

```bash
git clone --recurse-submodules <ton-repo> bcweb
cd bcweb/BCW/BCWEB           # (le compose est sous infra/compose)
cp infra/compose/.env.example infra/compose/.env
```

Édite `infra/compose/.env` — les clés importantes :

| Clé | Rôle |
|---|---|
| `SITE_URL` | URL publique complète, ex. `https://community.example.com` (mails, redirections Stripe, liens du bot) |
| `SITE_DOMAIN` | Ton domaine **nu**, ex. `community.example.com` — Caddy s'y attache et **provisionne le HTTPS**. (Défaut dev local : `http://localhost:5176`) |
| `COOKIE_DOMAIN` | `.ton-domaine.com` (point initial) pour que le cookie de session atteigne aussi les sous-domaines (telemetry) |
| `POSTGRES_PASSWORD` | Un mot de passe DB solide |
| `JWT_SECRET` | Une longue chaîne aléatoire (`openssl rand -hex 32`) |
| `BOT_SHARED_SECRET` | Longue chaîne aléatoire — le secret partagé API↔bot |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Depuis le dashboard Stripe (voir §6) |
| `DISCORD_TOKEN` | Optionnel — sinon défini depuis le dashboard admin |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Identifiants du stockage objet (MinIO) |

> **Ne commit jamais `.env`.** Il contient des secrets réels et est gitignore. Seul
> `.env.example` est versionné.

## 3. Pointer le DNS vers le serveur

Chez ton fournisseur DNS :

| Type | Nom | Valeur |
|---|---|---|
| `A` | `community.example.com` | IPv4 du serveur |
| `AAAA` (optionnel) | `community.example.com` | IPv6 du serveur |
| `A` (optionnel) | `telemetry.example.com` | IPv4 du serveur |

Attends la propagation : `nslookup community.example.com` doit renvoyer ton IP.

## 4. Lancer la stack

```bash
cd infra/compose
docker compose up -d --build
docker compose ps            # chaque service doit être "healthy"/"running"
docker compose logs -f caddy # regarde le certificat TLS s'émettre
```

Caddy provisionne et renouvelle automatiquement un certificat Let's Encrypt pour
`SITE_DOMAIN` — **aucune gestion manuelle de certificat**. La première émission prend
quelques secondes une fois le DNS résolu.

L'API applique les migrations commitées au démarrage (`boot-migrate.mjs` → `prisma migrate
deploy`), le schéma est donc créé automatiquement. Va sur `https://community.example.com` —
l'app doit s'afficher en HTTPS.

## 5. Premier admin

1. Crée le premier compte via l'interface.
2. Passe-le admin en base (une seule fois) :
   ```bash
   docker compose exec db psql -U bcweb -d bcweb -c \
     "UPDATE \"User\" SET role='SUPERADMIN' WHERE email='toi@example.com';"
   ```
3. Recharge — la zone **Admin** est disponible (modération, quotas d'hébergement, bot,
   analytics, réglages).

## 6. Stripe (paiements)

1. Dans le dashboard Stripe, récupère ta **clé secrète** → `STRIPE_SECRET_KEY`.
2. Crée un endpoint webhook vers
   `https://community.example.com/hosting/webhook` (un alias `/webhook` marche aussi).
   Abonne au minimum : `checkout.session.completed`, `invoice.paid`,
   `invoice.payment_failed`, `customer.subscription.deleted`, `charge.refunded`.
3. Copie le **secret de signature** de l'endpoint (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.
4. `docker compose up -d api` pour recharger.

> **Sans `STRIPE_WEBHOOK_SECRET`, le webhook renvoie 503** — aucun paiement n'est
> enregistré ni provisionné. L'onglet admin **Discord bot → Payments** affiche un
> diagnostic ✓/✗ pour la clé Stripe + le secret webhook.
>
> **Test local :** `stripe listen --forward-to http://localhost:3000/hosting/webhook`
> et utilise le `whsec_…` affiché comme `STRIPE_WEBHOOK_SECRET`. Le conteneur API est
> sur **:3000** (pas le `:4242` d'exemple de Stripe).

## 7. Bot Discord (optionnel)

Soit tu définis `DISCORD_TOKEN` dans `.env`, soit tu le laisses vide et tu colles le
token dans l'onglet admin **Discord bot** (il se connecte sous ~20s, sans redémarrage).
L'app Discord doit avoir les intents privilégiés **Server Members + Message Content**
activés dans le Developer Portal.

## 8. Télémétrie (optionnel)

Le dashboard de télémétrie BMM tourne dans son propre service (`telemetry` +
`telemetry-db`). Pointe `telemetry.example.com` vers le serveur et définis
`TELEMETRY_INTERNAL_URL` + `TELEMETRY_ADMIN_KEY` dans `.env` pour gérer ses limites
depuis l'admin BCWEB.

## 8b. SSO — « Se connecter avec BetterCommunity » (provider OpenID Connect)

BCWEB est un **fournisseur OpenID Connect** standard — d'autres services (les tiens ou
tiers) peuvent laisser les gens se connecter avec leur compte BetterCommunity. **Zéro
config** : la clé de signature RS256 est générée automatiquement à la première utilisation
et l'issuer est ton `SITE_URL`. Caddy route déjà `/.well-known/*` et `/oauth2/*` vers l'API.

1. **Enregistre le client** dans Admin → **SSO / OAuth** : un nom, la/les redirect URI(s), et
   les scopes (`openid`, `profile`, `email`). Tu obtiens un **client_id**, et pour un client
   confidentiel (serveur) un **client_secret affiché une seule fois** (garde-le ; tu peux le
   faire tourner). Les clients publics (SPA / mobile) utilisent **PKCE** et n'ont pas de secret.
2. **Pointe la lib OIDC du client sur le document de découverte** — il trouve tout le reste :
   ```
   https://community.example.com/.well-known/openid-configuration
   ```
   Il annonce les endpoints authorize / token / userinfo / jwks / revoke, `RS256`, et PKCE `S256`.

Flux : **authorization code + PKCE** standard ; écran de consentement brandé (mémorisé après
la première fois) ; tokens RS256 (vérifiés via le JWKS) ; les refresh tokens **tournent** (la
réutilisation est détectée et révoque toute la famille de tokens).

## 8c. Email (confirmation de compte + réinitialisation du mot de passe)

L'email transactionnel est **désactivé par défaut** — sans lui, la réinitialisation du mot de
passe renvoie le token dans la réponse de l'API (flux dev) et aucun email de confirmation
n'est envoyé. Pour l'activer en production, mets ceci dans `.env` puis `docker compose up -d api` :
```
EMAIL_ENABLED=true
SMTP_HOST=smtp.ton-fournisseur.com
SMTP_PORT=587                # 465 = TLS implicite, sinon STARTTLS
SMTP_USER=…
SMTP_PASS=…
SMTP_FROM=BetterCommunity <no-reply@ton-domaine.com>
```
Une fois activé : les nouvelles inscriptions reçoivent un **email de confirmation** (lien →
`/verify-email`), et les **réinitialisations** envoient un lien valable 1 heure (→
`/auth?reset=…`). Les deux tokens sont à usage unique. N'importe quel fournisseur SMTP
convient — celui de ton hébergeur, SendGrid, Mailgun, Amazon SES, ou un relais auto-hébergé.

## 9. Mise à jour

```bash
git pull --recurse-submodules
cd infra/compose
docker compose up -d --build      # reconstruit les images modifiées, migrations au boot
```

Les mises à jour sont **gracieuses** : quand le conteneur API est remplacé, il capte le
`SIGTERM`, termine les requêtes en cours, puis ferme ses connexions DB/Redis avant de
quitter (budget de 10 s) — un rebuild ne coupe jamais une requête en vol. Avec 2+ réplicas
(section suivante), le déploiement est invisible pour les utilisateurs.

## 10. Sauvegardes

Utilise le script fourni — il fait un `pg_dump` cohérent, archive les volumes MinIO +
audit-anchor, purge les vieilles copies, et peut envoyer hors-site avec rclone :
```bash
infra/backup/backup.sh                                       # → /var/backups/bcweb
BACKUP_DIR=/mnt/backups BACKUP_REMOTE=b2:bucket/bcweb infra/backup/backup.sh   # + hors-site
```
Automatise-le chaque jour (03:30) avec `crontab -e` :
```
30 3 * * * BACKUP_DIR=/mnt/backups /chemin/vers/BCW/BCWEB/infra/backup/backup.sh >> /var/log/bcweb-backup.log 2>&1
```
**Restauration :**
```bash
# Postgres :
gunzip -c pg-bcweb-YYYYMMDD-HHMMSS.sql.gz | docker compose exec -T db psql -U bcweb bcweb
# Objets MinIO :
docker run --rm -v bcweb_minio-data:/data -v "$PWD":/backup alpine \
  sh -c 'cd /data && tar xzf /backup/minio-YYYYMMDD-HHMMSS.tar.gz'
```
> **Ne fais jamais** `docker compose down -v` en prod — `-v` supprime les volumes
> (base de données + stockage objet). Et **teste une restauration au moins une fois** — une
> sauvegarde jamais testée n'en est pas une.

## 11. Santé & supervision

L'API expose trois sondes (toutes exemptées du rate limiter, sans logs de requête) :

- **Liveness — `GET /live`** : légère, **sans dépendance**, 200 tant que le process tourne.
  Elle ne touche jamais la DB : une panne de base ne peut donc pas provoquer de boucle de
  redémarrage.
- **Readiness — `GET /ready`** : 200 quand la DB est joignable, **503** sinon — un load
  balancer / orchestrateur sort alors l'instance de la rotation *sans la tuer*.
- **`GET /health`** : la sonde combinée (toujours 200 avec un drapeau `db: true/false`) ;
  c'est celle qu'utilisent le healthcheck Docker et le `depends_on` de Caddy.
- L'onglet admin **Server perf** montre CPU/RAM/disque, la santé des dépendances,
  l'historique de downtime et les alertes récentes (dédupliquées, copiables).
- Test de charge : `cd loadtest && npm install && BASE=https://community.example.com node run.mjs`.

## 12. Verrouille — pare-feu (juste après le premier déploiement)

Seul Caddy doit être exposé à Internet. Le compose publie aussi `3000` (api) et
`9000`/`9001` (MinIO) sur l'hôte par confort ; ferme tout sauf SSH + HTTP(S) :
```bash
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
```
Postgres, Redis et les données MinIO restent sur le réseau Docker interne — ne les expose
jamais. (Le `9000` de MinIO n'est nécessaire publiquement que si tu sers des URLs d'upload
pré-signées en direct ; dans ce cas, mets-le derrière un sous-domaine Caddy plutôt que
d'ouvrir le port brut.) Le **CDN** est l'étape juste après — voir *Performance & montée en
charge → mettre un CDN devant* ci-dessous.

## Performance & montée en charge

**Déjà en place** (voir `loadtest/BENCHMARK.md`) :
- Les lectures publiques chaudes (`/kofi/stats`, `/showcase`) sont cachées dans **Redis**
  (partagé entre les réplicas d'API) avec coalescing des requêtes.
- Le rate limiter par IP est **adossé à Redis** quand `REDIS_URL` est défini — le budget
  600/min est donc partagé entre les réplicas.
- **En-têtes prêts pour un CDN** : Caddy met `Cache-Control: immutable` sur `/assets/*`
  (bundles hashés de Vite), et les téléchargements de fichiers hébergés ont `max-age=300`
  + un ETag.

**La seule étape externe — mettre un CDN (Cloudflare) devant :**
1. Ajoute ton domaine à Cloudflare, mets les enregistrements DNS en **proxied** (nuage orange).
2. Mode SSL/TLS **Full (strict)** — Caddy termine quand même le vrai TLS à l'origine.
3. C'est tout : les `/assets/*` hashés et les téléchargements répétés sont servis depuis
   l'edge avec ~0 hit à l'origine ; le shell HTML reste non caché donc les déploiements
   sont instantanés.

**Quand un seul conteneur API ne suffit plus :**
- Lance 2–4 réplicas `api` derrière Caddy (`docker compose up -d --scale api=3` + une
  liste d'upstreams Caddy) — le cache/limiter Redis rendent déjà ça sûr.
- Active le pooler **PgBouncer** : `docker compose --profile pgbouncer up -d`, puis dans
  `.env` mets `DB_HOST=pgbouncer DB_PORT=6432 DB_URL_PARAMS=?pgbouncer=true`
  (`DIRECT_DATABASE_URL` reste sur `db:5432` pour les migrations, géré automatiquement).

**Mettre Postgres sur son propre serveur (managé — c'est ton objectif « DB sur un serveur
séparé », sans K8s).** Simple changement de `.env` — les URLs complètes écrasent les
valeurs locales :
```
DATABASE_URL=postgresql://user:pass@managed-host:5432/bcweb?sslmode=require        # endpoint poolé
DIRECT_DATABASE_URL=postgresql://user:pass@managed-host:5432/bcweb?sslmode=require # direct (migrations)
```
Puis `docker compose up -d api provisioner` ; une fois vérifié, `docker compose stop db`
(son volume est conservé comme backup). Neon / Supabase / RDS te donnent backups +
réplicas de lecture gratuitement. Pour garder un pooler devant, mets
`PGBOUNCER_UPSTREAM_HOST` sur le host managé.

**Variante auto-hébergée — ton propre 2ᵉ VPS pour la DB (même bascule, toujours gratuit,
sans K8s).** Le même changement de `.env` fait pointer le VPS applicatif vers un Postgres que
tu fais tourner sur un 2ᵉ serveur à toi. 4 points à faire correctement :
- **Réseau privé :** relie les 2 VPS via le réseau privé du provider (Hetzner / DO / …) ou un
  tunnel WireGuard, et **n'expose JAMAIS le port `5432` sur Internet** — filtre-le au pare-feu
  vers la seule IP du VPS applicatif.
- **Même région / datacenter :** garde les 2 machines au même endroit. Chaque requête fait un
  aller-retour vers la DB → la latence inter-région tue les perfs ; même-DC = < 1 ms.
- **TLS :** ajoute `?sslmode=require` (ou `verify-full` avec une CA) sauf si le lien est un LAN
  privé de confiance.
- **Répartition :** le VPS DB ne fait tourner que Postgres (+ éventuellement PgBouncer et ses
  propres backups) ; le VPS applicatif fait tout le reste (api / web / redis / minio / caddy / bot).
Fais-le quand une seule machine ne peut plus tenir les deux confortablement — avant ça,
agrandir verticalement le VPS unique est plus simple et moins cher.

**Aller plus loin — scale vertical d'abord, orchestrer seulement si nécessaire :**
- **Agrandis le VPS verticalement d'abord** — plus de CPU/RAM/disque sur la même machine,
  c'est le gain le plus simple et le moins cher, et ça t'emmène très loin. Une machine
  2 vCPU / 4 Go sert déjà des milliers d'utilisateurs simultanés (`loadtest/BENCHMARK.md`) ;
  le vrai plafond, ce sont les connexions Postgres, réglées par PgBouncer / DB managée
  ci-dessus, pas par un orchestrateur.
- **Besoin de plusieurs nœuds applicatifs ?** Une plateforme conteneurs managée (**Fly.io /
  Railway / Render**) fait tourner ces mêmes images avec autoscaling + rollouts, pour bien
  moins d'ops que n'importe quel orchestrateur.
- **Vraiment multi-nœuds auto-hébergé ?** Prends **Nomad** (bien plus simple que Kubernetes),
  ou — seulement si tu deviens une grosse plateforme multi-locataires — du Kubernetes
  **managé**, jamais un control plane fait main. Tu es très loin d'en avoir besoin.
  (Kubernetes n'est *pas* l'outil pour l'hébergement des conteneurs de projets utilisateurs
  décrit dans [USER_PROJECT_HOSTING.md](../reference/USER_PROJECT_HOSTING_FR.md) — voir ce doc.)

## Stockage objet — MinIO maintenant, R2 plus tard

**Ne confonds pas les deux produits Cloudflare :** le **CDN est gratuit** (section
précédente — active-le quand tu veux) ; **R2** est leur *stockage objet payant à
l'usage* qui remplacerait le MinIO embarqué. Tu n'as **pas besoin de R2** pour profiter
du CDN.

**Démarre (et reste longtemps) sur MinIO** — gratuit, les fichiers sont sur le disque de
ton serveur, et nginx + MinIO servent confortablement une petite/moyenne communauté
(voir `loadtest/BENCHMARK_FR.md`).

**Passe à R2 quand** l'une de ces choses devient vraie :
- le stockage des dépôts hébergés déborde du disque du serveur (ou plombe tes sauvegardes),
- l'egress des téléchargements sature ton lien / ton hébergeur facture le trafic,
- tu veux que les fichiers survivent indépendamment du VPS.

**Comment (env uniquement, zéro code — l'app parle l'API S3) :**
1. Crée un bucket R2 + un token API (Access Key ID / Secret) dans le dash Cloudflare.
2. Dans `infra/compose/.env` :
   ```
   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_PUBLIC_ENDPOINT=https://<ton-domaine-public-R2-ou-custom>
   S3_BUCKET=<bucket>  S3_ACCESS_KEY=<clé>  S3_SECRET_KEY=<secret>
   ```
3. Copie une fois les objets existants :
   `rclone sync minio:bcweb r2:bcweb` (ou `mc mirror`).
4. `docker compose up -d api provisioner`, vérifie upload/download, puis retire le
   service `minio` + son volume.
