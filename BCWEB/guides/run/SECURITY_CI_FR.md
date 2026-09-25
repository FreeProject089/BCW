# BCWEB — Tests de sécurité en CI (FR)

> 🇬🇧 English version: [SECURITY_CI_EN.md](SECURITY_CI_EN.md)
> La vue d'ensemble de tous les workflows (CI, sécurité, DAST, déploiement) est [CI_CD_FR.md](CI_CD_FR.md).

Des tests de sécurité automatiques, **sans IA**, à chaque push et pull request, chaque semaine
et à la demande. Cinq outils open source, chacun épinglé, chacun écrit un rapport qu'un petit
script de gate lit et juge par sévérité :

| Outil | Ce qu'il examine | Workflow / job |
|---|---|---|
| **Gitleaks** | les secrets dans l'**historique git** (chaque commit) | `security.yml` / `gitleaks` |
| **Semgrep** | le code source (SAST) : Node/Fastify, React, Rust, Dockerfiles, nginx, GitHub Actions | `security.yml` / `semgrep` |
| **Trivy** (fs) | les lockfiles (npm, cargo) et les Dockerfiles (mauvaise configuration) | `security.yml` / `trivy-fs` |
| **Trivy** (image) | les cinq images telles que construites : paquets OS, npm embarqué, secrets dans une couche | `security.yml` / `trivy-image` |
| **OWASP ZAP** | un site qui tourne : en-têtes, CSP, cookies, fuites d'information (passif + spiders) | `dast.yml` / `local`, `staging` |
| **Nuclei** | un site qui tourne : expositions et mauvaises configurations connues (modèles non intrusifs) | `dast.yml` / `local`, `staging` |

Ils **complètent** les contrôles que `ci.yml` avait déjà, ils ne les remplacent pas :
`secret-scan.mjs` garde l'arbre courant (Gitleaks ajoute l'historique), `dep-audit.mjs` lance
toujours `npm audit` / `cargo audit` avec sa liste d'exceptions motivées (Trivy ajoute une
deuxième base d'avis, les Dockerfiles et les images).

---

## 1. La gate : ce qui fait échouer un build

Chaque scanner sort en 0 et écrit son rapport (JSON ; JSONL pour Nuclei). Ensuite
`.github/scripts/security-gate.mjs` le lit, place chaque constat sur une seule échelle —
critical > high > medium > low > info — imprime un tableau et décide :

| Sévérité | Par défaut | Peut-elle bloquer ? |
|---|---|---|
| CRITICAL, HIGH | **bloque** | oui |
| MEDIUM | passe | seulement si le seuil vaut `medium` (ou `low`) |
| LOW | passe | seulement si quelqu'un règle volontairement le seuil sur `low` |
| INFO | passe | **jamais** |
| Gitleaks (tout secret) | **bloque** | toujours : un identifiant fuité n'est jamais « low » |

Correspondances : Semgrep ERROR→high, WARNING→medium, INFO→low ; Trivy tel quel, et un avis
UNKNOWN (pas encore noté) compte comme **high** tant qu'il n'est pas noté ; ZAP risque
High/Medium/Low/Informational ; Nuclei tel quel. Une alerte marquée « faux positif » dans ZAP
(confiance 0) n'est pas comptée.

**Le seuil est une variable du dépôt** (Settings → Secrets and variables → Actions →
Variables), avec les mêmes noms que les pipelines BMM / BetterInstaller :

| Variable | Valeurs | Signification |
|---|---|---|
| `SECURITY_GATE_SEVERITY` | `critical` `high` `medium` `low` | la sévérité la PLUS BASSE qui fait échouer. Non définie = `high` |
| `SECURITY_GATE_SEVERITY_SEMGREP` / `_TRIVY` / `_ZAP` / `_NUCLEI` | idem | la remplace pour un outil |

« MEDIUM bloque » s'écrit donc `SECURITY_GATE_SEVERITY` = `medium`, et « MEDIUM bloque pour ZAP
seulement » `SECURITY_GATE_SEVERITY_ZAP` = `medium`. Une valeur hors de ces quatre est
**refusée** (le job échoue, code 2) plutôt que devinée : une faute de frappe ne doit pas devenir
« rien ne bloque ». `SECURITY_GATE_SEVERITY_GITLEAKS` est accepté et ignoré, avec une ligne qui
le dit.

La gate échoue aussi (code 2) quand elle ne peut pas se fier au rapport : absent, JSON invalide,
pas la forme de l'outil, un Semgrep qui n'a scanné aucun fichier. **Un scan qui n'a pas tourné
n'est pas un scan qui n'a rien trouvé.** Les jobs DAST ajoutent trois contrôles du même type :
Nuclei doit avoir chargé des milliers de modèles et fini sans abandonner la cible, et l'instance
doit toujours répondre après les scans (la protection anti-abus de l'API bloque une adresse dix
minutes après des accès répétés de scanner, et un scanner bloqué ne voit rien).

Chaque job écrit le tableau dans son log, dans la page **Summary** du run, et en
`<outil>-summary.md` dans son artifact. Sur une pull request il apparaît aussi en un seul
commentaire, mis à jour sur place ([CI_CD_FR.md](CI_CD_FR.md#lire-les-résultats)).

La gate est testée avant tout le reste (job `gate-selftest`) :

```bash
node --test .github/scripts/security-gate.test.mjs .github/scripts/dast-scope.test.mjs
```

---

## 2. Chaque scan, et comment le lancer à la main

Tout se lance depuis la **racine du dépôt** (`BCW/`). Les images sont celles des workflows,
épinglées par tag et digest ; copiez-les depuis le bloc `env:` de `.github/workflows/security.yml`
ou `dast.yml` (abrégées ici en `$GITLEAKS_IMAGE` etc.). Sous Windows (Git Bash), mettez
`MSYS_NO_PATHCONV=1` devant `docker run`, sinon Git Bash réécrit les chemins du conteneur.

Puis jugez n'importe quel rapport exactement comme la CI :

```bash
node .github/scripts/security-gate.mjs --tool semgrep --report reports/semgrep.json
env SECURITY_GATE_SEVERITY=medium node .github/scripts/security-gate.mjs --tool semgrep --report reports/semgrep.json
```

### Gitleaks — secrets dans l'historique

- **Push / pull request** : seulement les commits qu'ils apportent (`before..after`,
  `base..head`) : c'est ce qu'ils peuvent encore corriger.
- **Planification hebdomadaire / lancement manuel** : **tout l'historique de toutes les refs**.
  Un vieux secret apparaît ici, et continue d'apparaître tant qu'il n'est pas révoqué et revu.
- Config : `.github/security/gitleaks.toml` = les règles intégrées de Gitleaks plus une règle
  **token de bot Discord** (la forme que ce projet a déjà fuitée ; les règles Discord intégrées
  ne la reconnaissent pas). Le rapport est **masqué** : les artifacts d'un dépôt public ne
  doivent pas devenir une deuxième fuite.

```bash
mkdir -p reports
docker run --rm -v "$PWD:/repo:ro" -v "$PWD/reports:/reports" \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/repo \
  "$GITLEAKS_IMAGE" git --config /repo/.github/security/gitleaks.toml \
  --gitleaks-ignore-path /repo/.github/security/.gitleaksignore \
  --redact --no-banner --exit-code 0 --report-format json --report-path /reports/gitleaks.json /repo
# seulement certains commits :  ajouter  --log-opts="origin/master..HEAD"
```

Lisez le log : il doit dire `N commits scanned` avec N > 0. Quand git refuse le dépôt dans le
conteneur (« dubious ownership »), Gitleaks écrit une erreur, scanne **0 commit** et produit
quand même un rapport vide — d'où la ligne `safe.directory`, et le contrôle du nombre dans le job.

### Semgrep — SAST

Les règles ne sont **pas** un pack du registre (`p/javascript` change sur semgrep.dev sans
changement de version, deux runs d'un même commit pourraient diverger). Ce sont celles du dépôt
`semgrep/semgrep-rules` à un commit, récupéré par son hash, et seulement les règles `security`
adaptées à cette stack — JavaScript, React, Rust, Dockerfile, nginx, GitHub Actions, compose —
sans le niveau `audit` (règles « relecture manuelle, beaucoup de faux positifs » de Semgrep :
~400 constats de plus ici, presque tous du bruit). La sélection est dans
`.github/scripts/semgrep-rules.sh` ; la CI et vous lancez la même. Les exclusions par défaut de
Semgrep s'appliquent (`node_modules`, `dist`, `build`, `test/`, `tests/`).

```bash
env SEMGREP_RULES_SHA=<le SHA de security.yml> bash .github/scripts/semgrep-rules.sh /tmp/semgrep-rules
docker run --rm -v "$PWD:/src:ro" -v /tmp/semgrep-rules:/rules:ro -v "$PWD/reports:/reports" -w /src \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/src \
  "$SEMGREP_IMAGE" semgrep scan --metrics=off --disable-version-check --config /rules \
  --json-output=/reports/semgrep.json --sarif-output=/reports/semgrep.sarif --quiet /src
```

### Trivy fs — lockfiles et Dockerfiles

`--scanners vuln,misconfig` sur le checkout. Deux choses sont volontairement partagées avec
l'audit de `ci.yml`, pour qu'ils ne puissent pas diverger en silence : le périmètre (le lockfile
**racine** du tableau de bord télémétrie appartient à l'ancienne version Express qu'aucune image
ne construit ; `npm-audit` l'ignore pour cette raison) et l'exception revue
(`GHSA-jrc7-96c5-q579` / `CVE-2026-85061`, maplibre, jugée dans `.github/audit-ignore.json` et
reportée dans `.github/security/trivyignore.yaml` avec une date d'expiration).

```bash
docker run --rm -v "$PWD:/src:ro" -v "$PWD/reports:/reports" -v trivy-cache:/root/.cache/trivy -w /src \
  "$TRIVY_IMAGE" fs --scanners vuln,misconfig \
  --skip-files BCWEB/bmm/telemetry-dashboard/package-lock.json \
  --ignorefile .github/security/trivyignore.yaml --show-suppressed \
  --format json --output /reports/trivy-fs.json --exit-code 0 .
```

La base d'avis est téléchargée à chaque run et n'est **pas** épinglée, exprès : un nouvel avis
sur un lockfile inchangé est justement ce que ce job doit voir — il peut passer au rouge sans
changement de code.

### Trivy image — les cinq images

Chaque image est construite comme `infra/compose/docker-compose.yml` la construit (`--pull` :
l'image de base du jour), sauvegardée dans une archive et scannée depuis celle-ci (le scanner
n'a jamais le socket Docker), pour les vulnérabilités (paquets OS et tous les paquets de langage
de l'image, y compris le `npm` livré dans `node:22-alpine`) et pour les secrets laissés dans une
couche.

```bash
docker build --pull -t bcweb-api:scan -f BCWEB/apps/api/Dockerfile BCWEB
docker save -o /tmp/image.tar bcweb-api:scan
docker run --rm -v /tmp:/img:ro -v "$PWD/reports:/reports" -v "$PWD/.github/security:/cfg:ro" \
  -v trivy-cache:/root/.cache/trivy "$TRIVY_IMAGE" image --input /img/image.tar \
  --scanners vuln,secret --ignorefile /cfg/trivyignore.yaml --show-suppressed \
  --format json --output /reports/trivy-image-api.json --exit-code 0
```

(bot : contexte `BCWEB/apps/bot` ; telemetry : contexte `BCWEB/bmm/telemetry-dashboard` ; web et
provisioner : contexte `BCWEB`, Dockerfile sous `BCWEB/apps/…`.)

### ZAP et Nuclei — DAST

**Ce qui est scanné.** Par défaut une instance que le job démarre lui-même (section 3), jamais
un site déployé. `.github/scripts/dast-scope.mjs` passe en premier et refuse tout ce qui sort du
périmètre avant la moindre requête.

**ZAP** lance `zap-baseline.py` : les règles passives, le spider classique (2 minutes) et le
spider AJAX — aucune charge d'attaque. Le scan **actif** (`zap-full-scan.py`) ne tourne que si
quelqu'un lance le workflow DAST à la main avec `zap_mode = full`, contre l'instance locale de
la CI ; sur le staging il est refusé sauf si `DAST_ALLOW_ACTIVE_STAGING` = `true`. Un hook
(`.github/security/zap-hooks.py`) fait écrire à ZAP son propre SARIF.

**Nuclei** lance les modèles `http` de `nuclei-templates` à un commit, sans les tags `dos`,
`fuzz`, `intrusive`, `bruteforce`, `default-login`, sans les dossiers `http/fuzzing` et
`http/credential-stuffing`, sans rappels hors bande (`-ni`), sans suivre les redirections
(`-dr`), à 100 requêtes/s sur l'instance locale et 10 (ou `DAST_NUCLEI_RATE_LIMIT`) sur le
staging.

Les deux passent par `.github/scripts/dast-scan.sh`, pour que la CI et vous les lanciez de la
même façon :

```bash
node .github/scripts/dast-scope.mjs --target http://localhost --mode local
env NUCLEI_TEMPLATES_SHA=<le SHA de dast.yml> bash .github/scripts/dast-scan.sh templates /tmp/nuclei-templates
env TARGET=http://localhost REPORTS="$PWD/reports" DOCKER_NET_ARGS="--network container:edge" \
  ZAP_IMAGE="$ZAP_IMAGE" ZAP_RULES=.github/security/zap-rules.tsv bash .github/scripts/dast-scan.sh zap
env TARGET=http://localhost REPORTS="$PWD/reports" DOCKER_NET_ARGS="--network container:edge" \
  NUCLEI_IMAGE="$NUCLEI_IMAGE" NUCLEI_TEMPLATES=/tmp/nuclei-templates bash .github/scripts/dast-scan.sh nuclei
node .github/scripts/security-gate.mjs --tool zap --report reports/zap/zap.json --zap-rules .github/security/zap-rules.tsv
node .github/scripts/security-gate.mjs --tool nuclei --report reports/nuclei/nuclei.jsonl
```

---

## 3. L'instance locale de la CI, et tester sans toucher la production

Le job DAST `local` monte dans le runner une petite copie de la stack, comme la production la
fait tourner, et scanne celle-ci :

1. un service Postgres ; les migrations du dépôt (`prisma migrate deploy`) ; les seeds de base et
   de démo (contenu de `npm run seed:demo`) pour que les spiders trouvent des pages ;
2. l'API en `node src/server.mjs` avec **`NODE_ENV=production`**, pour que la garde de démarrage
   (`apps/api/src/lib/boot-guard.mjs`) s'applique comme en production. Elle refuse les secrets
   d'exemple du dépôt, donc chaque secret est généré pour ce run avec `openssl rand` puis jeté.
   `SITE_URL=http://localhost` y est un avertissement, pas un refus ;
3. **ni** bot, ni Stripe, ni Discord, ni mail, ni stockage objet : leurs variables restent vides
   (l'API tourne sans eux ; le stockage pointe sur un port fermé). `RATE_LIMIT_MAX` est relevé —
   le réglage d'exploitation documenté — sinon une seule adresse de scanner mesurerait le
   limiteur ; les limites par route restent (quelques centaines de 429 sont normales et
   signalées) ;
4. le web construit, servi par `nginx:alpine` avec le `nginx.conf` du dépôt, et **le Caddyfile
   du dépôt** devant (`caddy:2-alpine`, l'image de compose). Les en-têtes, la CSP, les
   redirections et les règles de bord que ZAP juge sont donc ceux de la production. Les scanners
   rejoignent le réseau du conteneur de bord et scannent `http://localhost` ; rien n'est publié
   sur le runner.

**Pour le répéter sur votre machine** (jamais sur la base de la stack de dev elle-même) :

```bash
# 1. une base jetable dans le Postgres de dev (ou n'importe quel Postgres)
docker exec bcweb-db-1 psql -U bcweb -d postgres -c "CREATE ROLE secci LOGIN PASSWORD '<aléatoire>'" -c "CREATE DATABASE bcweb_secci OWNER secci"
cd BCWEB/apps/api
env DATABASE_URL=postgresql://secci:<aléatoire>@127.0.0.1:5432/bcweb_secci DIRECT_DATABASE_URL=postgresql://secci:<aléatoire>@127.0.0.1:5432/bcweb_secci npx prisma migrate deploy --schema ../../packages/db/schema.prisma
# 2. seeder (sans NODE_ENV=production), puis démarrer l'API sur :3000 avec les variables de
#    l'étape « Start the API » de dast.yml (secrets aléatoires, NODE_ENV=production, SITE_URL=http://localhost)
# 3. construire le web :  cd BCWEB/apps/web && npm run build
# 4. web + bord, depuis la racine du dépôt :
docker network create dast
docker run -d --name web --network dast --network-alias web -v "$PWD/BCWEB/apps/web/dist:/usr/share/nginx/html:ro" -v "$PWD/BCWEB/apps/web/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine
docker run -d --name edge --network dast --add-host api:host-gateway -v "$PWD/BCWEB/infra/caddy:/etc/caddy:ro" caddy:2-alpine caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
# 5. les commandes de la section 2 (ZAP et Nuclei)
# 6. ranger : docker rm -f web edge ; docker network rm dast ; arrêter l'API ;
#    DROP DATABASE bcweb_secci ; DROP ROLE secci
```

Les upstreams du Caddyfile sont `api:3000` et `web:80` : le port 3000 doit être libre pour l'API.

**Pourquoi la production ne peut pas être touchée**, de trois façons indépendantes, toutes avant
la première requête :

1. `dast-scope.mjs` refuse **bettercommunity.ch et tous ses sous-domaines**, le serveur de
   production **45.145.164.20** (comme cible littérale, et comme adresse vers laquelle une cible
   se résout), tout ce qui est dans `DAST_DENY_HOSTS`, un nom de staging qui se résout vers la
   même adresse que la production, et en mode local tout ce qui n'est pas localhost. Codé en dur
   — aucune variable ne le désactive — et testé (`dast-scope.test.mjs`, rouge avant que le script
   existe).
2. `.github/scripts/dast-block-production.sh` ajoute sur le runner des règles de pare-feu qui
   rejettent tout paquet vers 45.145.164.20 et vers les adresses des noms de production, pour
   l'hôte et pour chaque conteneur, et relit chaque règle.
3. Dans les conteneurs des scanners, les noms de production se résolvent vers une adresse
   locale morte.

---

## 4. Ajouter ou exclure une cible

Les seules cibles sont l'instance locale de la CI et **une** URL de staging :

| Variable | Exemple | Signification |
|---|---|---|
| `DAST_STAGING_URL` | `https://staging.example.org` | le site de staging. Scanné par la planification hebdomadaire s'il est défini, ou à la main (Run workflow → `target: staging`) |
| `DAST_ALLOWED_HOSTS` | `staging.example.org` | les hôtes qui peuvent être scannés, séparés par virgules ou espaces, noms **exacts** (pas de joker). Une URL de staging dont l'hôte n'y est pas est refusée |
| `DAST_DENY_HOSTS` | `example.org` | des hôtes supplémentaires jamais scannés ; chaque entrée interdit l'hôte **et ses sous-domaines**. L'interdiction gagne toujours |
| `DAST_ALLOW_ACTIVE_STAGING` | `true` | autorise `zap_mode = full` (scan d'attaque actif) sur le staging. Non défini = refusé |
| `DAST_NUCLEI_RATE_LIMIT` | `10` | requêtes/s pour Nuclei sur le staging (10 par défaut) |

Pour **ajouter** une cible de staging : définir `DAST_STAGING_URL`, mettre son hôte dans
`DAST_ALLOWED_HOSTS`, et vérifier qu'il ne partage pas d'adresse avec la production (le contrôle
de périmètre le refuse sinon). Pour en **exclure** une : la retirer de `DAST_ALLOWED_HOSTS` ou
l'ajouter à `DAST_DENY_HOSTS`. La production n'a besoin de rien : elle est codée en dur. Un
staging derrière une connexion ou une authentification basique n'est pas pris en charge tel quel
(aucun secret n'est configuré) : c'est une décision à prendre d'abord.

---

## 5. Exclure un constat (un faux positif revu)

La règle pour chaque outil : **une exclusion s'écrit dans le dépôt, à côté de la config de
l'outil, avec la raison, le relecteur et la date — et aussi étroite que l'outil le permet.**
Elle est revue en pull request comme du code. Un vrai constat est corrigé, ou laissé en échec
en attendant une décision ; il n'est jamais exclu pour faire passer un build.

| Outil | Où | Jusqu'où c'est étroit |
|---|---|---|
| Gitleaks | `.github/security/.gitleaksignore` | une **empreinte** = un commit, un fichier, une règle, une ligne. La même valeur recommitée échoue à nouveau |
| Semgrep | sur la ligne : `// nosemgrep: <id-de-règle> -- <raison>` | une règle, une ligne |
| Trivy | `.github/security/trivyignore.yaml` | un avis ou un contrôle, limité par `paths:`, avec un `statement:` et une date `expired_at:` (il revient à cette date) |
| ZAP | `.github/security/zap-rules.tsv` : `<id du plugin>` TAB `IGNORE` TAB `(<raison>)` | un plugin ; la gate **refuse** une ligne IGNORE sans raison |
| Nuclei | `-et <modèle>` dans `.github/scripts/dast-scan.sh`, avec un commentaire | un modèle |

`npm audit` / `cargo audit` gardent leur propre liste, `.github/audit-ignore.json` (inchangée).

**Fermer une alerte dans l'onglet Security n'est pas une exclusion.** Cela masque l'alerte sur
GitHub, mais la gate lit le rapport du scanner, pas l'état de l'alerte GitHub : un build qui
échoue continue d'échouer. Utilisez une fermeture (avec sa raison : *false positive*, *used in
tests*, *won't fix*, et un commentaire) seulement pour une alerte qui **ne bloque pas** —
typiquement un MEDIUM ou un LOW — et préférez l'exclusion dans le dépôt pour tout le reste :
elle est versionnée, revue, s'applique à la gate et à l'artifact, et survit à un nouvel envoi.
Voir [CI_CD_FR.md](CI_CD_FR.md#lire-les-résultats).

---

## 6. Ce que les scans ont trouvé le 2026-09-25, et ce qui a été fait

Lancés localement avec les versions épinglées, sur ce dépôt et sur une instance locale.

| Outil | Constat | Fait |
|---|---|---|
| Semgrep | `apps/api/src/lib/shred.mjs` : déchiffrement AES-GCM sans `authTagLength` — un tag de 4 octets était accepté (falsification en 2^32 essais) | **corrigé** (`authTagLength: 16`) + un test qui était rouge sur l'ancien code |
| Semgrep | `apps/web/src/ui/post-bits.jsx` : `innerHTML` pour un compteur de commentaires | **corrigé** (`textContent`, même rendu) |
| Nuclei | redirection ouverte au bord : `/%5Cevil.example/` répondait `308 Location: /\evil.example` (la règle de slash final du Caddyfile) | **corrigé** dans `infra/caddy/Caddyfile`, validé par `caddy validate` et `site.mjs selftest`, re-scanné propre |
| Trivy / Semgrep | `Dockerfile` de la télémétrie : pas de `USER` (la base distroless `:nonroot` tourne déjà en uid 65532) | rendu explicite (`USER nonroot`, aucun changement à l'exécution) |
| Semgrep | 8 faux positifs (SQL construit avec des identifiants vérifiés contre `pg_class` ; sondes serveur vers les services compose) | `nosemgrep` sur chaque ligne, avec la raison |
| Gitleaks | 25 faux positifs dans l'historique (fixtures de test contenant FAKE/TEST, exemples de doc, noms de clés localStorage) | `.gitleaksignore`, par empreinte |
| Gitleaks | valeur de `TELEMETRY_API_KEY` dans l'historique de `infra/compose/.env.example` (2 commits) | **non exclu** — décision du propriétaire (clé d'ingestion publique par conception ?) |
| Semgrep | 44 ERROR dans l'ancienne version Express de la télémétrie (`bmm/telemetry-dashboard/*.mjs`, `public/app.js`), construite dans aucune image | **non exclu** — décision du propriétaire (supprimer les fichiers hérités ?) |
| Trivy fs | `DS-0002` : `apps/web/Dockerfile` lance nginx en root | **non exclu** — décision du propriétaire (nginx non privilégié = un autre port dans le Caddyfile) |
| Trivy image | api, bot, provisioner : HIGH/CRITICAL dans le `npm` livré avec `node:22-alpine` (tar, brace-expansion, pacote, sigstore…) ; libexpat dans plusieurs images | **non exclu** — décision du propriétaire (monter l'image de base, ou retirer npm des images d'exécution) |
| ZAP | MEDIUM : CSP `style-src 'unsafe-inline'`, sources joker, pas de `form-action` ; LOW : COEP/COOP/CORP absents | sous le seuil par défaut ; listés pour le propriétaire |

---

## 7. Versions, et comment les monter

| Quoi | Épinglé par | Où |
|---|---|---|
| Gitleaks, Semgrep, Trivy, ZAP, Nuclei | image `tag@sha256:digest` | `env:` de `security.yml`, `dast.yml` |
| Règles Semgrep | commit de `semgrep/semgrep-rules` | `SEMGREP_RULES_SHA` dans `security.yml` |
| Modèles Nuclei | commit de `nuclei-templates` (tag v10.4.9) | `NUCLEI_TEMPLATES_SHA` dans `dast.yml` |
| Actions GitHub | SHA de commit, tag en commentaire | chaque `uses:` |
| Base d'avis de Trivy | **non épinglée**, exprès | — |

Pour monter une image : `docker buildx imagetools inspect <image>:<nouveau tag>` donne le
digest ; changer tag et digest ensemble, relancer les scans localement, lire ce qui a changé.
Pour les règles ou les modèles : le nouveau SHA de commit, pareil. Pour une action :
`git ls-remote https://github.com/<owner>/<repo> refs/tags/<tag>` (un tag annoté demande
`^{}`), lire le diff, changer SHA et commentaire.
