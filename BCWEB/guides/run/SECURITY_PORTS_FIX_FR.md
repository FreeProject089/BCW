# Correctif : ports publiés sur toutes les interfaces (octobre 2026)

Procédure à faire **sur le serveur de production**, par le propriétaire. Rien ici ne se lance
depuis le poste de développement.

## Le constat (`docker ps` du 2026-10-06)

| Conteneur | Publié sur `0.0.0.0` / `[::]` | Risque | Cause |
| --- | --- | --- | --- |
| `bcweb-api-1..3` | `3003-3005 → 3000` | l'API sans Caddy : ni en-têtes de sécurité, ni anti-bot, ni blocage de `/api/domains/ask`, et un `X-Forwarded-For` écrit par le client cru pour les limites de débit, les bannissements et l'audit | le serveur tourne avec un compose **antérieur au 2026-09-24** (`"3000-3009:3000"`) |
| `bcweb-minio-1` | `9000`, `9001` | l'API S3 en direct et la **console d'administration MinIO** ouverte aux essais de mots de passe | même compose ancien (`"9000:9000", "9001:9001"`) ; le service `minio` n'existe plus dans le code depuis le 2026-09-25 |
| `bcweb-caddy-1` | `5176` (en plus de 80/443) | un port de développement ouvert sans raison | `"5176:5176"` dans le compose, corrigé par ce commit |
| `bmm-repo-nginx` | `8081` | dépôt BMM servi hors de Caddy (pas de HTTPS) | **hors du dépôt** : conteneur lancé à la main sur le serveur |
| `bmm-repo-filebrowser` | `8082` | une interface de gestion de fichiers sur Internet | **hors du dépôt** : idem |

Aucun pare-feu ne rattrape ça : Docker écrit ses propres règles iptables pour les ports publiés,
avant celles d'un éventuel ufw, et un LXC Alpine n'a pas d'ufw. **C'est l'adresse `127.0.0.1` dans
le compose qui protège.** Le code corrige maintenant 3000-3009, 9000 (et supprime la console 9001)
depuis le 2026-09-24, et 5176 depuis ce commit ; la CI échoue désormais si un fichier compose publie
autre chose que le 80/443 de Caddy (`infra/check-published-ports.mjs`).

## 0. Regarder avant de toucher (lecture seule)

```sh
cd /srv/BetterCommunity/BCW
git log -1 --format='%h %ad %s' --date=short     # le commit qui tourne
git status --short                               # modifications locales du serveur
docker compose version                           # il faut >= 2.24.4 pour l'option B
cd BCWEB/infra/compose
cat docker-compose.override.yml 2>/dev/null      # existe-t-il déjà ?
grep -E '^(SITE_DOMAIN|S3_DOMAIN|S3_PUBLIC_ENDPOINT|API_REPLICAS)=' .env
docker ps --format '{{.Names}} {{.Ports}}'
```

**Vérifie `S3_PUBLIC_ENDPOINT` avant tout.** Il doit valoir `https://s3.bettercommunity.ch` (et
`S3_DOMAIN=s3.bettercommunity.ch`) : les navigateurs envoient les fichiers à cette adresse, que
Caddy relaie au stockage. S'il pointe sur `http://…:9000`, fermer le 9000 casse les envois :
corrige d'abord ces deux lignes dans `.env`, puis `docker compose up -d caddy api`.

## Option A (la vraie correction) : déployer le code actuel

C'est le « premier déploiement après septembre 2026 » de [DEPLOY_FR.md](DEPLOY_FR.md) §9 (fin de
section, interrupteur de CD coupé) suivi de **Quitter MinIO** (même guide) : mise à jour de `.env`
(liste des variables : [UPGRADE_2026-10_FR.md](UPGRADE_2026-10_FR.md) §4), copie des objets MinIO vers `storage`, puis
`infra/deploy.sh`. Le site est coupé pendant la copie. Points propres à ce correctif :

- l'ancien conteneur `bcweb-minio-1` devient orphelin et **garde** `0.0.0.0:9000` tant qu'il tourne :
  le nouveau `storage` ne pourra pas prendre `127.0.0.1:9000` avant l'étape 3 de *Quitter MinIO*
  (`docker stop bcweb-minio-1`). Ne lance pas `--remove-orphans` avant l'étape 8 ;
- si tu as appliqué l'option B, **retire d'abord** ses lignes de `docker-compose.override.yml` (la
  clé `minio:` ferait échouer compose : un service sans image). Depuis octobre 2026 `extra_hosts` est
  dans le compose suivi : le fichier override peut être supprimé.

## Option B (mitigation immédiate, 5 minutes, sans migration)

Si l'option A ne peut pas être faite aujourd'hui. Ne change pas le code qui tourne : un fichier
`docker-compose.override.yml` (lu automatiquement par `docker compose` dans ce dossier) remplace
les ports. S'il existe déjà, **garde son contenu** et ajoute les clés ci-dessous dans les services
correspondants.

```sh
cd /srv/BetterCommunity/BCW/BCWEB/infra/compose
if [ -e docker-compose.override.yml ]; then
  cp -a docker-compose.override.yml docker-compose.override.yml.bak
  echo "il existe déjà : ajoute les clés ports à la main (un seul services:)"
else
  cat > docker-compose.override.yml <<'EOF'
services:
  api:
    ports: !override ["127.0.0.1:3000-3009:3000"]
  minio:
    ports: !override ["127.0.0.1:9000:9000", "127.0.0.1:9001:9001"]
  caddy:
    ports: !override ["80:80", "443:443"]
EOF
fi
docker compose config --quiet && docker compose config | grep -E 'host_ip|published'
docker compose up -d api minio caddy
```

`!override` remplace la liste au lieu de l'allonger ; sans lui, compose **ajoute** les
ports et rien ne se ferme. Compose plus ancien que 2.24.4 : édite plutôt `docker-compose.yml`
sur le serveur aux trois lignes `ports:` (préfixe `127.0.0.1:`, retire `"5176:5176"`) ; l'option A
remettra ce fichier propre (`git checkout`).

`API_REPLICAS` dans `.env` garde le nombre de répliques de l'API ; vérifie qu'il y en a toujours
trois après le `up -d`.

## Vérifier (sur le serveur)

```sh
docker ps --format '{{.Names}} {{.Ports}}'
#  attendu : 0.0.0.0/[::] UNIQUEMENT sur 80 et 443 (bcweb-caddy-1) ;
#  api, storage/minio, db en 127.0.0.1:… ; plus aucun 5176 public, plus de 9001 avec l'option A
docker compose ps                                   # tout « healthy »
P=$(docker compose port --index 1 api 3000 | cut -d: -f2)
wget -q -O - "http://127.0.0.1:$P/ready"            # la sonde locale répond toujours
wget -q -O /dev/null -S https://bettercommunity.ch/ 2>&1 | head -1
```

Puis dans le navigateur : ouvrir une image de blog, télécharger un fichier de catalogue, **envoyer**
un fichier (c'est l'envoi qui passe par `s3.bettercommunity.ch`). Et depuis une machine **extérieure**
(ton PC, pas le serveur) : `nc -zv 45.145.164.20 3003`, puis 3000, 5176, 8081, 8082, 9000, 9001 —
chacun doit échouer (« refused » ou délai dépassé). Même test en IPv6 si le serveur en a une.

À noter : l'API avait les ports 3003-3005, pas 3000. `infra/deploy.sh` sonde
`http://127.0.0.1:3000/ready` par défaut : regarde ce qui tient 3000-3002
(`netstat -tlnp | grep ':300'`) ; si c'est autre chose que l'API, lance le script avec
`READY_URL=http://127.0.0.1:<port>/ready`.

## `bmm-repo-nginx` (8081) et `bmm-repo-filebrowser` (8082)

Ils ne sont définis nulle part dans BCW ni dans BetterModsManager : ils ont été créés à la main.
D'abord savoir d'où ils viennent :

```sh
for c in bmm-repo-nginx bmm-repo-filebrowser; do
  docker inspect -f '{{.Name}} {{index .Config.Labels "com.docker.compose.project.working_dir"}} {{json .HostConfig.PortBindings}} {{json .Mounts}}' "$c"
done
grep -rn -E '808[12]|bmm-repo' /srv/BetterCommunity/BCW/BCWEB/infra/caddy/sites.d /srv/BetterCommunity/BCW/BCWEB/infra/caddy/paths.d
```

- **filebrowser** est une interface d'administration : jamais sur Internet. Publie-le sur
  `127.0.0.1:8082` seulement et accède-y par tunnel SSH :
  `ssh -L 8082:127.0.0.1:8082 -p 2222 <user>@45.145.164.20`, puis `http://localhost:8082`.
- **nginx** (le dépôt BMM) : s'il doit être public, fais-le passer par Caddy (HTTPS, en-têtes) au
  lieu d'un port. Mets le conteneur sur le réseau de la stack et retire son port publié :
  `docker network connect bcweb_default bmm-repo-nginx`, puis
  `node infra/caddy/site.mjs add service --domain <nom>.bettercommunity.ch --to bmm-repo-nginx:<port interne>`
  (le port **dans** le conteneur, souvent 80 : voir `PortBindings` ci-dessus), et un enregistrement
  DNS `A` pour ce nom. Détails : [CADDY_SITES_FR.md](CADDY_SITES_FR.md), « Un autre projet compose ».
  Attention : si un fichier de `sites.d/` le joint aujourd'hui par `host.docker.internal:8081`,
  le lier à `127.0.0.1` casserait ce site (depuis Docker, l'hôte n'est pas `127.0.0.1`) : passe
  d'abord au cas `service`.
- Pour changer les ports : s'ils viennent d'un compose (`working_dir` non vide), édite son `ports:`
  (`"127.0.0.1:8082:80"`, ou supprime-le pour nginx derrière Caddy) puis `docker compose up -d` dans
  ce dossier. S'ils viennent d'un `docker run`, recrée-les avec les mêmes volumes et variables
  (`docker inspect` ci-dessus) et `-p 127.0.0.1:8082:80` (ou sans `-p`).

## Pare-feu Proxmox / hébergeur (en plus, pas à la place)

- **Proxmox** : le pare-feu ne filtre rien tant qu'il n'est pas activé au niveau
  *Datacenter → Firewall → Options*. Puis sur le CT : *Firewall → Options* : `Enable`, *Input
  Policy* `DROP` ; règles `ACCEPT` : TCP 80, TCP 443, UDP 443, TCP 2222 (SSH, idéalement depuis
  ton IP seulement). Coche aussi `Firewall` sur l'interface réseau du CT (*Network → net0*).
  Les règles valent pour IPv4 et IPv6. Garde une session SSH ouverte pendant le changement.
- **Hébergeur** (si tu n'as pas la main sur Proxmox) : demande ou règle dans son panneau
  le même filtrage entrant (22/2222, 80, 443).
- **Dans le LXC** (facultatif) : la chaîne iptables `DOCKER-USER` est la seule que Docker
  respecte pour les ports publiés. Si tu l'utilises, filtre sur le port d'origine
  (`-m conntrack --ctorigdstport`), pas sur `--dport` qui est déjà traduit vers le conteneur.

## Revenir en arrière

- **Option B** : `cp docker-compose.override.yml.bak docker-compose.override.yml` (ou supprime le
  fichier s'il n'existait pas), puis `docker compose up -d api minio caddy`.
- **Option A** : `infra/deploy.sh` revient seul au commit précédent si `/ready` ne répond pas ;
  sinon `infra/rollback.sh`. Pour le stockage, « Revenir en arrière » de *Quitter MinIO* dans
  [DEPLOY_FR.md](DEPLOY_FR.md) (le volume MinIO n'est jamais modifié).
- Rouvrir un port n'est **jamais** la bonne réponse à une panne : si une sonde ou un outil ne
  marche plus, il doit utiliser `127.0.0.1` ou un tunnel SSH.
