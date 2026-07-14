# BCWEB — Audit technique (juillet 2026)

*Une évaluation franche et complète de la plateforme BetterCommunity Web : architecture,
points forts, points faibles, risques, et un plan d'action priorisé. Complète l'analyse
fonctionnelle [Technical_Analysis_FR.md](Technical_Analysis_FR.md). 🇬🇧 [English version](TECH_AUDIT_EN.md).*

---

## 1. Ce qu'est BCWEB, techniquement

Un **monorepo npm workspaces** :

| Partie | Stack | Rôle |
|---|---|---|
| `apps/api` | Node 20+, **Fastify**, **Prisma** → PostgreSQL, Redis, stockage objet S3 (MinIO) | Toute la logique métier : comptes, catalogues, hébergement Server-Repo, facturation (Stripe), modération, statistiques, config du bot Discord, fournisseur OIDC |
| `apps/web` | **React 18 + Vite**, react-router, kit UI maison (`ui/ui.jsx`) | SPA frontend, i18n FR/EN, thèmes + surfaces translucides |
| `apps/bot` | discord.js | Bot Discord communautaire (gating, bienvenue, paiements, giveaways…) |
| `packages/db` | Un seul schéma Prisma | Source de vérité unique pour ~60 modèles |
| `infra/` | Docker Compose + edge **Caddy** (TLS, anti-bot, CSP), scripts de backup, manifestes k8s inertes | Déploiement production mono-VPS |
| `bmm/telemetry-dashboard` | Rust/Axum + React | Collecteur de télémétrie opt-in séparé |

Le déploiement est **Docker Compose sur un VPS** — un choix délibéré (k8s évalué puis
différé) ; l'échelle de montée en charge est documentée (CDN → DB managée → réplicas).

## 2. Points forts

### 2.1 Posture de sécurité (bien au-dessus du niveau « projet perso »)
- Mots de passe argon2id, 2FA TOTP optionnelle, cookies de session httpOnly/SameSite, cookie
  **élevé** de courte durée pour les actions de contrôle serveur.
- **Admin par capacités** (`requireCap`) + hiérarchie stricte des rôles (USER→MOD→ADMIN→
  SUPERADMIN, on n'agit que vers le bas), permissions blog granulaires.
- **Journal d'audit inviolable** (chaîne de hash HMAC + endpoint de vérification), alertes
  d'actions sensibles, tables d'audit protégées dans le DB viewer.
- Patrons défensifs systématiques : comparaisons en temps constant, allow-lists SSRF, gardes
  anti-traversal sur chaque clé de stockage, uploads présignés (les octets ne transitent
  jamais par l'API), médias servis en `attachment`+`nosniff` (tue le XSS stocké), gardes
  anti-open-redirect, rate limits + PoW anti-bot à l'edge, validation zod stricte partout.
- Les revues de sécurité répétées en session n'ont trouvé aucun nouveau problème HIGH/MEDIUM.

### 2.2 Vie privée & conformité
- Statistiques internes, anonymes, soumises au consentement (hash visiteur tournant chaque
  jour, aucun tiers).
- Pages légales conscientes du RGPD (bases Art. 6, transferts, sous-traitants, rétractation)
  maintenues **exactes** vis-à-vis de ce qui est collecté ; consentement cookies avec Refuser
  aussi visible qu'Accepter + catégories granulaires.

### 2.3 Conception produit/métier
- **Facturation par pools de stockage** avec une source de vérité unique (`recomputePoolBytes`) :
  dépôts + catalogues partagent les octets d'un pool ; fusion/défusion/consolidation se
  réduisent toutes à cet invariant. Webhooks Stripe idempotents ; prépayé + récurrent + délais
  de grâce + free-tier résistant aux unlink/relink.
- Des primitives réutilisées plutôt que des cas uniques : le patron de clé de partage `?k=`
  (catalogues → dépôts), le toast-undo, le contrat de surface `.card`/glass, le feed d'update
  compatible GitHub Releases, les snapshots de version.
- Feeds natifs BMM + deeplinks rendent la plateforme réellement utile aux apps desktop, avec
  des chaînes de fallback BCWEB → GitHub → local : aucune panne unique ne brique les clients.

### 2.4 Exploitation & documentation
- Déploiement en une commande, probes `/live` + `/ready`, arrêt gracieux, backup/restore
  documentés, suites de load-test + benchmarks, tarification consciente de la capacité.
- Documentation bilingue inhabituellement complète : deploy, env, Docker, backups, features,
  guides utilisateur/modérateur/hébergeur, auto-update — le tout à jour.

### 2.5 Cohérence frontend
- Un kit UI, une convention i18n (`t(clé, fallback)`), un contrat de thème ; les features se
  ressemblent et se comportent pareil. Bundle-splitting et cache là où ça faisait mal.

## 3. Points faibles & risques

### 3.1 🔴 Aucun test automatisé (le risque n°1)
Il n'existe **aucun test** unitaire, d'intégration ou E2E. La vérification = `node --check`,
`vite build`, `prisma validate`, et des tests manuels. La surface la plus dangereuse est la
facturation (webhooks, recompute des pools, consolidation — l'aller-retour Stripe de la
consolidation est parti relu mais **non testé au runtime**). Une régression ici facture mal
de vrais utilisateurs.

### 3.2 🔴 Pas de CI/CD
Rien n'empêche de committer un build cassé ou un secret. (Deux incidents réels : un token
Discord vivant dans l'historique de `.env.example` ; un secret webhook collé en clair dans le
chat.) Une pipeline minimale (build + checks + scan de secrets) attraperait les deux classes.

### 3.3 🟠 Fichiers monolithiques
`apps/web/src/pages/pages.jsx` fait ~10k lignes (des dizaines de composants admin),
`repos.jsx` et `i18n.jsx` sont énormes. Conséquences : éditeurs lents, conflits pénibles,
onboarding difficile, et les crashes « import manquant » récurrents de ce mois-ci (X,
Calendar) — un identifiant JSX nu passe le build et explose au rendu. L'extraction en
modules par feature est en retard.

### 3.4 🟠 Hypothèses mono-processus
Le feed SSE (`feedBus`), divers caches mémoire et l'état de rate-limit sont in-process. Les
sweepers/planificateurs supposent une seule instance (pas de verrous distribués). Correct
pour le déploiement mono-conteneur actuel — mais passer en réplicas exige un chantier Redis
pub/sub (documenté dans le code, pas implémenté).

### 3.5 🟠 Gestion de schéma : `prisma db push` au boot avec `--accept-data-loss`
Pas d'historique de migrations. Une modification de schéma qui renomme/rétrécit une colonne
peut silencieusement détruire des données en production. Passer à `prisma migrate` (avec
migrations commitées) est la voie sûre.

### 3.6 🟡 Croissance de tables non bornée
`AnalyticsEvent`, `InteractionEvent`, `WebVital`, `LoginAttempt` grossissent sans fin
(certaines tables ont des plafonds ; la rétention analytics est partielle). Les agrégations
SQL brutes se dégraderont ; il faut des purges de rétention ou du partitionnement avant que
ça devienne gros.

### 3.7 🟡 i18n par convention seulement
La parité FR/EN tient à la discipline, pas à l'outillage — une clé manquante retombe en
anglais en silence. Un lint de parité des clés rendrait ça structurel.

### 3.7b 🟡 Vulnérabilités de dépendances (transitives, faible atteignabilité)
`npm audit` (juil. 2026) : **web = 0**, **bot = 0**, **api = 5 high + 2 modérées, toutes
transitives**, **0 critique**. Les deux racines :
- **`fast-uri@2.4.0`** (via Fastify 4) — avis path-traversal / host-confusion. Patché seulement
  en montant **Fastify 4 → 5** (une migration cassante délibérée, pas `audit fix --force`).
  L'atteignabilité est faible (Fastify fait sa propre normalisation de chemin), mais à planifier.
- **`ip-address`** (via `geoip-lite`) — XSS dans les méthodes HTML de `Address6`. **Non
  atteignable** : `geoip-lite` ne fait que parser des adresses, n'appelle jamais ces méthodes
  HTML. Corrigé par `geoip-lite` 1→2.

Action : suivre les upgrades **Fastify 4→5** et **geoip-lite 1→2** comme des tâches testées à
part ; ne pas les `--force` à l'aveugle (les deux sont cassants et risqueraient le build de l'API).

### 3.8 🟡 Divers
- Pièges DX côté hôte : les scripts exigent l'env/le client généré du conteneur (désormais
  gardés par des messages clairs, mais le patron demeure).
- Accessibilité partielle (des attributs aria par endroits ; pas d'audit systématique).
- SEO limité par la SPA (quelques routes OG/meta ; pas de SSR/prérendu).
- Bus factor ≈ 1 ; les cas limites de facturation vivent dans les commentaires du code et
  dans une seule tête.

## 4. Plan d'action priorisé

| P | Action | Pourquoi |
|---|---|---|
| **P1** | CI minimale : build web, `node --check` API, `prisma validate`, scan de secrets | Attrape builds cassés + secrets au commit |
| **P1** | Tests de facturation : **FAIT** — math de prix (`pricing.test.mjs`) **et** l'invariant de pool (`pool-billing.test.mjs` : `recomputePoolBytes` somme-des-abos-actifs, défaut→suspend+masque+grâce 72h, renouvellement→restaure, défaut-partiel-garde-le-contenu, no-op idempotent) plus **des tests webhook de bout en bout** (`webhook.test.mjs` : un événement réellement signé à travers le vrai handler — mauvaise-signature→400, `customer.subscription.deleted`→défaut-suspend, `checkout.session.completed{pool_renew}`→restaure) — le tout dans la CI contre un Postgres jetable (**25 tests**). Le risque de facturation §1 est maintenant couvert de bout en bout pour le cycle de vie piloté par la BD | Le code au plus gros rayon d'explosion |
| **P1** | Passer `db push` → `prisma migrate` **FAIT** — une baseline `0_init` + `src/boot-migrate.mjs` (adopte sans risque les BD fraîches / db-push / déjà migrées, vérifié zéro perte de données) ; le Dockerfile boote via `migrate deploy` ; la CI applique les migrations + un contrôle de dérive (un schéma sans migration échoue) | Supprime le risque de perte de données silencieuse |
| **P2** | Découper `pages.jsx` / `repos.jsx` en modules. **ESLint `no-undef` FAIT** (apps/web `eslint.config.js`, câblé dans la CI — attrape les crashes de rendu par identifiant nu) | Maintenabilité + prévient les crashes d'import récurrents |
| **P2** | Purges de rétention analytics (par âge/nb de lignes) | Garde la DB saine à long terme |
| **P2** | Redis pub/sub pour le SSE + rate limits partagés (quand les réplicas deviendront réels) | Débloque la montée en charge horizontale |
| **P3** | Lint de parité i18n ; passe accessibilité ; monitoring d'erreurs ; OG/prérendu des pages publiques | Finition & portée |

## 5. Verdict

BCWEB est une plateforme inhabituellement bien sécurisée, bien documentée et dense en
fonctionnalités pour sa taille d'équipe, avec un modèle métier cohérent (pools, capacités,
clés de partage) qui compose au lieu de s'étaler. Sa faiblesse centrale est la
**vérification** : tout repose sur la relecture attentive et les tests manuels — aucun filet
automatisé sous le système de facturation ni sous le schéma de 60 modèles. Les items P1
(CI, tests de facturation, migrations) coûtent peu par rapport au risque qu'ils éliminent et
devraient passer avant la prochaine vague de features.
