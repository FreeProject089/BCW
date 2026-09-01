# Déploiement sans coupure — `infra/zdd.sh`

`infra/deploy.sh` est sûr (sauvegarde, vérification, retour arrière) et il est **coupé
pendant qu'il travaille** : `docker compose up -d --build` arrête les anciens conteneurs api
et web avant que les nouveaux ne servent. Sur un site calme, ce trou dure quelques secondes ;
pendant, chaque requête est un 502.

`infra/zdd.sh` ferme le trou : pour chaque service qu'un visiteur regarde, il **démarre le
nouveau conteneur à côté de l'ancien**, attend que Docker le déclare sain, et seulement alors
retire l'ancien. À aucun moment le site n'a zéro conteneur qui sert.

```bash
infra/zdd.sh                # sauvegarde, pull, build, roule api+web, rafraîchit le reste
infra/zdd.sh --no-pull      # déploie l'arbre de travail tel quel
infra/zdd.sh --no-backup    # vous avez un dump d'il y a quelques minutes
infra/zdd.sh --dry-run      # imprime le plan, ne change rien
```

## Pourquoi le passage de relais est invisible

Trois pièces, et le script ne fonctionne que parce que les trois sont en place :

1. **Caddy résout `api` et `web` dynamiquement** (rafraîchi toutes les 10 s) et **réessaie
   les connexions ratées pendant 12 s** (`lb_try_duration`, dans `infra/caddy/Caddyfile`).
   Pendant le chevauchement, les deux conteneurs servent ; quand l'ancien quitte le DNS,
   une requête qui tombe dans la fenêtre de rafraîchissement est réessayée sur le survivant
   au lieu de répondre 502. Échecs de connexion seulement — une requête que l'amont a
   *acceptée* n'est jamais rejouée : rejouer une écriture non idempotente est pire que
   l'échouer.
2. **L'API draine sur SIGTERM** (`server.mjs`) : `docker stop` laisse finir les requêtes en
   cours, puis ferme les connexions DB/Redis.
3. **Les deux services ont un healthcheck** : « le nouveau conteneur sert » est un état que
   le script peut attendre — pas un sleep et un espoir. Les répliques roulées atterrissent
   sur des ports hôte arbitraires (l'api publie une plage), d'où l'attente sur la santé du
   conteneur et non sur un port.

## Le mode d'échec est le but

Si un nouveau conteneur ne devient jamais sain, les **nouveaux** sont retirés et les
**anciens servent encore — on ne les a jamais touchés**. Un déploiement raté est une ligne de
log, pas une panne. (`deploy.sh` échoue dans l'autre sens : cassé d'abord, puis retour
arrière. Gardez-le pour les démarrages à froid et pour le cas ci-dessous.)

## Ce que cela exige des migrations — à lire avant de s'y fier

Le nouveau conteneur api exécute ses migrations au démarrage, **pendant que l'ancien code
sert encore**. Entre deux déploiements adjacents, les migrations doivent donc être
**additives** (étendre → migrer le code → contracter) : ajoutez la colonne maintenant,
supprimez ou renommez seulement au déploiement *suivant* celui qui a cessé de s'en servir.
Une migration destructive fait lever les anciens conteneurs pendant le chevauchement — la
coupure qu'on évitait, déplacée dans la base, où elle est pire.

**Si un déploiement doit casser le schéma, utilisez `deploy.sh` et acceptez le trou.**

## Ce qui roule, ce qui redémarre, ce qu'on ne touche jamais

| Service | Traitement | Pourquoi |
| :--- | :--- | :--- |
| `api`, `web` | Roulés (nouveau à côté de l'ancien) | Un visiteur les regarde. L'api d'abord : elle exécute les migrations, et le nouveau bundle web peut appeler des routes que seule la nouvelle api possède. |
| `bot`, `telemetry`, `provisioner` | Recréation simple | Un bot qui se reconnecte ou un tableau de bord qui clignote n'est pas une panne. |
| `caddy` | **`caddy reload`**, jamais restart | Un restart *est* la panne. Reload applique un Caddyfile modifié sans couper une connexion ; inchangé, c'est un no-op. |
| `db`, `redis`, `minio` | Jamais touchés | À état. Les rouler exige une histoire de bascule que cette stack n'a pas et ne doit pas prétendre avoir. |

## Réglages

| Env | Défaut | Sens |
| :--- | :--- | :--- |
| `HEALTH_TIMEOUT` | 180 | Secondes d'attente d'un nouveau conteneur avant d'abandonner (et de garder les anciens). |
| `DRAIN_GRACE` | 30 | Secondes que `docker stop` accorde au drainage avant SIGKILL. |
