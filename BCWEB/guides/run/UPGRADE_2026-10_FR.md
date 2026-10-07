# Mise à jour du serveur v1 — octobre 2026

Runbook à copier-coller pour passer le serveur de production de `883b9358` (2026-09-17) au
`master` actuel. Tu lances tout toi-même, sur le serveur, dans l'ordre. Chaque étape donne la
commande, ce que tu dois voir, quoi faire sinon, et comment revenir en arrière.

**Le serveur, tel qu'il est.** LXC Alpine sous Proxmox chez toi (192.168.1.56), derrière la
Freebox (192.168.1.254). L'IPv4 publique 45.145.164.20 est prêtée par **Hexanode** (FEELB SARL) :
c'est Hexanode qui termine le HTTPS (son propre certificat) et ne relaie que les noms déclarés
dans son panneau (aujourd'hui `bettercommunity.ch` et `telemetry.`) vers le port 80 du LXC. Un
nom inconnu reçoit « tls: unrecognized name » ou un 404 **chez Hexanode**, avant Caddy.

Donc le Caddy du serveur ne détient **aucun** certificat et ne doit jamais en chercher : chaque
adresse de site s'écrit `http://nom` (`SITE_DOMAIN`, `TELEMETRY_DOMAIN`, `S3_DOMAIN`, les fichiers
de `infra/caddy/sites.d/`). Les adresses **publiques** (`SITE_URL`, `TELEMETRY_PUBLIC_URL`,
`S3_PUBLIC_ENDPOINT`) restent en `https://` : c'est ce que voit le navigateur.

Ce qui change avec le nouveau code : MinIO est remplacé par `storage` (copie des objets, site
coupé pendant la copie) ; l'API refuse de démarrer sur certains secrets manquants ou faibles ; le
dossier `infra/caddy/` est monté en entier (sites supplémentaires dans `sites.d/`) ; seuls 80/443
de Caddy sont publiés sur le réseau.

Partout plus bas :

```sh
R=/srv/BetterCommunity/BCW            # le dépôt
C=$R/BCWEB/infra/compose              # le dossier compose (là où est .env)
cd $C
```

Si un shell est rouvert, relance ces trois lignes.

**À faire tout de suite, avant même l'étape 0 :** demande à Hexanode d'ajouter `s3.bettercommunity.ch`
(voir l'[étape 9](#9-hexanode--les-noms-relayés)). Sans lui, les images, téléchargements et envois
qui passent par une URL de stockage signée (`https://s3.…`) échouent, avant comme après la mise
à jour.

---

## 0. Vérifications en lecture seule

Rien ici ne modifie quoi que ce soit. Copie toute la sortie et garde-la (elle sert aussi pour
revenir en arrière).

```sh
cd $C
date; id; df -h "$HOME" /var/lib/docker 2>/dev/null
docker version --format '{{.Server.Version}}'; docker compose version --short
for t in node curl wget openssl; do printf '%s: ' $t; command -v $t || echo absent; done
git -C $R rev-parse --short HEAD; git -C $R status --short
ls -l docker-compose.override.yml ~/server-local-2026-10-07.patch
ls -l /srv/BetterCommunity/deploy-gate.disabled 2>/dev/null || echo "interrupteur CD absent"
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' | tee ~/docker-ps-avant-2026-10-07.txt
docker volume ls --format '{{.Name}}' | grep -E '^bcweb_'
docker inspect -f '{{.Config.Image}}' bcweb-minio-1
docker run --rm -v bcweb_minio-data:/d:ro alpine du -sh /d
# Noms des variables de .env (sans les valeurs), puis les schémas des adresses :
grep -oE '^[A-Z][A-Z0-9_]*=' .env | tr -d = | sort | tr '\n' ' '; echo
grep -E '^(SITE_DOMAIN|SITE_URL|TELEMETRY_DOMAIN|TELEMETRY_PUBLIC_URL|S3_DOMAIN|S3_PUBLIC_ENDPOINT|S3_ENDPOINT|S3_BUCKET|COOKIE_DOMAIN|REPO_PUBLIC_BASE|API_REPLICAS|POSTGRES_USER|POSTGRES_DB)=' .env
printf 'S3_SECRET_KEY: %s caractères\n' "$(grep '^S3_SECRET_KEY=' .env | cut -d= -f2- | tr -d '\r\n' | wc -c)"
[ "$(grep '^LINK_LOOKUP_SECRET=' .env | cut -d= -f2-)" = "$(grep '^JWT_SECRET=' .env | cut -d= -f2-)" ] && echo "LINK_LOOKUP_SECRET = JWT_SECRET (ou absent des deux)" || echo "LINK_LOOKUP_SECRET différent de JWT_SECRET"
# D'où arrivent les visiteurs (l'adresse du relais Hexanode vue par Caddy) :
docker exec bcweb-caddy-1 netstat -tn 2>/dev/null | awk '$4 ~ /:80$/ {print $5}' | sed 's/:[0-9]*$//' | sort | uniq -c
```

**Attendu :** HEAD `883b9358`, `git status` ne montre que `M BCWEB/infra/caddy/Caddyfile` et
`M BCWEB/infra/compose/docker-compose.yml`, le patch et l'override existent, les volumes
s'appellent `bcweb_*` (dont `bcweb_minio-data`), `bcweb-minio-1` tourne.
**Place disque :** il faut au moins deux fois la taille de `bcweb_minio-data` libre (une archive
plus la copie dans `s3-data`), plus de quoi construire les images.
**Sinon :** ne commence pas ; envoie la sortie.

La dernière commande liste les adresses distantes des connexions au port 80. Une adresse qui
revient pour toutes les connexions est celle du relais : c'est la valeur de `TRUSTED_PROXIES`
(étape 4). Si la liste est vide, recharge le site dans un navigateur puis relance-la.
Si c'est une adresse en `172.x.x.1` (la passerelle Docker), les connexions passent par le
relais de ports de Docker et l'adresse d'origine est perdue avant Caddy : laisse alors
`TRUSTED_PROXIES` vide et envoie la sortie.

Coupe le CD pendant toute la mise à jour (s'il est installé) :
`touch /srv/BetterCommunity/deploy-gate.disabled`.

## 1. Sauvegardes

```sh
mkdir -p ~/backups && cd $C
docker exec bcweb-db-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > ~/backups/bcweb-db-2026-10-07.dump
ls -lh ~/backups/bcweb-db-2026-10-07.dump
docker exec -i bcweb-db-1 pg_restore -l < ~/backups/bcweb-db-2026-10-07.dump | head -5
cp .env ~/backups/env-avant-2026-10-07 && chmod 600 ~/backups/env-avant-2026-10-07
```

**Attendu :** un fichier de plusieurs Mo, et `pg_restore -l` affiche un en-tête « Archive
created at … ». **Sinon** (fichier de 0 octet, erreur) : ne continue pas.

Puis, **depuis ton PC** (PowerShell ou terminal) :

```sh
scp -P 2222 freeproject@45.145.164.20:backups/bcweb-db-2026-10-07.dump .
```

La copie de `.env` contient tous les secrets : garde-la sur le serveur (`chmod 600`), ne
l'envoie nulle part.

**Les fichiers (MinIO).** Les objets du volume `bcweb_minio-data` ne sont **jamais modifiés** par
cette mise à jour : ils sont seulement lus pendant la copie. C'est lui, la sauvegarde. Une archive en plus,
tant que MinIO tourne encore (lecture seule, aucune coupure ; copie à chaud, donc un envoi
en cours pendant l'archive peut y manquer — le volume reste la référence) :

```sh
docker run --rm -v bcweb_minio-data:/data:ro -v "$HOME/backups":/backup alpine \
  tar czf /backup/minio-avant-2026-10-07.tar.gz -C /data .
ls -lh ~/backups/minio-avant-2026-10-07.tar.gz
```

## 2. Les modifications locales, puis le nouveau code

Elles sont déjà sauvées dans `~/server-local-2026-10-07.patch`. Ce qu'elles faisaient est
maintenant dans le dépôt (`extra_hosts`, montage du dossier caddy) ou passe par `sites.d/` (le
bloc `bettervault`, étape 6.8).

```sh
cd $R
grep -c '^+' ~/server-local-2026-10-07.patch      # le patch n'est pas vide
git checkout -- BCWEB/infra/caddy/Caddyfile BCWEB/infra/compose/docker-compose.yml
git status --short                                 # plus rien de modifié
git pull --ff-only
git log -1 --format='%h %ci %s'
ls BCWEB/guides/run/UPGRADE_2026-10_FR.md        # ce guide est bien dans le code tiré
```

**Attendu :** `git status` vide, puis le pull avance jusqu'au `master` du jour, qui contient ce
guide. S'il n'y est pas, le `master` n'a pas encore été poussé sur GitHub : pousse-le d'abord.
**Sinon :** « not a fast-forward » → envoie `git status` et `git log -3 --oneline`, ne force rien.

Rien ne s'arrête ici : les conteneurs tournent toujours sur l'ancien code. Le Caddy en marche
garde l'ancien Caddyfile (montage d'un seul fichier) jusqu'à sa recréation.

**Passe à l'étape 3 tout de suite** : tant que l'override de l'option B est là, toute commande
`docker compose` échoue (il nomme un service `minio` qui n'existe plus).

**Retour arrière :** `git checkout 883b9358 && git apply ~/server-local-2026-10-07.patch`.

## 3. L'override de l'option B

Le nouveau compose publie déjà l'API et le stockage sur `127.0.0.1` seulement, et `extra_hosts`
y est. L'override n'a plus rien à faire : on le met de côté (pas supprimé).

```sh
cd $C
mv docker-compose.override.yml ~/backups/override-optionB-2026-10-07.yml
docker compose config -q && echo "compose OK"
docker compose config | grep -E 'host_ip|published'
```

**Attendu :** `compose OK` (des avertissements sur des variables vides sont normaux à ce stade,
l'étape 4 les règle), puis uniquement `127.0.0.1` pour 3000-3009, 9000 et 5176, et `80` / `443`
sans `host_ip`.
**Sinon :** erreur `S3_SECRET_KEY`/`JWT_SECRET` « set in .env » → fais l'étape 4 puis reviens.

**Retour arrière :** `mv ~/backups/override-optionB-2026-10-07.yml docker-compose.override.yml`
(seulement avec l'ancien code).

## 4. `.env`

D'abord, ce que `.env.example` connaît et que ton `.env` n'a pas (noms seulement) :

```sh
cd $C
grep -oE '^#?[A-Z][A-Z0-9_]*=' .env.example | tr -d '#=' | sort -u > /tmp/k.ex
grep -oE '^[A-Z][A-Z0-9_]*=' .env | tr -d '=' | sort -u > /tmp/k.env
comm -23 /tmp/k.ex /tmp/k.env
```

La plupart sont optionnelles (IA, Stripe, OAuth…). Celles de la liste ci-dessous comptent.
(`node infra/check-env-spec.mjs` vérifie l'assistant de configuration, **pas** ton `.env` ; la
vraie vérification est celle de l'étape 5, faite par l'API elle-même.)

Deux petites fonctions pour écrire un secret **sans jamais l'afficher** :

```sh
rnd() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
setvar() { k=$1; v=$2; grep -v "^$k=" .env > .env.tmp; printf '%s=%s\n' "$k" "$v" >> .env.tmp; cat .env.tmp > .env; rm .env.tmp; echo "$k écrit"; }
```

| Variable | Valeur | Pourquoi |
|---|---|---|
| `SITE_DOMAIN` | `http://bettercommunity.ch` (ne change pas) | Caddy sert en HTTP, Hexanode fait le HTTPS. |
| `SITE_URL` | `https://bettercommunity.ch` | **Obligatoire en https** : sinon l'API refuse de démarrer (cookies non `Secure`). |
| `TELEMETRY_DOMAIN` | `http://telemetry.bettercommunity.ch` | Même raison que `SITE_DOMAIN`. |
| `TELEMETRY_PUBLIC_URL` | `https://telemetry.bettercommunity.ch` | Le bouton « ouvrir la télémétrie ». |
| `S3_DOMAIN` | `http://s3.bettercommunity.ch` (déjà fait) | |
| `S3_PUBLIC_ENDPOINT` | `https://s3.bettercommunity.ch` (déjà fait) | Signé dans chaque URL de fichier. |
| `COOKIE_DOMAIN` | `.bettercommunity.ch` | La session doit atteindre `telemetry.`. |
| `TLS_TERMINATED_UPSTREAM` | `true` | `site.mjs` écrit alors des sites en `http://`. |
| `TRUSTED_PROXIES` | l'adresse trouvée à l'étape 0, ex. `1.2.3.4/32` | Sans elle, tous les visiteurs ont l'IP du relais : limites de débit partagées, un bannissement d'IP bannit tout le monde. Vide si l'étape 0 n'a rien montré de clair (comportement d'avant). |
| `BOT_SHARED_SECRET` | `setvar BOT_SHARED_SECRET "$(rnd)"` | **Nouveau, obligatoire** (le bot et l'API le partagent via compose). |
| `LINK_LOOKUP_SECRET` | `setvar LINK_LOOKUP_SECRET "$(rnd)"` si l'étape 0 a dit « = JWT_SECRET » | **Obligatoire et différent de `JWT_SECRET`**, sinon refus de démarrer. |
| `S3_SECRET_KEY` | `setvar S3_SECRET_KEY "$(rnd)"` **seulement** s'il fait moins de 24 caractères | Refus de démarrer sinon. L'ancienne valeur reste dans `~/backups/env-avant-2026-10-07` : l'étape 6 en a besoin pour MinIO. |
| `S3_CORS_ALLOW_ORIGIN` | `https://bettercommunity.ch` | Remplace `MINIO_API_CORS_ALLOW_ORIGIN` (supprime l'ancienne ligne). |
| `S3_ENDPOINT` | supprime la ligne si elle vaut `http://minio:9000` | Ce service n'existe plus (le défaut est `http://storage:9000`). |
| `DOMAIN_ASK_KEY` | `setvar DOMAIN_ASK_KEY "$(rnd)"` | Recommandé (protège `/domains/ask`). |
| `TELEMETRY_ADMIN_KEY` | `setvar TELEMETRY_ADMIN_KEY "$(rnd)"` s'il vaut encore `change-me-admin` | Recommandé. |
| `REPO_PUBLIC_BASE` | `https://bettercommunity.ch/repos` s'il manque ou pointe sur localhost | Adresse donnée à BMM dans chaque repo hébergé. |
| `API_REPLICAS`, `SMTP_*`, `EMAIL_ENABLED` | ne change rien | Amazon SES continue tel quel. |

Pour les valeurs non secrètes, `setvar SITE_URL https://bettercommunity.ch` etc. Pour supprimer
une ligne : `grep -v '^MINIO_API_CORS_ALLOW_ORIGIN=' .env > .env.tmp && cat .env.tmp > .env && rm .env.tmp`.

Contrôle (sans valeurs secrètes) :

```sh
grep -E '^(SITE_DOMAIN|SITE_URL|TELEMETRY_DOMAIN|TELEMETRY_PUBLIC_URL|S3_DOMAIN|S3_PUBLIC_ENDPOINT|S3_CORS_ALLOW_ORIGIN|COOKIE_DOMAIN|TLS_TERMINATED_UPSTREAM|TRUSTED_PROXIES|REPO_PUBLIC_BASE)=' .env
for k in BOT_SHARED_SECRET LINK_LOOKUP_SECRET DOMAIN_ASK_KEY S3_SECRET_KEY; do printf '%s: %s caractères\n' $k "$(grep "^$k=" .env | cut -d= -f2- | tr -d '\r\n' | wc -c)"; done
docker compose config -q && echo "compose OK"
```

**Retour arrière :** `cp ~/backups/env-avant-2026-10-07 .env`.

## 5. Construire, et laisser l'API juger `.env` — site toujours en ligne

```sh
cd $C
docker compose build
docker compose run --rm --no-deps -T api node -e 'import("/app/src/lib/boot-guard.mjs").then((g)=>{const e=process.env;const p=g.productionSecretProblems(e);const s=g.productionSiteUrlProblem(e);if(p.length)console.log(g.formatProblems(p));if(s)console.log(g.formatSiteUrlProblem(s));console.log((p.length||(s&&s.severity!=="warning"))?"A CORRIGER":"OK")})'
```

La deuxième commande lance le **contrôle de démarrage de l'API elle-même** sur ton `.env`, sans
base de données et sans rien démarrer. Elle nomme les variables fautives, jamais leurs valeurs.

**Attendu :** le build finit sans erreur, puis `OK`.
**Sinon :** une erreur de build ne touche pas au site (les anciens conteneurs tournent) : envoie
les 30 dernières lignes. `A CORRIGER` : corrige les variables nommées (étape 4) et relance la
seconde commande.

Les **migrations de base** passent toutes seules au démarrage de l'API (étape 6.7), avant
qu'elle réponde `/ready`. Elles ne se défont pas : le dump de l'étape 1 est le retour arrière.

## 6. La bascule : MinIO → `storage`, puis démarrage

**Le site est coupé de 6.2 à 6.7.** Ne commence pas en plein envoi : une URL d'envoi signée vit
10 minutes.

```sh
cd $C
OLD="$HOME/backups/env-avant-2026-10-07"
old_k="$(grep '^S3_ACCESS_KEY=' "$OLD" | cut -d= -f2-)"; old_s="$(grep '^S3_SECRET_KEY=' "$OLD" | cut -d= -f2-)"
new_k="$(grep '^S3_ACCESS_KEY=' .env | cut -d= -f2-)";   new_s="$(grep '^S3_SECRET_KEY=' .env | cut -d= -f2-)"
B="$(grep '^S3_BUCKET=' .env | cut -d= -f2-)"; B="${B:-bcweb}"; echo "bucket: $B"
minio_img="$(docker inspect -f '{{.Config.Image}}' bcweb-minio-1)"; echo "$minio_img"
```

**6.1** — rien (l'archive MinIO est faite à l'étape 1).

**6.2 Arrêter ce qui écrit dans le stockage :**
```sh
docker compose stop api provisioner bot
```

**6.3 Mettre MinIO de côté** (même image, conteneur temporaire, aucun port publié, **anciennes**
clés) :
```sh
docker stop bcweb-minio-1
docker run -d --name bcweb-minio-old --network bcweb_default \
  -v bcweb_minio-data:/data -e MINIO_ROOT_USER="$old_k" -e MINIO_ROOT_PASSWORD="$old_s" \
  "$minio_img" server /data
sleep 5; docker logs --tail 5 bcweb-minio-old
```

**6.4 Démarrer le nouveau stockage :**
```sh
docker compose up -d storage
docker compose ps storage            # attendre (healthy), relancer la commande si (starting)
```
**Sinon :** « port is already allocated » → `docker ps | grep 9000` : quelque chose tient encore
9000 (l'ancien MinIO pas arrêté).

**6.5 Copier** (rclone, configuration en variables d'environnement, rien sur le disque) :
```sh
RC="docker run --rm --network bcweb_default \
  -e RCLONE_CONFIG_OLD_TYPE=s3 -e RCLONE_CONFIG_OLD_PROVIDER=Minio \
  -e RCLONE_CONFIG_OLD_ENDPOINT=http://bcweb-minio-old:9000 \
  -e RCLONE_CONFIG_OLD_ACCESS_KEY_ID=$old_k -e RCLONE_CONFIG_OLD_SECRET_ACCESS_KEY=$old_s \
  -e RCLONE_CONFIG_NEW_TYPE=s3 -e RCLONE_CONFIG_NEW_PROVIDER=Other \
  -e RCLONE_CONFIG_NEW_ENDPOINT=http://storage:9000 \
  -e RCLONE_CONFIG_NEW_ACCESS_KEY_ID=$new_k -e RCLONE_CONFIG_NEW_SECRET_ACCESS_KEY=$new_s \
  rclone/rclone:1.75.1"
$RC lsd old:                         # le bucket doit apparaître
$RC copy old:$B new:$B --metadata -v 2>&1 | tail -5
```
**Attendu :** `Transferred: N / N, 100%`, `Errors: 0`.
**Sinon :** `AccessDenied` sur `old:` → l'ancienne paire n'est pas la bonne (vérifie la copie de
`.env`). Une ligne `ERROR … 409` nomme une clé qui est aussi le « dossier » d'une autre : garde
celle que le site utilise et envoie la ligne.

**6.6 Vérifier — ne saute pas cette étape :**
```sh
$RC check old:$B new:$B 2>&1 | tail -3                      # "0 differences found"
$RC lsf -R --files-only --format psm old:$B > /tmp/old.txt
$RC lsf -R --files-only --format psm new:$B > /tmp/new.txt
diff /tmp/old.txt /tmp/new.txt && echo "types et tailles identiques"
```

**6.7 Démarrer tout le nouveau code** (`deploy.sh` : pull sans effet, build depuis le cache,
`up -d`, attente de `/ready`) :
```sh
cd $R/BCWEB
READY_TIMEOUT=300 infra/deploy.sh --no-backup
```
`--no-backup` : le dump de l'étape 1 a déjà été fait, et le `backup.sh` par défaut écrit dans
`/var/backups/bcweb`, où `freeproject` ne peut pas écrire.

**READY_URL.** `deploy.sh` attend `http://127.0.0.1:3000/ready`. Avec `API_REPLICAS=3`, les
répliques prennent les ports 3000 à 3009 de `127.0.0.1` dans l'ordre où elles démarrent ; le
port 3000 répond dès que l'une d'elles est prête. S'il dit « never became ready » alors que
`docker compose ps api` montre des répliques `(healthy)`, regarde quel port tient chacune :
`docker compose port --index 1 api 3000`, puis relance avec
`READY_URL=http://127.0.0.1:<port>/ready infra/deploy.sh --no-backup`.

**Attendu :** `✓ up and ready`. Puis :
```sh
cd $C
docker compose ps
docker compose logs caddy 2>&1 | grep bcweb-caddy | tail -2      # "serving /etc/caddy/Caddyfile …"
docker compose logs caddy 2>&1 | grep -ciE 'obtain|acme'         # 0 : Caddy ne cherche aucun certificat
wget -qO- --header 'Host: bettercommunity.ch' http://127.0.0.1/api/health; echo
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -v '127.0.0.1' # seuls caddy 80/443 (et bmm-repo-*, étape 8)
```
**Sinon :** `deploy.sh` ne peut pas revenir en arrière ici (même commit avant et après) : il
affiche les 40 dernières lignes de l'API. `[fatal] refusing to start in production` → corrige
`.env` (étape 4) et relance 6.7. Autre chose → [retour arrière](#retour-arrière-complet).

**6.8 BetterVault** (seulement quand son conteneur redémarre ; inutile tant qu'il est arrêté et
qu'Hexanode ne relaie pas ce nom). Avec Node sur le serveur :
```sh
cd $R/BCWEB && node infra/caddy/site.mjs add service --domain bettervault.bettercommunity.ch --to bettervault:8787 --yes
```
Sans Node, à la main (même contenu que `templates/service.caddy`), puis recréer Caddy :
```sh
cd $R/BCWEB/infra/caddy
cat > sites.d/bettervault-bettercommunity-ch.caddy <<'EOF'
http://bettervault.bettercommunity.ch {
	encode gzip zstd
	header -Server
	reverse_proxy bettervault:8787 {
		header_up Cookie "(^|;\s*)(bcw_session|bcw_elevated|tele_session)=[^;]*" ""
	}
}
EOF
cd $C && docker compose up -d caddy && docker compose logs caddy 2>&1 | grep bcweb-caddy | tail -1
```
Le conteneur BetterVault doit être sur le réseau `bcweb_default` (c'était le cas). `sites.d/` est
ignoré par git : le fichier survit aux `git pull` et ne bloque pas `deploy.sh`.

**6.9 Nettoyer** — seulement après l'étape 7 réussie :
```sh
docker rm -f bcweb-minio-old && docker rm bcweb-minio-1
```
Garde le volume `bcweb_minio-data` et `minio-avant-2026-10-07.tar.gz` plusieurs semaines. Les
supprimer est une décision à part.

## 7. Vérifications

Dans un navigateur, sur `https://bettercommunity.ch` :

- [ ] la page d'accueil s'affiche ; `/api/health` répond ;
- [ ] connexion avec un compte normal, déconnexion, reconnexion ;
- [ ] `/admin` avec ton compte admin : la 2FA est demandée et passe ;
- [ ] une image de blog et un avatar s'affichent (stockage lu) ;
- [ ] le téléchargement d'un fichier de catalogue ou de repo hébergé fonctionne ;
- [ ] un envoi (image de blog, fichier) — **seulement une fois `s3.` déclaré chez Hexanode** ;
      avant, l'envoi échoue côté navigateur (normal, voir l'étape 9) ;
- [ ] **Admin → Server perf** : stockage objet en service ;
- [ ] `https://telemetry.bettercommunity.ch` : le tableau de bord s'ouvre avec ta session ;
- [ ] BMM envoie encore de la télémétrie (un lancement de BMM, puis le compteur du jour) ;
- [ ] le bot Discord répond à une commande, et `docker compose logs --tail 20 bot` n'a pas
      d'erreur d'authentification ;
- [ ] un mail (réinitialisation de mot de passe) arrive, avec un lien en `https://` ;
- [ ] avec `TRUSTED_PROXIES` : dans **Admin → journal d'audit**, ta connexion porte ton adresse
      publique, pas celle du relais.

Puis rouvre le CD si tu t'en sers : `rm /srv/BetterCommunity/deploy-gate.disabled`.

### Retour arrière complet

Avant 6.9 (MinIO intact) :

```sh
cd $C
docker compose stop
git -C $R checkout 883b9358
git -C $R apply ~/server-local-2026-10-07.patch
cp ~/backups/env-avant-2026-10-07 .env
cp ~/backups/override-optionB-2026-10-07.yml docker-compose.override.yml
docker rm -f bcweb-minio-old 2>/dev/null
docker compose up -d --build
```

L'ancien code tourne alors sur un schéma de base migré. Si l'API ancienne ne démarre pas
(migration incompatible), restaure le dump — **cela efface tout ce qui a été écrit depuis
l'étape 1** :

```sh
docker compose stop api provisioner bot
docker exec -i bcweb-db-1 sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < ~/backups/bcweb-db-2026-10-07.dump
docker compose up -d
```

Pour repartir ensuite vers la nouvelle version : `git -C $R checkout -- . && git -C $R checkout master`.

## 8. `bmm-repo-nginx` et `bmm-repo-filebrowser`

Deux conteneurs faits à la main, hors compose, publiés sur toutes les interfaces :
`0.0.0.0:8081` (nginx, les repos BMM) et `0.0.0.0:8082` (filebrowser, son interface d'admin).
Tout port publié du LXC est joignable depuis le **réseau de la maison**, et depuis internet
**seulement si Hexanode relaie ce port** : regarde dans le panneau Hexanode quels ports sont
relayés (normalement 80 et 443 seulement).

**Est-ce que des repos BMM utilisent :8081 ?** En lecture seule :

```sh
docker inspect -f '{{.Config.Image}} | {{.HostConfig.RestartPolicy.Name}} | {{json .Mounts}} | {{json .HostConfig.PortBindings}} | {{json .NetworkSettings.Networks}}' bmm-repo-nginx bmm-repo-filebrowser
docker logs --since 168h bmm-repo-nginx 2>&1 | awk '{print $1}' | sort | uniq -c | sort -rn | head
docker logs --since 168h bmm-repo-nginx 2>&1 | tail -5
```

Les journaux nginx disent qui l'appelle encore : des requêtes récentes venant d'autres adresses
que ton PC = des utilisateurs BMM l'utilisent. Dans BMM, l'adresse d'un repo est dans la liste
des repos (*Repos*) : une URL en `http://45.145.164.20:8081/…` ou `http://bmm.bettercommunity.ch:8081/…`
passe par ce port, et ne fonctionne de l'extérieur que si Hexanode relaie 8081. Si personne ne
s'en sert, le passer en local (comme 8082 ci-dessous) ne casse rien.

Pour le garder public proprement : un nom (`bmm.bettercommunity.ch`) déclaré chez Hexanode
(étape 9), servi par Caddy en `http://` :
`docker network connect bcweb_default bmm-repo-nginx` puis
`node infra/caddy/site.mjs add service --domain bmm.bettercommunity.ch --to bmm-repo-nginx:80 --yes`
(ou le fichier `sites.d/` écrit à la main comme en 6.8). Les repos BMM changent alors d'adresse
pour `https://bmm.bettercommunity.ch/…`.

**Fermer 8082 au réseau** (filebrowser est une interface d'administration de fichiers : elle n'a
rien à faire hors du serveur). Docker ne change pas les ports d'un conteneur existant : il faut
le recréer à l'identique, avec `-p 127.0.0.1:8082:80`. Envoie-moi la sortie de :

```sh
docker inspect -f 'image={{.Config.Image}}
cmd={{json .Config.Cmd}}
entrypoint={{json .Config.Entrypoint}}
restart={{.HostConfig.RestartPolicy.Name}}
user={{.Config.User}}
mounts={{range .Mounts}}{{.Type}}:{{if .Name}}{{.Name}}{{else}}{{.Source}}{{end}}:{{.Destination}}:{{.RW}} {{end}}
networks={{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}
envnames={{range .Config.Env}}{{.}}|{{end}}' bmm-repo-filebrowser
```

(retire d'abord de la ligne `envnames` toute valeur qui ressemble à un mot de passe). La
commande de recréation a cette forme :

```sh
docker stop bmm-repo-filebrowser && docker rename bmm-repo-filebrowser bmm-repo-filebrowser-old
docker run -d --name bmm-repo-filebrowser --restart <restart> -p 127.0.0.1:8082:80 \
  -v <source>:<destination> [-v …] [-e …] [--user <user>] <image> [cmd]
```

**Attention :** filebrowser garde ses comptes et réglages dans une base (`filebrowser.db`,
souvent `/database/filebrowser.db` ou `/database.db`). Si cette base **n'est pas** dans un des
`mounts`, elle vit dans le conteneur et serait perdue : copie-la d'abord,
`docker cp bmm-repo-filebrowser:/database.db ~/backups/` (chemin selon l'image), et monte-la dans
le nouveau.

**Vérifier :** `docker ps --format '{{.Names}}\t{{.Ports}}' | grep filebrowser` →
`127.0.0.1:8082->80/tcp`. Pour l'utiliser depuis ton PC :
`ssh -p 2222 -L 8082:127.0.0.1:8082 freeproject@192.168.1.56` puis `http://localhost:8082`.
Ensuite `docker rm bmm-repo-filebrowser-old`.
**Retour arrière :** `docker rm -f bmm-repo-filebrowser && docker rename bmm-repo-filebrowser-old bmm-repo-filebrowser && docker start bmm-repo-filebrowser`.

## 9. Hexanode : les noms relayés

C'est Hexanode qui détient le HTTPS et la liste des noms acceptés ; Caddy ne voit que ce
qu'Hexanode lui transmet. Pour chaque nouveau nom :

1. Dans le **panneau client Hexanode** (ou par leur support si le panneau ne le permet pas),
   ajoute le nom avec **la même cible que `bettercommunity.ch`** (le même service / la même
   destination vers chez toi, port 80 en HTTP). Hexanode s'occupe du certificat.
2. L'enregistrement DNS `A` vers 45.145.164.20 existe déjà pour `s3.`, `bettervault.`, `bmm.`,
   `bmm-admin.`, `telemetry.`.
3. Côté serveur : le nom doit exister en `http://` chez Caddy — `S3_DOMAIN` pour `s3.`, un
   fichier `sites.d/` pour les autres (6.8, 8). Sinon Caddy répond un 200 vide.

Dans l'ordre :

- **`s3.bettercommunity.ch` — maintenant.** Les URL de fichiers signées pointent dessus.
  Demande aussi à Hexanode sa **limite de taille de requête** (corps d'un envoi) et son
  **délai d'attente** : un envoi plus gros que la limite échoue chez eux, avant le serveur. Il
  faut au moins la taille du plus gros fichier qu'un utilisateur peut envoyer (repos, catalogues).
  Le relais doit **garder l'en-tête `Host`** tel quel : la signature S3 couvre le nom, un `Host`
  réécrit donne `403 SignatureDoesNotMatch`. Test une fois en place :
  `wget -S -O /dev/null https://s3.bettercommunity.ch/ 2>&1 | head -3` → `403` (normal : la
  racine du stockage n'est pas publique), et surtout plus de `502` ni d'erreur TLS.
- **`bettervault.`** — quand BetterVault redémarre (6.8).
- **`bmm.`** — seulement si tu gardes le serveur de repos BMM public (étape 8). **Pas
  `bmm-admin.`** : filebrowser reste en local.

Ce que le relais doit envoyer au LXC : uniquement le **port 80** (HTTP, il fait le HTTPS
lui-même). Aucun autre port (8081, 8082, 9000, 3000…) n'a à être relayé ; vérifie-le dans le
panneau. Caddy publie aussi 443, inutile ici mais sans danger tant que rien ne le relaie.

Pour `TRUSTED_PROXIES` : l'adresse à mettre est celle que montre l'étape 0 (d'où arrivent les
connexions au port 80). Si Hexanode n'envoie pas d'en-tête `X-Forwarded-For`, la valeur ne
change rien (Caddy garde l'adresse du relais) : demande-leur s'ils le transmettent.
