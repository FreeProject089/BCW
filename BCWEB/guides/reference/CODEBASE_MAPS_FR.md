# Cartes du code

Huit cartes en lecture seule dans **Admin → Modération**. Chacune lit les sources (ou, pour
l'une d'elles, l'environnement de cette instance) et imprime une structure. Elles sont
repliées par défaut et se chargent à la première ouverture — une page utilisée tous les jours
ne doit pas payer pour des outils ouverts deux fois par an.

Toutes les huit sont en `requireRole('ADMIN')`, donc 2FA également.

Elles existent parce que les réponses ci-dessous étaient toutes *déductibles* du code et
qu'aucune n'était *écrite quelque part* — chacune était donc une chose que quelqu'un devait
se rappeler correctement.

!!! warning "Les nombres de cette page sont soit épinglés, soit datés, jamais simplement cités"
    Chaque chiffre ci-dessous est de l'un des deux types. Un chiffre **épinglé** est un chiffre
    sur lequel quelqu'un agirait : il figure dans le tableau du bas, « Chiffres épinglés par ce
    document », que `apps/api/test/codebase-maps-doc.test.mjs` recalcule à partir des générateurs à chaque
    exécution des tests. Si le code bouge et que cette page ne bouge pas, la suite passe au
    rouge et nomme la ligne fautive.

    Tout le reste est un **instantané**, écrit « mesuré le 2026-09-17 » et vrai de ce jour-là
    seulement. Un nombre de routes ou de modèles donne un ordre de grandeur et rien de plus, et
    une version antérieure de cette page citait un total de routes qui avait dérivé de quatre
    cents tout en se lisant comme un fait actuel. Là où un nombre n'était que décoratif, cette
    page dit désormais ce que la carte *signifie* plutôt que ce qu'elle a compté.

---

## Quelle garde protège quelle route — `GET /admin/rbac-map`

Chaque `app.get|post|put|patch|delete('/chemin'` de `apps/api/src/routes`, lu dans les fichiers
de routes eux-mêmes : la carte ne peut pas dériver du code comme le ferait un document. Sept
formes de garde sont reconnues (`requireRole`, `requireCap`, `optionalAuth`, `apiAuth`,
`resolve`, `oauthBearer`, `requireEditor`). Mesuré le 2026-09-17 : 1080 routes dans 71
fichiers.

Le nombre à lire est **suspicious** : une route `/admin` ou `/me` sans garde et absente de la
liste des routes publiques à dessein. Mesuré le 2026-09-17, il vaut 51, et ce chiffre ne
désigne pas 51 trous. L'un est `GET /me`, qui est en `optionalAuth` et donc correcte. Les
cinquante autres relèvent tous du même angle mort, et le connaître est la seule façon de lire
cette liste.

!!! danger "Une garde rangée dans une constante est invisible pour cette carte"
    L'analyseur regarde les six lignes sous le chemin et reconnaît l'appel de garde comme du
    texte. Il voit donc `{ preHandler: requireCap('manage_rights') }`, et ne voit pas ceci :

    ```js
    const CAP = requireCap('manage_rights');
    app.get('/admin/rights', CAP, async (req) => { … });
    ```

    Cette écriture est celle de `rights.mjs` (`CAP`), `feedback.mjs` (`READ`), `tasks.mjs`
    (`board`), `content-backup.mjs` et `og.mjs` (`RACE_CAP`), ce qui fait exactement les
    cinquante. Chacune a été vérifiée à la main face à sa constante, et chacune est gardée.

    Sur l'ensemble de la carte, la même cause explique 91 des 320 routes signalées comme non
    gardées. Le mode d'échec annoncé de ces cartes est de sous-compter ; ici c'est l'inverse :
    elles sur-signalent, dans la direction alarmante, c'est-à-dire le genre de rapport que les
    gens cessent de lire. Tant que l'analyseur ne résout pas un `preHandler` rangé dans une
    constante, traitez une entrée de `suspicious` comme « va voir cette ligne », jamais comme
    un problème constaté.

## La base, et l'écart — `GET /admin/schema-map`

Affiche les modèles les plus larges et les plus référencés, et — la partie qui compte —
l'**écart d'index** : un index créé en SQL brut et jamais déclaré dans `schema.prisma`. Mesuré
le 2026-09-17 : 162 modèles, 135 relations, 483 index déclarés contre 329 créés par les
migrations.

Ce cas n'est pas cosmétique. La prochaine migration générée proposera de le **supprimer**,
parce qu'un `migrate diff` croit le schéma. C'est épinglé sous le nom `indexDrift` plus bas, et
il vaut zéro.

!!! note "Postgres tronque les identifiants à 63 caractères en gardant le suffixe"
    C'est le milieu qui est coupé, pas la fin. Comparer les noms complets produisait deux
    faux positifs avant l'application de cette règle.

## L'historique des migrations — `GET /admin/migration-map`

La carte du schéma compare `schema.prisma` au SQL. Voici l'autre axe, et deux de ses trois
réponses exigent une base vivante :

- une migration enregistrée comme **appliquée dont le dossier a disparu**. Prisma revalide une
  somme de contrôle par migration : un dossier supprimé ou renommé casse `migrate deploy` sur
  toutes les machines *sauf* celle où il a été supprimé — d'où la difficulté à le remarquer.
- une migration **commencée et jamais terminée**, ou annulée. La base est alors dans un état
  qu'aucune migration ne décrit, et le déploiement suivant refuse de démarrer.

Et une à laquelle le SQL répond seul : quelles migrations ont **perdu des données**.
`DROP COLUMN`, `DROP TABLE` et `DELETE FROM` ne peuvent pas être défaits par une autre
migration, et savoir quelle version en contenait une fait la différence entre une restauration
et une supposition. C'est épinglé sous le nom `dataLossMigrations` plus bas, parce que c'est
ici le seul chiffre sur lequel quelqu'un agirait. Il y en a deux, sur 126 dossiers sur disque :

| Migration | Ce qu'elle a fait |
| --- | --- |
| `20260812090000_drop_legacy_api_token` | `DROP COLUMN` sur `User` |
| `20260901160000_discord_member_storage` | `DELETE FROM` sur `DiscordActivity`, `BotGuild`, `ModerationLog` |

!!! note "Une migration de données n'est pas une migration vide"
    Les migrations `INSERT`/`UPDATE` écrivent des LIGNES au lieu de changer la forme : elles ne
    peuvent pas être simplement rejouées, et une restauration doit en tenir compte. Elles
    annonçaient « aucune opération » avant d'avoir leur propre catégorie, un résultat vide qui
    se lit exactement comme un résultat propre. Mesuré le 2026-09-17, neuf dossiers sont dans
    ce cas, portant 3 `INSERT` et 8 `UPDATE` au total ; lisez `totals.insertData` et
    `totals.updateData` dans la réponse plutôt qu'un chiffre repris de cette page.

Une panne de base se dégrade vers la moitié sur disque plutôt qu'en 500, et `pending` reste
alors vide. « 126 migrations en attente » depuis une base injoignable est un mensonge qui se
lit comme une urgence.

## La pile et ses ports — `GET /admin/compose-map`

Services, arêtes `depends_on`, ordre de démarrage, et **ce qui est publié sur le réseau**.

Ce n'est pas une liste de fautes — le proxy d'entrée *doit* publier 80 et 443. C'est la liste
de ce qui est joignable depuis l'extérieur de la machine, une liste que quelqu'un devrait
pouvoir réciter et ne le peut généralement pas. Elle est épinglée sous le nom `publishedPorts`
plus bas et compte six entrées, pour onze services :

| Service | Publié | Remarque |
| --- | --- | --- |
| `caddy` | `80`, `443`, `5176` | L'entrée. 80 et 443 sont sa raison d'être. |
| `api` | `3000-3009` | Une **plage**, pas un port. |
| `minio` | `9000`, `9001` | Le stockage objet et sa console. |

`db` publie `5432` mais uniquement sur `127.0.0.1`, d'où son absence de cette liste : la carte
lit l'adresse d'écoute, et la boucle locale n'est pas le réseau.

!!! warning "L'API publie une plage, donc son port hôte bouge"
    `3000-3009:3000` permet à Compose de multiplier l'API, et cela signifie que le port hôte
    sur lequel l'API répond est celui de la plage qui était libre au démarrage du conteneur.
    Tout ce qui suppose 3000 (un proxy de dev, un `curl` dans une procédure, une règle de
    pare-feu écrite une fois) a raison jusqu'au prochain redémarrage. Lisez la carte, ou
    `docker compose port api 3000`, plutôt que le premier port de la plage.

Les trois dernières lignes ci-dessus sont publiées par commodité, et `run/DEPLOY_FR.md` §12
précise que le pare-feu doit tout fermer sauf 22/80/443 juste après le premier déploiement,
d'où l'intérêt de mettre le même fait sur un écran qu'on regarde plus d'une fois.

!!! note "Cette carte répond désormais dans le conteneur"
    Elle renvoyait un 404 sur toute instance déployée, parce que rien ne copie `infra/` dans
    l'image de l'API. Le fichier compose se monte maintenant lui-même en lecture seule sur
    `/infra/compose/docker-compose.yml`, exactement là où atterrit la résolution de chemin de
    la route une fois l'arborescence aplatie par l'image. La branche 404 est conservée pour un
    déploiement qui ne livre que l'image : « aucun port exposé » serait une réponse fausse dite
    avec assurance.

## Secrets avec une valeur de repli codée en dur — `GET /admin/secrets-map`

Lit chaque accès `process.env` dans tous les `.mjs` sous `apps/api/src` (202 fichiers, mesuré
le 2026-09-17). `process.env.JWT_SECRET || 'dev'` signifie qu'une instance déployée sans cette
variable n'échoue pas — elle signe ses jetons avec une valeur que quiconque lit le dépôt
connaît. Elle échoue en s'ouvrant, silencieusement, et tout a l'air normal.

**Replis vivants : zéro.** C'est épinglé sous le nom `liveSecretFallbacks` plus bas, et c'est
le seul nombre de cette page qui justifierait le test à lui seul : c'est une affirmation sur
laquelle un lecteur agit en *ne regardant pas*, elle ne doit donc jamais pouvoir se périmer
dans le sens rassurant.

Cela n'a pas toujours valu zéro. Le premier passage signalait dix-huit replis et en qualifiait
cinq de vivants : `LINK_LOOKUP_SECRET` dans quatre fichiers et `SEED_ADMIN_PASSWORD` dans
`seed.mjs`. Ils sont corrigés. `apps/api/src/lib/boot-guard.mjs` déclare désormais trois usages
(jetons de session, authentification du bot Discord, télémétrie et recherche de lien) et
`server.mjs` refuse de démarrer si l'un d'eux devait tourner sur la valeur du dépôt. Le nombre
de replis présents dans les sources a peu bougé (dix-huit occurrences, mesuré le 2026-09-17 :
quatorze `JWT_SECRET`, trois `LINK_LOOKUP_SECRET`, un `SEED_ADMIN_PASSWORD`) ; ce qui a changé,
c'est que les dix-huit sont désormais gardées, et que la carte distingue les deux cas pour que
les non gardées ressortent.

!!! warning "Une limite à connaître"
    La garde de démarrage ne s'exécute que si `NODE_ENV=production` est réellement positionné.
    Une instance qui l'oublie saute tout le contrôle, et chaque repli de la liste redevient
    vivant d'un coup. C'est l'unique condition sur laquelle repose le « zéro » ci-dessus.

**La valeur de repli n'est jamais renvoyée** — seulement son `fichier:ligne`. Elle est dans le
code pour qui doit la corriger, et une API qui distribue une clé de signature qu'une instance
utilise peut-être serait pire que le problème qu'elle signale.

## Config face à `.env.example` — `GET /admin/config-diff`

La carte des secrets lit les sources. Seule une instance en fonctionnement peut répondre à
l'autre moitié : de tout ce qui est documenté, qu'est-ce qui n'est pas défini ici, et **qu'est-
ce qui est resté sur la valeur du fichier d'exemple**.

`POSTGRES_PASSWORD=change-me` recopié tel quel dans un `.env` déployé est la façon la plus
courante pour une pile Compose de se retrouver avec un identifiant présent dans le dépôt, et
rien d'autre ne le remarquerait — l'application démarre, la base se connecte, tout fonctionne.

Pour un **nom de secret, correspondre à l'exemple EST le problème**, quelle que soit
l'apparence de la valeur. Une version antérieure ne signalait que les valeurs qui *avaient
l'air* d'un texte à remplacer, et les `JWT_SECRET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` et
`TELEMETRY_ADMIN_KEY` de la pile de dev — tous égaux aux valeurs de l'exemple, aucun ne
ressemblant à `change-me` — étaient classés dans « faits pour être copiés ».

**Aucune valeur n'est jamais renvoyée**, seulement des noms et des verdicts. Un test le
vérifie sur la sortie réelle. Une session admin ne doit pas devenir un moyen de lire
l'environnement de l'instance.

Cette page ne reprend volontairement aucun chiffre de cette carte : sa réponse est une
propriété de la machine sur laquelle elle tourne, un nombre écrit ici décrirait donc un
déploiement et serait lu comme décrivant le vôtre.

## Où vont les données — `GET /admin/data-flow`

Route → modèle → lecture/écriture, joint à la garde. Mesuré le 2026-09-17 : 1080 routes, 156
modèles, 1995 appels à la base, plus 406 appels hors de toute route (balayeurs, code de
démarrage, utilitaires), signalés à part parce que les rattacher à la route la plus proche
serait un mensonge assuré sur qui peut les atteindre.

Le modèle à surveiller n'est pas celui qu'on croit. `user` est touché par 136 routes, mais le
modèle le plus touché est `adminSetting`, avec 126 routes et 184 appels : la table des réglages
est lue à l'entrée de presque tout, ce qu'il vaut mieux savoir avant d'en changer la forme.

La liste à lire est **ce qu'une requête anonyme peut écrire**, et ce n'est plus une liste que
quiconque peut réciter. Mesuré le 2026-09-17, elle compte 83 routes. Un bon tiers est
délibéré et l'a toujours été : ingestion analytics, inscription, vérification d'e-mail,
réinitialisation de mot de passe, retours OAuth et sociaux, webhook Ko-fi, double opt-in de la
newsletter, codes de liaison Discord, retours sur la doc, abonnements à la page d'état. Le
reste relève du même angle mort que la carte RBAC.

!!! danger "Deux familles de cette liste sont gardées, et cette carte ne peut pas le voir"
    **Le `preHandler` rangé dans une constante.** Les familles `/admin/tasks`, `/admin/rights`
    et `/admin/feedback` font 25 des 83. Elles portent une garde de capacité tenue dans une
    constante, exactement comme décrit sous la carte RBAC, et cette liste hérite de son
    analyse.

    **`botAuth` a déménagé.** Les routes `/bot/*`, 25 dans `bot.mjs`, s'authentifient avec
    `botAuth(req, reply)` *dans* le handler, un `safeEqual` contre un secret partagé. Le
    détecteur qui les séparait cherche dans le fichier une `function` déclarée localement qui
    répond 401 ou 403 ; `botAuth` vit désormais dans `lib/lib.mjs` et est importée, donc rien
    ne correspond dans `bot.mjs` et les 25 atterrissent dans « écrivable par une requête non
    authentifiée ». Elles ne le sont pas.

    Ce que la liste séparée `writableInHandlerGuard` attrape encore, ce sont quatre routes dont
    la fonction de rejet est déclarée dans le même fichier : `POST /catalog`,
    `POST /oauth2/token`, `POST /oauth2/revoke`, `PUT /server/backups/limit`.

!!! note "`selfRejects` est un fait, pas un verdict"
    19 des 83 répondent 401 ou 403 quelque part dans leur propre corps, et la carte le dit sans
    décider de ce que cela signifie. `/webhooks/kofi` compare un jeton avec `safeEqual` et
    renvoie 401 avant d'écrire ; `/auth/login/2fa` renvoie 401 aussi, sur un mot de passe
    erroné, sur un point d'entrée réellement public. Forme identique, sens opposé. La ligne
    porte le fait et aucun verdict n'est inventé.

## Ce qui construit et livre tout ça — `GET /admin/infra-map`

Vous aviez demandé un visualiseur d'état Terraform. Il n'y a aucun Terraform dans les quatre
dépôts — pas de `.tf`, pas de `.tfstate`, aucune mention — donc un lecteur lirait un fichier
inexistant. Ceci répond à la même question contre ce qui existe vraiment.

Un état Terraform dit deux choses : ce qui est déclaré, et ce qui le met en place. La carte
compose ci-dessus est la première. Voici la seconde — les workflows GitHub Actions, ce que
chacun publie (lu depuis les ACTIONS utilisées, jamais depuis son nom), et quels secrets un
clone neuf exigerait.

Ce qu'elle rapporte, c'est **un workflow, cinq jobs, aucun secret** :
`BCW/.github/workflows/ci.yml`, qui exécute `web-build`, `api-check`, `native`, `caddyfile` et
`secret-scan` sur `push` et sur `pull_request`. Les trois chiffres sont épinglés plus bas. Rien
dans la CI ne demande de secret : un contributeur sur un fork peut donc vérifier son travail,
un fait d'une ligne qui ne vit sinon que dans la tête de celui qui l'a monté.

!!! warning "Le workflow de publication est hors de portée de cette carte"
    La route essaie deux répertoires, `BCWEB/.github/workflows` puis `BCW/.github/workflows`,
    et s'arrête au premier qui répond. `release.yml` vit dans le dépôt parent, au-dessus des
    deux : cette carte ne l'a donc jamais rapporté et ne prétend pas le faire. Une version
    antérieure de cette page disait « `Release` est le seul qui publie quelque chose », ce qui
    était vrai des dépôts et n'a jamais été ce que l'écran montrait. Pour savoir ce qui publie
    une version, lisez ce workflow ; n'attendez pas de cette carte qu'elle le mentionne.

    Lire les deux répertoires au lieu de s'arrêter au premier a d'ailleurs été un bug : dans
    l'image ils se résolvent vers le même chemin, et chaque workflow était compté deux fois.

!!! note "Cette carte répond désormais dans le conteneur"
    Comme pour la carte compose, `.github/` n'est pas copié dans l'image de l'API, et le
    fichier compose monte `BCW/.github/workflows` en lecture seule sur `/.github/workflows`
    pour que la carte fonctionne sur une pile déployée. La branche 404 est conservée pour un
    déploiement sans ce montage : « aucun workflow » se lirait « rien ne construit ça ».

---

## Chiffres épinglés par ce document

`apps/api/test/codebase-maps-doc.test.mjs` reconstruit chaque carte depuis les sources et la
compare à ce tableau, dans les deux versions linguistiques. Un nombre d'ici qui cesse de
correspondre au code devient un test rouge nommant la ligne fautive, et non une phrase que
quelqu'un doit remarquer.

Rien de volatil n'a sa place ici. Les totaux de routes, de modèles et d'appels bougent toutes
les semaines et sont écrits plus haut comme des instantanés datés, volontairement : un test qui
échouerait à chaque nouveau point d'entrée serait désactivé en un mois.

| Clé | Ce qu'elle compte | Valeur |
| --- | --- | --- |
| `liveSecretFallbacks` | Lectures `process.env` de nom secret avec repli codé en dur et sans garde de démarrage | **0** |
| `dataLossMigrations` | Migrations contenant `DROP TABLE`, `DROP COLUMN` ou `DELETE FROM` | **2** |
| `indexDrift` | Index créés par une migration et absents de `schema.prisma` | **0** |
| `publishedPorts` | Entrées de port joignables depuis l'extérieur de la machine | **6** |
| `workflows` | Fichiers de workflow GitHub Actions que la carte peut atteindre | **1** |
| `workflowJobs` | Jobs dans ces workflows | **5** |
| `workflowSecrets` | Secrets distincts exigés par ces workflows | **0** |

## Ce qu'elles ne sont pas

Chacune est **fondée sur les lignes et volontairement superficielle** plutôt qu'un vrai
analyseur syntaxique. C'est un arbitrage assumé : le mode d'échec visé est de signaler *moins*
de routes, d'appels ou d'arêtes qu'il n'en existe — ce qu'un compteur laisse voir — plutôt que
d'inventer des arêtes qui envoient quelqu'un lire du code qui ne fait rien.

Le `preHandler` rangé dans une constante est l'endroit où cet arbitrage ne tient pas, et il
vaut mieux le dire franchement : sur la question des gardes, les cartes échouent actuellement
dans la direction bruyante plutôt que dans la silencieuse. Un lecteur qui l'ignore lit
cinquante fausses alertes et arrête de lire.

Chaque route refuse de répondre sur une analyse vide : une carte construite à partir de zéro
fichier ne signale aucun problème, ce qui est la réponse la plus dangereuse qu'un tel outil
puisse donner.
