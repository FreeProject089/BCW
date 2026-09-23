# D'autres sites et applications sur le même serveur

*🇬🇧 [English version](CADDY_SITES_EN.md).*

Vous avez un autre projet qui doit répondre sur votre domaine — `shop.example.com`,
`docs.example.com`, `example.com/status` — en vrai HTTPS, sur les ports habituels 80 et 443,
sur le même serveur que BetterCommunity. Ce guide explique comment, sans toucher à la partie
BetterCommunity de la config Caddy, et sans qu'une faute de frappe fasse tomber tous les sites.

**En bref :** un enregistrement DNS, une commande.

```sh
node infra/caddy/site.mjs add host --domain shop.example.com --port 8081
```

La commande écrit un fichier, fait vérifier **toute** la config par Caddy lui-même, vous
montre ce qui change, et seulement ensuite recharge Caddy. Si Caddy refusait la config, rien
n'est installé et les sites continuent de tourner.

---

## Comment les pièces s'emboîtent

| Pièce | Ce que c'est | Qui la modifie |
|---|---|---|
| `infra/caddy/Caddyfile` | la config de BetterCommunity. Importe les deux dossiers ci-dessous. | personne, pour ajouter un site |
| `infra/caddy/sites.d/` | un fichier par (sous-)domaine supplémentaire | vous, ou `site.mjs add` |
| `infra/caddy/paths.d/` | un fichier par application montée sur un chemin du domaine principal | vous, ou `site.mjs add path` |
| `infra/caddy/templates/` | un modèle commenté par cas ci-dessous | — |
| `infra/caddy/live/Caddyfile` | LE fichier que Caddy exécute : la base avec chaque fichier des dossiers collé dedans. Généré. | `site.mjs apply` uniquement |
| `infra/caddy/backups/` | le fichier live précédent, avant chaque changement (les 20 derniers) | `site.mjs` |
| `infra/caddy/entrypoint.sh` | choisit la config avec laquelle Caddy démarre (voir [Au redémarrage](#au-redémarrage)) | — |

Les dossiers sont la **source de vérité** ; le fichier live est un **produit**, régénéré à
partir d'eux. C'est ce qui permet de le régénérer à tout moment, de le lire, et de
l'installer soit automatiquement, soit à la main.

`sites.d/`, `paths.d/`, `static/`, `live/` et `backups/` appartiennent à un serveur et sont
ignorés par git (`infra/caddy/.gitignore`) : un `git pull` n'y touche jamais.

**Le HTTPS, c'est le travail de Caddy, comme déjà pour le site principal.** Caddy écoute sur
80 et 443, obtient un certificat Let's Encrypt pour chaque nom au premier chargement de la
config, et le renouvelle. Il n'y a rien à configurer en dehors de l'enregistrement DNS.

---

## Une seule fois : laisser Caddy voir le dossier

Aujourd'hui compose ne monte **que** le `Caddyfile` de base dans le conteneur : Caddy ne voit
ni `sites.d/`, ni `live/`, ni `static/`. Deux lignes dans le service `caddy` de
`infra/compose/docker-compose.yml` :

```yaml
  caddy:
    image: caddy:2-alpine
    command: ["sh", "/etc/caddy/entrypoint.sh"]      # ← à ajouter
    # …
    volumes:
      - ../caddy:/etc/caddy:ro                         # ← remplace ../caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
```

Gardez `extra_hosts: - "host.docker.internal:host-gateway"` — le cas « hôte » en a besoin.
Puis, une fois (quelques secondes de coupure) :

```sh
cd infra/compose
docker compose up -d caddy
node ../caddy/site.mjs status        # « infra/caddy/ is mounted as a folder »
```

Deux bénéfices au passage. Un montage de dossier voit un fichier que `git pull` a
**remplacé** (un montage de fichier seul continue de montrer l'ancien tant que le conteneur
n'est pas recréé), et le script de démarrage empêche un seul mauvais fichier de faire tomber
la plateforme.

Tant que ce n'est pas fait, `site.mjs add … --no-apply`, `build` et `diff` fonctionnent, et
`apply` refuse en affichant ces mêmes lignes.

---

## Ajouter un site en trois étapes

1. **DNS.** Chez votre fournisseur DNS, un enregistrement `A` pour le nom → l'IPv4 publique du
   serveur (plus `AAAA` → son IPv6 s'il en a une). Même serveur que BetterCommunity, même IP.
2. **Faire tourner l'autre projet sur son propre port** — n'importe lequel sauf 80 et 443
   (voir plus bas).
3. **`node infra/caddy/site.mjs add <cas> …`** avec le cas de ce tableau.

| Cas | Commande | Enregistrement DNS |
|---|---|---|
| un programme sur cette machine, sur un port qu'il utilise déjà | `add host --domain shop.example.com --port 8081` | `A shop.example.com` → IP du serveur |
| un conteneur sur le réseau Docker de la stack | `add service --domain app.example.com --to myapp:3000` | `A app.example.com` → IP du serveur |
| une application sur un chemin du domaine principal | `add path --path /status --to myapp:3000` (ou `--port 8081`) | aucun — c'est le nom du site |
| un dossier de fichiers statiques | `add static --domain docs.example.com --dir docs [--spa]` | `A docs.example.com` → IP du serveur |
| `www.` (ou un ancien nom) → le domaine principal | `add redirect --domain www.example.com --to https://example.com` | `A www.example.com` → IP du serveur |

Lancée sans options, la commande pose chaque question à la place. Autres options : `--name`
(nom du fichier), `--force` (remplacer), `--no-apply` (écrire et valider seulement),
`--dry-run` (afficher le fichier), `--yes` (pas de confirmation — obligatoire depuis un
script). `--http` sert en HTTP simple, pour des tests locaux sur des noms `*.localhost`
uniquement.

Après l'application, la commande vérifie aussi les deux choses qui cassent ensuite : si le
nom résout (et vers quoi), et si Caddy joint vraiment le programme derrière.

### « Il doit utiliser les ports 80 et 443 »

C'est le cas — à travers Caddy. Un seul programme par machine peut écouter sur le port 443, et
ici c'est Caddy. Les visiteurs arrivent toujours sur `https://shop.example.com` en 443 ;
Caddy termine le HTTPS et transmet au programme sur son propre port. Seul le port **du
programme** change :

- un programme qui veut 80/443 par défaut (un autre nginx, un autre Caddy, une appli Node avec
  `PORT=80`) : donnez-lui un autre port, par ex. 8081, et utilisez le cas `host` ;
- un autre projet `docker compose` qui publie `"80:80"` / `"443:443"` : retirez ces lignes
  `ports:` — ou changez-les en `"127.0.0.1:8081:80"` et utilisez le cas `host` — ou, mieux, ne
  publiez rien et rejoignez le réseau de cette stack (section suivante) ;
- un programme qui fait son propre HTTPS : coupez-le et laissez-le parler HTTP simple sur son
  port — Caddy fait le HTTPS. Relayer vers le HTTPS d'un programme (`reverse_proxy https://…`)
  est possible, mais demande des réglages de certificat que ni ce guide ni les modèles ne
  couvrent.

### Un autre projet compose sur le même réseau

L'option la plus propre pour un projet conteneurisé : aucun port sur l'hôte, donc aucun
conflit possible. Dans le compose de **ce** projet :

```yaml
services:
  myapp:
    # pas besoin de `ports:`
    networks: [default, bcweb]
networks:
  bcweb:
    external: true
    name: bcweb_default
```

puis `add service --domain app.example.com --to myapp:3000` — `3000` étant le port sur lequel
le programme écoute **dans** son conteneur. (`bcweb_default` est le réseau de cette stack :
compose le nomme d'après `name: bcweb`.)

### Une application sur un chemin — à lire d'abord

`example.com/status` partage l'**origine** de BetterCommunity. Son JavaScript peut appeler
`/api` avec la session du visiteur : une faille dans cette application est une faille dans
BetterCommunity. Elle hérite aussi des en-têtes de sécurité du site, Content-Security-Policy
comprise, et doit être construite pour un chemin de base (une application qui pointe vers
`/style.css` reçoit celui de BetterCommunity). La CLI refuse les chemins que le site route
déjà (`/api`, `/hosting`, `/oauth2`, `/.well-known`, …), mais pas les pages du site : un
chemin qui est aussi une page de BetterCommunity (`/blog`) remplace cette page. Un
sous-domaine n'a aucun de ces problèmes — préférez-le.

---

## Régénérer, puis remplacer : automatiquement ou à la main

Tout passe par la même porte : **générer → valider avec Caddy → montrer le diff →
sauvegarder → remplacer → recharger**. Une config que Caddy refuse n'est jamais installée.

| Je veux… | Commande |
|---|---|
| voir ce qui changerait | `node infra/caddy/site.mjs diff` (code de sortie 1 s'il y a une différence) |
| régénérer et installer, automatiquement | `node infra/caddy/site.mjs apply` (demande ; `--yes` pour ne pas demander) |
| régénérer dans un fichier que je lis d'abord | `node infra/caddy/site.mjs build --out review/Caddyfile` |
| installer ce fichier relu, avec sauvegarde | `node infra/caddy/site.mjs apply --from review/Caddyfile` |
| …ou le mettre en place moi-même | le copier sur `infra/caddy/live/Caddyfile`, puis `node infra/caddy/site.mjs reload` |
| annuler le dernier changement | `node infra/caddy/site.mjs rollback` (`rollback list`, `rollback <nom>`) |
| voir chaque site en plus et s'il est actif | `node infra/caddy/site.mjs list` |
| en couper un | `node infra/caddy/site.mjs remove shop-example-com` (renommé en `.caddy.off`, conservé) |
| savoir où on en est | `node infra/caddy/site.mjs status` |

- **Remplacement manuel** : `reload` valide le fichier installé avant de recharger et refuse
  un fichier invalide — ne le contournez pas en appelant `caddy reload` directement.
- **Modifier à la main** : ouvrez le fichier dans `sites.d/` (ou copiez-y un modèle et
  remplacez ses `__PLACEHOLDERS__`), puis `apply`. Ne modifiez jamais `live/Caddyfile` : le
  prochain apply le réécrit.
- **Après un `git pull`** qui a modifié le `Caddyfile` de base, le fichier live ne change pas
  tout seul — c'est tout l'intérêt de le relire. `status` signale que les sources ont bougé ;
  `diff` montre comment ; `apply` l'installe.
- **Rollback** restaure ce que Caddy exécute, pas vos sources. Si le changement venait d'un
  fichier de `sites.d/`, corrigez-le ou retirez-le (`remove`), sinon le prochain `apply` le
  remet.
- Une erreur de Caddy désigne la ligne **de votre fichier** : `…Caddyfile.next:521 (=
  infra/caddy/sites.d/shop-example-com.caddy line 24)`.

La validation lance `caddy validate` dans le service caddy de la stack (`docker compose run`),
donc avec votre vrai `.env` — un second bloc pour votre domaine principal, par exemple, est
détecté. Sur le serveur, il suffit de Node 18+ et de la CLI docker.

### Au redémarrage

`entrypoint.sh` démarre Caddy sur la **première** de ces configs qui est valide, et journalise
son choix :

1. `live/Caddyfile` (le fichier généré, dès qu'un apply a eu lieu) ;
2. le `Caddyfile` de base avec `sites.d/` et `paths.d/` ;
3. la base seule — BetterCommunity continue de tourner, seuls les sites en plus manquent.

```sh
docker compose logs caddy | grep bcweb-caddy
```

Un `WARNING` à cet endroit signifie qu'un fichier a été modifié à la main en quelque chose que
Caddy refuse : corrigez-le, puis `site.mjs apply`.

---

## Sécurité, en bref

- **Les cookies de session sont retirés.** En production, les cookies de BetterCommunity
  sont posés sur le domaine parent (`COOKIE_DOMAIN=.example.com`) pour que le sous-domaine de
  télémétrie les lise — donc chaque sous-domaine les reçoit. Les modèles `service`, `host` et
  `path` retirent `bcw_session`, `bcw_elevated` et `tele_session` avant que la requête
  n'atteigne l'autre application. Si vous écrivez un fichier à la main, gardez cette ligne
  `header_up Cookie`.
- **Ce que ce retrait n'empêche pas** : une application sur un sous-domaine peut toujours
  *poser* un cookie pour le domaine parent. Ne mettez sur un sous-domaine du domaine de
  BetterCommunity que des logiciels de confiance ; l'application d'un tiers va sur un autre
  domaine.
- **HSTS couvre tous les sous-domaines.** Le site envoie `includeSubDomains` : un navigateur
  qui l'a visité n'utilisera plus que HTTPS pour tout `*.example.com`. Chaque site créé ici est
  en HTTPS, donc aucun souci — mais un sous-domaine servi par un **autre** serveur doit aussi
  être en HTTPS.
- La CLI n'accepte qu'un alphabet strict dans chaque valeur (noms d'hôte, `nom:port`,
  chemins, une origine pour les redirections) : rien de ce qu'on tape ne peut ouvrir une
  directive ou un bloc à soi.

---

## Dépannage

**Le certificat n'est pas délivré** (alerte du navigateur, `docker compose logs caddy` montre
`obtaining certificate … error`) :
- le nom ne résout pas encore vers **ce** serveur : `nslookup shop.example.com`. La CLI
  affiche vers quoi il résout après un add. La propagation DNS prend de quelques minutes à
  quelques heures ;
- le port 80 ou 443 est fermé depuis internet (pare-feu du fournisseur, `ufw`) — Let's
  Encrypt doit joindre le port 80 ou 443 de ce serveur ;
- un enregistrement `CAA` qui n'autorise pas `letsencrypt.org` (voir [Domaine & HTTPS](DOMAIN_SETUP_FR.md)) ;
- le nom passe par un CDN (le « nuage orange » de Cloudflare) : mettez-le en DNS seul le temps
  de la délivrance ;
- trop de tentatives : Let's Encrypt limite les échecs. Corrigez la cause et attendez — Caddy
  réessaie tout seul.

**« Port déjà utilisé »** (`bind: address already in use` / `port is already allocated`) :
- au démarrage du conteneur caddy → un autre programme tient 80 ou 443. Trouvez-le avec
  `sudo ss -ltnp 'sport = :443'`, déplacez-le sur un autre port, et ajoutez-le avec le cas
  `host` ;
- au démarrage de l'**autre** projet → il essaie de publier 80/443 lui-même : voir
  [« Il doit utiliser les ports 80 et 443 »](#-il-doit-utiliser-les-ports-80-et-443-).

**502 Bad Gateway** — Caddy va bien, c'est le programme derrière qui n'a pas répondu. `add` le
vérifie et affiche la raison donnée par Caddy ; pour revérifier plus tard :
`docker compose exec caddy wget -O /dev/null http://host.docker.internal:8081/`.
- `Connection refused` sur un site `host` : le programme ne tourne pas, est sur un autre port,
  ou n'écoute que sur `127.0.0.1`. Depuis Docker sous Linux, l'hôte est l'adresse du pont
  Docker, pas `127.0.0.1` : faites écouter le programme sur `0.0.0.0` (port fermé dans le
  pare-feu) ou sur l'adresse du pont (`ip -4 addr show docker0`, souvent `172.17.0.1`) ;
- même chose avec `ufw` actif : laissez entrer les réseaux Docker —
  `sudo ufw allow from 172.16.0.0/12 to any port 8081 proto tcp` ;
- `bad address 'myapp'` sur un site `service` : aucun conteneur de ce nom sur le réseau de
  Caddy — tourne-t-il, et a-t-il rejoint `bcweb_default` ?
- le port après `:` est celui **dans** le conteneur, pas le port publié.

**Une page vide avec le statut 200** — le nom arrive à Caddy mais aucun bloc ne le réclame :
le site n'a jamais été appliqué (`site.mjs list` indique « pending apply »), ou le DNS pointe
ici pour un nom que vous n'avez jamais ajouté.

**Une boucle de redirection sur une application montée sur un chemin** — un fichier
`paths.d/` écrit à la main sans la ligne `vars … bc_mount yes` : la règle du slash final du
site et l'application se disputent `/status/`. Repartez de `templates/path.caddy`.

**`apply` dit que le conteneur ne voit pas infra/caddy/** — le changement compose de
[Une seule fois](#une-seule-fois--laisser-caddy-voir-le-dossier) n'est pas en place (ou le
conteneur n'a pas été recréé).

**Git Bash sous Windows transforme `--path /status` en `C:/Program Files/Git/status`** —
écrivez `--path status` ; la CLI ajoute le slash.
