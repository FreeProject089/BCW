# BCWEB — CI/CD : tous les workflows (FR)

> 🇬🇧 English version: [CI_CD_EN.md](CI_CD_EN.md)

Tout ce que GitHub Actions exécute pour ce dépôt, au même endroit : ce qui lance chaque
workflow, ce qu'il vérifie, ce qui le fait échouer, ce qu'il laisse derrière lui, ce qu'il faut
configurer, et comment faire la même chose sur votre machine. Les workflows sont dans
`BCW/.github/workflows/`. Les scans de sécurité ont leur propre guide détaillé :
[SECURITY_CI_FR.md](SECURITY_CI_FR.md).

| Workflow | Fichier | Se lance sur | Échoue quand |
|---|---|---|---|
| **BCWEB CI** | `ci.yml` | push / pull request touchant `BCWEB/**` ou `.github/**` | un contrôle de build, lint, test, schéma, Caddyfile, secret ou dépendance échoue |
| **BCWEB security** | `security.yml` | idem, + le lundi 03:17 UTC, + à la main | la gate trouve quelque chose au seuil ou au-dessus (HIGH par défaut) dans Gitleaks, Semgrep ou Trivy |
| **BCWEB DAST** | `dast.yml` | pull requests touchant l'API, le web, les packages, Caddy ou les fichiers DAST ; le mardi 04:41 UTC ; à la main | la gate trouve quelque chose au seuil ou au-dessus dans ZAP ou Nuclei, ou le scan n'a pas pu tourner correctement |
| **BCWEB deploy (production)** | `deploy.yml` | à la main sur `master`, ou après une **BCWEB CI** verte sur `master` quand `CD_AUTO_DEPLOY` = `true` | le déploiement SSH via la gate du serveur échoue |

Chaque job demande ses propres permissions et rien d'autre (`contents: read` presque partout) ;
les seuls jobs qui peuvent écrire sont nommés plus bas. Chaque action est épinglée par SHA de
commit, chaque image de scanner par tag et digest.

---

## BCWEB CI (`ci.yml`)

Le filet de build et de justesse. Aucune infrastructure : les contrôles tournent sur le source
avec des valeurs factices.

| Job | Ce qu'il vérifie |
|---|---|
| Web build (vite) | `npm ci`, `npm run lint`, `npm run i18n:check`, `npm run css:check`, `npm run legal:check`, `npm run build`, `npm run budget` dans `apps/web` |
| API syntax + Prisma + billing tests | `node --check` sur chaque module de l'API, variables d'env documentées, les affirmations des guides (`guides/check-claims.mjs`), liens des seeds, guide markdown, `prisma validate`, `migrate deploy` sur un Postgres jetable, contrôle de dérive des migrations, `npm test` |
| Native addon (Rust) | `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, l'addon se construit et se charge, tests du chemin natif |
| Caddyfile | `caddy validate` avec l'image de la stack, et `infra/caddy/site.mjs selftest` |
| Secret scan | `.github/scripts/secret-scan.mjs` (autotest, puis chaque fichier suivi, `*.example` compris) |
| npm audit / cargo audit | `.github/scripts/dep-audit.mjs`, high et critical échouent sauf explication dans `.github/audit-ignore.json` |

- **Gate :** toute étape en échec. **Artifacts :** aucun. **Variables / secrets :** aucun.
- **En local :** les mêmes commandes, depuis le dossier de chaque job. Pour les tests de l'API
  comme la CI : `DATABASE_URL` vers un Postgres jetable, pas de `REDIS_URL`, et l'API arrêtée.

---

## BCWEB security (`security.yml`)

| Job | Outil | Bloque par défaut sur | Artifact |
|---|---|---|---|
| Security gate + DAST scope (self-tests) | node --test | une gate ou un contrôle de périmètre cassé | — |
| Secrets in git history | Gitleaks | tout secret non revu (push/PR : ses commits ; planifié/manuel : tout l'historique) | `security-gitleaks` |
| SAST | Semgrep (règles épinglées) | ERROR | `security-semgrep` |
| Dependencies + Dockerfiles | Trivy fs | HIGH / CRITICAL | `security-trivy-fs` |
| Container image (×5) | Trivy image | HIGH / CRITICAL | `security-trivy-image-<nom>` |
| Code scanning upload (×7) | upload-sarif | un SARIF que GitHub refuse | — |
| Gate table on the pull request | gh api | jamais (une notice quand il ne peut pas poster) | — |

- **Permissions d'écriture :** `Code scanning upload` a `security-events: write` ; `Gate table
  on the pull request` a `pull-requests: write`. Rien d'autre n'écrit.
- **Artifacts** (14 jours) : chaque rapport en JSON, son SARIF, `<outil>-summary.md` et
  `gate-<outil>.json` (le verdict à partir duquel le commentaire de PR est construit).
- **En local :** toutes les commandes sont dans [SECURITY_CI_FR.md](SECURITY_CI_FR.md#2-chaque-scan-et-comment-le-lancer-à-la-main).

## BCWEB DAST (`dast.yml`)

| Job | Quoi | Artifact |
|---|---|---|
| DAST on a CI-local instance | démarre dans le runner Postgres + l'API (mode production, secrets jetables) + le web construit derrière le Caddyfile du dépôt, puis ZAP baseline et Nuclei | `dast-local` |
| DAST on staging | les mêmes scans contre `DAST_STAGING_URL`, seulement à la main ou planifié, seulement si autorisé | `dast-staging` |
| Code scanning upload (×4) | SARIF de ZAP et de Nuclei, catégories `dast-zap-local`, `dast-nuclei-local`, `dast-zap-staging`, `dast-nuclei-staging` | — |
| DAST table on the pull request | le tableau de la gate, dans son propre commentaire | — |

- **Gate :** constats ZAP et Nuclei au seuil ou au-dessus, ou un scan qui n'a pas tourné
  correctement (périmètre refusé, Nuclei sans modèles ou ayant abandonné la cible, instance qui
  ne répond plus ou qui a bloqué les scanners).
- **La production n'est jamais une cible** — refus codé en dur de bettercommunity.ch et de
  l'adresse du serveur de production, règles de pare-feu et DNS « trou noir », tout cela avant
  la première requête ([SECURITY_CI_FR.md](SECURITY_CI_FR.md#3-linstance-locale-de-la-ci-et-tester-sans-toucher-la-production)).
- **Artifacts** (14 jours) : `zap.json`, `zap.html`, `zap.md`, `zap.sarif.json`, `nuclei.jsonl`,
  `nuclei.sarif`, les logs de l'API, du bord et de nginx, et les résumés de la gate.

---

## BCWEB deploy (`deploy.yml`) — le CD

Déploie la pointe de `master` sur le VPS de production par **une seule commande SSH forcée** :

1. Le runner se connecte avec la clé de `DEPLOY_SSH_KEY`. Sur le serveur, cette clé est fixée
   dans `authorized_keys` avec `restrict,command=".../deploy-gate.sh"` : quoi que le runner
   demande, sshd lance `infra/deploy-gate.sh` (installé hors du dépôt, pour qu'un commit ne
   puisse pas réécrire la gate qui va le déployer).
2. La gate n'accepte que `status` et `deploy <sha>` (avec `--dry-run`), et seulement si `<sha>`
   est la **pointe actuelle d'`origin/master`**, récupérée par le serveur lui-même — un commit
   ancien ou présent seulement sur une branche ne peut pas partir en production avec cette clé.
3. Elle lance ensuite `infra/deploy.sh` (sauvegarde, pull, build, attente de `/ready`, retour
   arrière du code s'il ne démarre jamais), puis le job demande `status` et garde le log.
4. **Interrupteur d'arrêt :** tant que `/srv/BetterCommunity/deploy-gate.disabled` existe sur le
   serveur, tout déploiement est refusé (status répond toujours).

- **Déclencheurs :** Actions → *BCWEB deploy (production)* → Run workflow sur `master` (dry run
  possible) ; ou automatiquement après une *BCWEB CI* verte sur un push vers `master`, seulement
  si la variable `CD_AUTO_DEPLOY` vaut exactement `true`. Les deux passent par l'environnement
  `production` : ajoutez-y des relecteurs obligatoires pour que chaque déploiement attende une
  approbation.
- **Gate :** le code de sortie de la commande SSH. **À noter :** il attend *BCWEB CI*
  seulement, pas les workflows de sécurité ou DAST (voir « Décisions » à la fin).
- **Artifact :** `deploy-log-<id du run>`, 90 jours.
- **En local :** `ssh -i <clé> -p <port> <user>@<hôte> status` (ou `deploy <sha> --dry-run`) ;
  le côté serveur est décrit dans [DEPLOY_FR.md](DEPLOY_FR.md), section 9, « Depuis GitHub (CD) ».

---

## Variables et secrets à configurer

Settings → Secrets and variables → Actions.

| Nom | Type | Utilisé par | Défaut / signification |
|---|---|---|---|
| `SECURITY_GATE_SEVERITY` | variable | security, DAST | `high` ; `critical` / `high` / `medium` / `low` = la sévérité la plus basse qui fait échouer |
| `SECURITY_GATE_SEVERITY_SEMGREP`, `_TRIVY`, `_ZAP`, `_NUCLEI` | variable | security, DAST | non définie ; surcharge par outil |
| `DAST_STAGING_URL` | variable | DAST | non définie = pas de scan de staging |
| `DAST_ALLOWED_HOSTS` | variable | DAST | hôtes autorisés comme cible de staging, noms exacts |
| `DAST_DENY_HOSTS` | variable | DAST | hôtes supplémentaires (et leurs sous-domaines) jamais scannés |
| `DAST_ALLOW_ACTIVE_STAGING` | variable | DAST | `true` autorise le scan ZAP actif sur le staging |
| `DAST_NUCLEI_RATE_LIMIT` | variable | DAST | `10` requêtes/s sur le staging |
| `DEPLOY_SSH_KEY` | **secret** | deploy | la clé privée de déploiement (ed25519, sans phrase de passe) |
| `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER` | variable | deploy | le serveur |
| `DEPLOY_KNOWN_HOSTS` | variable | deploy | la ou les lignes de clé d'hôte du serveur ; obligatoire, pas de confiance au premier contact |
| `CD_AUTO_DEPLOY` | variable | deploy | `true` = déployer après chaque CI verte sur `master` |

Les workflows de sécurité et DAST n'ont besoin d'**aucun secret** : ils utilisent le jeton du
run pour les deux écritures ci-dessus. L'instance DAST locale génère ses secrets à l'exécution.

---

## Lire les résultats

- **La page Summary du run** contient le tableau de chaque gate (outil, seuil, nombre par
  sévérité, ce qui bloque). Le log de l'étape `gate` imprime la même chose avec une ligne par
  constat, et une annotation rouge par constat bloquant.
- **Les artifacts** (bas de la page du run) contiennent les rapports complets : JSON, SARIF,
  HTML de ZAP.
- **Le commentaire de pull request.** Sur une pull request, *Gate table on the pull request*
  poste un commentaire, et chaque run suivant **modifie ce même commentaire** (il le retrouve par
  le marqueur caché `<!-- bcw-security-gate -->`). Le workflow DAST garde le sien, marqueur
  `<!-- bcw-security-gate-dast -->` : les deux finissent à des moments différents, et un seul
  commentaire partagé laisserait le dernier run effacer le tableau de l'autre. Colonnes : outil,
  seuil, critical, high, medium, low, info, bloquants, verdict, et le lien vers le run et ses
  artifacts. Une pull request venant d'un fork a un jeton en lecture seule : pas de commentaire,
  une notice, le tableau reste dans le résumé du run.
- **Onglet Security → Code scanning.** Semgrep, Trivy (fs et chaque image), ZAP et Nuclei
  envoient leur SARIF, une *catégorie* par outil (et par image / cible), pour que chaque alerte
  soit suivie d'un run à l'autre : ouverte, corrigée, réintroduite. Filtrez par *Tool* ou par
  catégorie. Sur une pull request, les nouvelles alertes de Semgrep et de Trivy fs sont annotées
  sur les lignes modifiées ; les alertes DAST pointent vers une URL, pas un fichier, elles sont
  donc listées mais pas dessinées sur les lignes. L'envoi a lieu même quand la gate a échoué. Si
  le dépôt ne peut pas utiliser le code scanning (dépôt privé sans GitHub Advanced Security), le
  job le dit dans une notice et le SARIF reste dans l'artifact — rien n'échoue pour cette raison.
  Ce dépôt est public : le code scanning est disponible sans frais.

## Écarter proprement un faux positif

Il existe deux façons ; elles ne se valent pas.

1. **À privilégier : une exclusion revue dans le dépôt**, dans le fichier de l'outil, avec la
   raison, le relecteur et la date, aussi étroite que l'outil le permet (une empreinte Gitleaks,
   un `nosemgrep` sur une ligne, une entrée Trivy limitée à un fichier avec une expiration, une
   règle ZAP avec une raison). Elle passe par une pull request, elle est versionnée, et elle
   change ce que la **gate** décide. Fichiers et syntaxe : [SECURITY_CI_FR.md](SECURITY_CI_FR.md#5-exclure-un-constat-un-faux-positif-revu).
2. **Une fermeture dans l'onglet Security** (alerte → *Dismiss alert* → *False positive* /
   *Used in tests* / *Won't fix*, avec un commentaire). Elle ne change que la vue de GitHub : la
   gate lit le rapport du scanner, pas l'état de l'alerte, donc **un constat bloquant continue de
   faire échouer le build**. Utilisez-la pour une alerte sous le seuil que vous avez jugée et que
   vous ne voulez plus voir ; écrivez la justification dans le commentaire.

Ne baissez jamais `SECURITY_GATE_SEVERITY` et ne supprimez jamais une étape pour passer un
constat : cela désactive le contrôle pour tous les constats suivants.

---

## Décisions encore ouvertes

- `deploy.yml` attend *BCWEB CI* seulement. Faire aussi attendre une *BCWEB security* (et DAST)
  verte tient en une ligne dans son déclencheur `workflow_run` ; ce n'est pas fait, parce que le
  workflow de sécurité échoue aujourd'hui sur des constats qui demandent d'abord une décision
  ([SECURITY_CI_FR.md](SECURITY_CI_FR.md#6-ce-que-les-scans-ont-trouvé-le-2026-09-25-et-ce-qui-a-été-fait)).
- Les artifacts de rapports d'un dépôt public peuvent être téléchargés par tout utilisateur
  GitHub connecté. Le rapport Gitleaks est masqué ; les autres décrivent le code (public de toute
  façon) et une instance jetable. Un DAST contre un vrai staging publierait ses constats de la
  même manière.
