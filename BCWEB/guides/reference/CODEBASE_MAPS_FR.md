# Cartes du code

Sept cartes en lecture seule dans **Admin → Modération**. Chacune lit les sources (ou, pour
l'une d'elles, l'environnement de cette instance) et imprime une structure. Elles sont
repliées par défaut et se chargent à la première ouverture — une page utilisée tous les jours
ne doit pas payer pour des outils ouverts deux fois par an.

Toutes les sept sont en `requireRole('ADMIN')`, donc 2FA également.

Elles existent parce que les réponses ci-dessous étaient toutes *déductibles* du code et
qu'aucune n'était *écrite quelque part* — chacune était donc une chose que quelqu'un devait
se rappeler correctement.

---

## Quelle garde protège quelle route — `GET /admin/rbac-map`

677 routes, lues dans les fichiers de routes eux-mêmes : la carte ne peut pas dériver du code
comme le ferait un document. Sept formes de garde sont reconnues (`requireRole`, `requireCap`,
`optionalAuth`, `apiAuth`, `resolve`, `oauthBearer`, `requireEditor`).

Le nombre à lire est **suspicious** : une route `/admin` ou `/me` sans garde et absente de la
liste des routes publiques à dessein. Aujourd'hui il y en a une — `GET /me`, qui est en
`optionalAuth` et donc correcte.

## La base, et l'écart — `GET /admin/schema-map`

104 modèles, 80 relations. Affiche les modèles les plus larges et les plus référencés, et —
la partie qui compte — l'**écart d'index** : un index créé en SQL brut et jamais déclaré dans
`schema.prisma`.

Ce cas n'est pas cosmétique. La prochaine migration générée proposera de le **supprimer**,
parce qu'un `migrate diff` croit le schéma. Actuellement zéro.

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
et une supposition. Il y en a exactement une ici.

!!! note "Une migration de données n'est pas une migration vide"
    Les migrations `INSERT`/`UPDATE` écrivent des LIGNES au lieu de changer la forme : elles ne
    peuvent pas être simplement rejouées, et une restauration doit en tenir compte. Il y en a
    deux ici, et toutes deux annonçaient « aucune opération » avant d'avoir leur propre
    catégorie — un résultat vide qui se lit exactement comme un résultat propre.

Une panne de base se dégrade vers la moitié sur disque plutôt qu'en 500, et `pending` reste
alors vide. « 48 migrations en attente » depuis une base injoignable est un mensonge qui se lit
comme une urgence.

## La pile et ses ports — `GET /admin/compose-map`

Services, arêtes `depends_on`, ordre de démarrage, et **ce qui est publié sur le réseau**.

Ce n'est pas une liste de fautes — le proxy d'entrée *doit* publier 80 et 443. C'est la liste
de ce qui est joignable depuis l'extérieur de la machine, une liste que quelqu'un devrait
pouvoir réciter et ne le peut généralement pas. Sur cette pile il y en a six : 80/443/5176
pour Caddy, 3000 pour l'API, 9000/9001 pour MinIO. Les trois derniers sont publiés par
commodité et `run/DEPLOY_FR.md` §12 précise que le pare-feu doit tout fermer sauf 22/80/443
juste après le premier déploiement — d'où l'intérêt de mettre le même fait sur un écran qu'on
regarde plus d'une fois.

Rien ne copie `infra/` dans l'image de l'API : **dans un conteneur cela renvoie 404**, et la
carte le dit en toutes lettres. « Aucun port exposé » serait une réponse fausse dite avec
assurance.

## Secrets avec une valeur de repli codée en dur — `GET /admin/secrets-map`

Lit chaque accès `process.env` dans les 94 modules de l'API. `process.env.JWT_SECRET || 'dev'`
signifie qu'une instance déployée sans cette variable n'échoue pas — elle signe ses jetons
avec une valeur que quiconque lit le dépôt connaît. Elle échoue en s'ouvrant, silencieusement,
et tout a l'air normal.

Le premier passage en signalait dix-huit. Treize étaient `JWT_SECRET`, que `server.mjs` refuse
déjà au démarrage en production : les replis gardés et vivants sont désormais distingués. Cinq
sont vivants : `LINK_LOOKUP_SECRET` dans quatre fichiers et `SEED_ADMIN_PASSWORD` dans
`seed.mjs`.

!!! warning "Deux limites à connaître"
    La garde sur `JWT_SECRET` ne se déclenche que si `NODE_ENV=production` est réellement
    positionné, et `LINK_LOOKUP_SECRET` n'a aucune garde au démarrage.

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

## Où vont les données — `GET /admin/data-flow`

Route → modèle → lecture/écriture, joint à la garde. 682 routes, 101 modèles, 1212 appels à la
base. `user` est touché par 97 routes ; 226 appels sont hors de toute route (balayeurs, code
de démarrage, utilitaires) et sont signalés à part.

La liste à lire est **ce qu'une requête anonyme peut écrire** — 18 routes. Chacune est
délibérée : ingestion analytics, inscription, vérification d'e-mail, réinitialisation de mot
de passe, retours OAuth et sociaux, webhook Ko-fi, double opt-in de la newsletter, codes de
liaison Discord, retours sur la doc. Pas une liste de fautes ; une liste que quelqu'un devrait
pouvoir réciter.

!!! note "Toutes les gardes ne sont pas des `preHandler`"
    Les routes `/bot/*` s'authentifient avec `botAuth(req, reply)` *dans* le handler — un
    `safeEqual` contre un secret partagé. La carte RBAC ne lit que les `preHandler` : une
    jointure naïve en qualifiait quinze d'« écrivables par une requête non authentifiée ».
    Elles sont désormais listées à part.

    Deux routes vérifient quelque chose en ligne : `/webhooks/kofi` compare un jeton avec
    `safeEqual` et renvoie 401 avant d'écrire, et `/auth/login/2fa` renvoie 401 aussi — sur un
    mot de passe erroné, sur un point d'entrée réellement public. Forme identique, sens
    opposé. La ligne porte le fait (`renvoie 401/403 depuis son propre corps`) et aucun
    verdict n'est inventé.

---

## Ce qu'elles ne sont pas

Chacune est **fondée sur les lignes et volontairement superficielle** plutôt qu'un vrai
analyseur syntaxique. C'est un arbitrage assumé : le mode d'échec est de signaler *moins* de
routes, d'appels ou d'arêtes qu'il n'en existe — ce qu'un compteur laisse voir — plutôt que
d'inventer des arêtes qui envoient quelqu'un lire du code qui ne fait rien.

Chaque route refuse de répondre sur une analyse vide : une carte construite à partir de zéro
fichier ne signale aucun problème, ce qui est la réponse la plus dangereuse qu'un tel outil
puisse donner.
