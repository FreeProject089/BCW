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
| **BCWEB deploy (production)** | `deploy.yml` | à la main sur `master`, ou après une **BCWEB CI** verte sur `master` quand `CD_AUTO_DEPLOY` = `true` | **BCWEB security** n'est pas passé pour ce commit (après jusqu'à 20 min d'attente), ou le déploiement SSH via la gate du serveur échoue |
| **Publish B.MD** | `publish-bmd.yml` | un tag `bmd-v<version>`, ou à la main (vérification seule sauf si *publish* est coché) | le tag et les deux versions de paquet ne concordent pas, un contrôle B.MD échoue, l'archive ne s'installe pas ou ne rend pas avec npm et pnpm, `publint` / `arethetypeswrong` / `npm audit` objectent, ou npm refuse la publication |

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
| Security gate + DAST scope (self-tests) | node --test | une gate, un contrôle de périmètre ou le verdict de déploiement (`security-verdict.mjs`) cassé | — |
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

**Avant tout cela**, avant même que la clé de déploiement soit écrite sur le disque du runner, le
job vérifie que **BCWEB security** est passé pour le commit exact qu'il déploie :

- il liste les runs de workflow de ce commit par l'API (`gh api`, avec le jeton du job lui-même
  et les droits en lecture `actions: read` / `checks: read`, accordés à ce seul job) et les
  passe à `.github/scripts/security-verdict.mjs` ;
- un run nommé *BCWEB security*, pour ce SHA exact, issu d'un événement `push`,
  `workflow_dispatch` ou `schedule`, terminé en `success` → le déploiement continue. Un run
  `pull_request` ne compte pas : il a testé la fusion d'une branche, pas ce commit ;
- pas encore de run, ou un run en file / en cours → il redemande toutes les 30 secondes,
  pendant **20 minutes** au plus, puis échoue avec « no successful BCWEB security run for it
  after 20 minutes » ;
- tous les runs du commit sont terminés et aucun n'a réussi (échec, annulé, délai dépassé) → il
  échoue tout de suite. Corrigez les constats (ou relancez le workflow si c'était un raté) et
  redéployez.

**Le DAST reste consultatif pour le déploiement.** *BCWEB DAST* ne tourne pas sur le push vers
`master` (il tourne sur les pull requests, chaque semaine et à la main), il lui faut dix minutes
et toute une instance en marche, et ce qu'il juge, ce sont les en-têtes et le comportement du
site plutôt que le code d'un commit. L'attendre voudrait dire soit plus de déploiement
automatique, soit un déploiement conditionné au scan de mardi dernier. Ses constats se lisent
sur la pull request et dans le run hebdomadaire.
4. **Interrupteur d'arrêt :** tant que `/srv/BetterCommunity/deploy-gate.disabled` existe sur le
   serveur, tout déploiement est refusé (status répond toujours).

- **Déclencheurs :** Actions → *BCWEB deploy (production)* → Run workflow sur `master` (dry run
  possible) ; ou automatiquement après une *BCWEB CI* verte sur un push vers `master`, seulement
  si la variable `CD_AUTO_DEPLOY` vaut exactement `true`. Les deux passent par l'environnement
  `production` : ajoutez-y des relecteurs obligatoires pour que chaque déploiement attende une
  approbation.
- **Gate :** un run *BCWEB security* vert pour le commit (ci-dessus), puis le code de sortie de
  la commande SSH. Démarrer après une *BCWEB CI* verte est le déclencheur ; l'attente de la
  sécurité est une étape.
- **Artifact :** `deploy-log-<id du run>`, 90 jours.
- **En local :** `ssh -i <clé> -p <port> <user>@<hôte> status` (ou `deploy <sha> --dry-run`) ;
  le côté serveur est décrit dans [DEPLOY_FR.md](DEPLOY_FR.md), section 9, « Depuis GitHub (CD) ».

---

## Publier B.MD (`publish-bmd.yml`)

Publie **`@bettercommunity/bmd`** et **`@bettercommunity/bmd-editor`** (versionnés ensemble) sur
le registre npm. pnpm, yarn et bun installent depuis ce même registre : il n'y a pas de seconde
publication « pour pnpm ». Ce qui compte pour pnpm, c'est que le paquet s'installe dans son
`node_modules` strict, et le workflow le prouve à chaque version.

| Job | Permissions | Ce qu'il fait |
|---|---|---|
| Build, test, pack (npm + pnpm) | `contents: read`, aucun secret | contrôle tag = version, `npm ci` dans `apps/web`, les contrôles B.MD (lint, `check-md-*`, tests du registre et de la politique d'URL, tableau du README), construit `dist/` (`packages/bmd/scripts/build.mjs`), `check-bmd-publish`, puis `packages/bmd/scripts/smoke.mjs` : empaquette les deux paquets, installe les archives avec **npm et pnpm**, importe chaque export, rend côté serveur chaque exemple de directive, compile un consommateur TypeScript, `npm audit` ; de nouveau avec React 18 ; puis `publint` et `arethetypeswrong` sur les archives, envoyées comme artefact `bmd-tarballs` |
| npm publish (provenance) | `contents: read`, `id-token: write`, environnement `npm` | télécharge ces archives et lance `npm publish <archive> --provenance --access public` (le moteur de rendu d'abord, puis l'éditeur) ; une version déjà sur npm est sautée, une pré-version part sur le dist-tag `next`. Aucun checkout, aucun script de paquet ne tourne à côté des identifiants |

**Jeton ou publication de confiance.** Le job est écrit pour la **publication de confiance npm**
(OIDC) : npm échange l'identité GitHub du run contre un identifiant de publication à usage
unique, rien de durable n'est stocké nulle part, et la provenance est jointe automatiquement.
C'est le régime cible. Un éditeur de confiance ne peut être ajouté qu'à un paquet qui existe
déjà sur npm, donc la **première** version passe par un jeton (`NPM_TOKEN`, secret de
l'environnement `npm`). npm essaie d'abord OIDC puis retombe sur ce jeton : le même job sert aux
deux ; supprimez le secret une fois les éditeurs de confiance configurés. La provenance exige un
dépôt public, ce qu'est `FreeProject089/BCW`, et un `repository.url` qui le nomme dans chaque
`package.json` (npm le vérifie à la publication).

### Ce que le propriétaire fait, une fois

1. **Le scope npm.** Sur npmjs.com, connecté : *Add Organization* → nom **`bettercommunity`**
   (l'offre gratuite suffit pour des paquets publics). Le scope n'existait pas le 2026-09-26.
   Activez l'authentification à deux facteurs du compte si ce n'est pas déjà fait.
2. **Le jeton de première version.** Compte → *Access Tokens* → *Generate New Token* →
   *Granular Access Token* : paquets et scopes en **lecture et écriture**, limité au scope
   `@bettercommunity`, expiration 7 jours, et cochez *bypass two-factor authentication* (un run
   de CI ne peut pas répondre à une invite 2FA).
3. **L'environnement GitHub.** Dépôt → Settings → Environments → *New environment* **`npm`**.
   Ajoutez-vous éventuellement comme relecteur obligatoire : chaque publication attend alors un
   clic. Ajoutez-y le secret **`NPM_TOKEN`** avec le jeton de l'étape 2.
4. **Publier.** Les deux `package.json` indiquent déjà `3.1.0` et le changelog a sa section.
   Poussez le tag : `git tag bmd-v3.1.0` puis `git push origin bmd-v3.1.0`. Suivez
   *Actions → Publish B.MD* ; le résumé liste ce qui a été publié.
5. **Passer à la publication de confiance** (après la première version) : sur npmjs.com, chaque
   paquet → *Settings* → *Trusted Publisher* → GitHub Actions : propriétaire `FreeProject089`,
   dépôt `BCW`, workflow `publish-bmd.yml`, environnement `npm`. Pour les deux paquets, puis
   supprimez le secret `NPM_TOKEN` et révoquez le jeton. Option : *Require two-factor
   authentication and disallow tokens* sur les deux paquets ; seul ce workflow pourra alors les
   publier.

Chaque version suivante, c'est l'étape 4 avec la nouvelle version : montez les deux
`package.json`, ouvrez la section `## <version>` dans `packages/bmd/CHANGELOG.md`, poussez
`bmd-v<version>`.

**À la main, sans CI** (déconseillé ; aucune vérification ne tourne) : `npm pack` puis
`npm publish <archive> --access public --provenance=false` depuis `packages/bmd`, puis depuis
`packages/bmd-editor`. `--provenance=false` est nécessaire parce que `publishConfig.provenance`
est activé et que la provenance ne peut être générée qu'en CI.

- **En local, les mêmes contrôles :** dans `apps/web` après `npm ci`,
  `node ../../packages/bmd/scripts/build.mjs`, `node scripts/check-bmd-publish.mjs`, puis
  `node ../../packages/bmd/scripts/smoke.mjs --clients npm,pnpm --types --audit` (réseau et pnpm
  dans le PATH requis).
- **Artefact :** `bmd-tarballs`, 14 jours.

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
| `NPM_TOKEN` | **secret** (environnement `npm`) | publish-bmd | un jeton npm granulaire pour la PREMIÈRE version de B.MD seulement ; à supprimer une fois la publication de confiance configurée |

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

- *Décidé le 2026-09-25 :* un déploiement attend un run *BCWEB security* vert pour son commit
  (ci-dessus) ; le DAST reste consultatif. Tant que les constats de
  [SECURITY_CI_FR.md](SECURITY_CI_FR.md#6-ce-que-les-scans-ont-trouvé-le-2026-09-25-et-ce-qui-a-été-fait)
  ne sont pas tous fermés, le workflow de sécurité peut être rouge, et alors **aucun
  déploiement ne passe** : c'est l'effet voulu, pas un bug du déploiement.
- Les artifacts de rapports d'un dépôt public peuvent être téléchargés par tout utilisateur
  GitHub connecté. Le rapport Gitleaks est masqué ; les autres décrivent le code (public de toute
  façon) et une instance jetable. Un DAST contre un vrai staging publierait ses constats de la
  même manière.
