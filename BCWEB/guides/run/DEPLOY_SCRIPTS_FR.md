# Les scripts de déploiement — lequel, et quand

*🇬🇧 [English version](DEPLOY_SCRIPTS_EN.md).*

Quatre scripts dans `infra/`. Ils font des choses différentes et ne sont pas interchangeables ;
choisir le mauvais coûte soit du temps, soit une base de données.

## L'aide-mémoire

```bash
infra/bootstrap.sh      # PREMIÈRE fois sur une machine neuve
infra/deploy.sh         # mise à jour normale — sauvegarde, retour arrière automatique
infra/deploy-fast.sh    # petite mise à jour — ne reconstruit que ce qui a changé
infra/rollback.sh       # revenir en arrière volontairement, après coup
```

Chacun accepte `--dry-run`, qui affiche chaque étape sans rien changer. C'est sans risque à
lancer maintenant, y compris en production, et c'est la meilleure façon de découvrir ce qu'un
script va faire avant qu'il le fasse.

| Ta situation | Le script |
|---|---|
| Machine neuve, rien d'installé | `bootstrap.sh` |
| Tu as poussé du code et tu veux le déployer | `deploy.sh` |
| Une correction de texte, un CSS, rien qui touche la base | `deploy-fast.sh` |
| Le déploiement a réussi mais quelque chose est cassé | `rollback.sh` |
| Le déploiement n'est jamais remonté | rien à faire — `deploy.sh` est déjà revenu en arrière |

---

## Déploiement et mise à jour rapides

C'est la partie que tu tapes le plus souvent.

**Mise à jour normale** — celle par défaut, à utiliser quand tu hésites :

```bash
infra/deploy.sh
```

Elle sauvegarde, récupère, reconstruit, **attend que `/ready` réponde vraiment**, et remet le
commit précédent si le site ne remonte jamais. Compte deux à trois minutes.

**Mise à jour rapide** — pour un changement qui ne touche pas la base :

```bash
infra/deploy-fast.sh
```

Elle lit le `git diff` entre l'ancien et le nouveau commit et **ne reconstruit que les services
dont les sources ont bougé**. Un changement dans `apps/web` ne reconstruit jamais l'image de
l'API. Elle saute la sauvegarde — et **refuse de tourner** si la mise à jour contient une
migration, parce que c'est précisément le cas où le dump est la seule façon de revenir. Elle
attend quand même `/ready` : « rapide » ne vaut rien si ça cache un site qui n'a pas démarré.

Si rien dans `apps/` ni `packages/` n'a changé, elle te le dit et ne reconstruit rien du tout.

!!! warning "`deploy-fast.sh` ne revient pas en arrière"
    C'est ce qui la rend rapide. Si elle échoue, `infra/rollback.sh`.

---

## `bootstrap.sh` — la première fois

```bash
infra/bootstrap.sh
```

Ce n'est pas `deploy.sh`. `deploy.sh` met à jour une installation existante : il n'y a rien à
sauvegarder, rien à récupérer et rien où revenir la première fois. Ce que la première fois
demande, c'est la partie que tout le monde rate : **de vrais secrets, avant que quoi que ce
soit démarre**.

`.env.example` est versionné dans un dépôt public, placeholders compris. Le copier tel quel et
démarrer, c'est tourner avec un `JWT_SECRET` que n'importe quel lecteur du dépôt connaît — donc
que n'importe qui peut utiliser pour forger une session admin. L'API refuse de démarrer en
production dans ce cas, ce qui fait que la première expérience habituelle est un conteneur qui
ne boote pas, avec une erreur qu'on n'attendait pas pendant une installation.

Trois de ces secrets sont **commentés** dans `.env.example` (`#BOT_SHARED_SECRET=`), donc le
code retombe sur des valeurs du dépôt sans que rien ne le signale. Le script les décommente et
les remplit, puis **vérifie** que les quatre indispensables portent bien une valeur avant de
continuer.

`POSTGRES_PASSWORD` a une deuxième raison d'être traité ici : Postgres ne le lit qu'à
l'initialisation de son volume, au tout premier démarrage. Le changer après, et `.env` et la
base ne sont plus d'accord — définitivement, le seul remède étant de supprimer le volume.

Ensuite le script démarre la pile, attend `/ready` (les migrations tournent au boot, donc cette
attente couvre la création du schéma), puis lance le seed.

Il **refuse de tourner si `infra/compose/.env` existe déjà** : l'écraser changerait le mot de
passe Postgres sans changer la base.

```bash
infra/bootstrap.sh --no-seed    # démarrer sans remplir la base
```

!!! danger "Le compte admin"
    Mets `SEED_ADMIN_EMAIL` et `SEED_ADMIN_PASSWORD` dans `.env` **avant** l'étape de seed,
    sinon le compte est créé en `admin@bettercommunity.local` / `change-me-now`. Le seed est
    idempotent et ne crée le compte que s'il n'existe pas, donc le relancer ne remet jamais un
    mot de passe que tu as changé depuis.

Ce que `bootstrap.sh` ne peut pas faire à ta place : le domaine (six valeurs sur `localhost`,
voir [DOMAIN_SETUP_FR.md](DOMAIN_SETUP_FR.md)) et les sauvegardes
([BACKUP_FR.md](BACKUP_FR.md)). Il les rappelle à la fin.

---

## `deploy.sh` — la mise à jour normale

```bash
infra/deploy.sh
infra/deploy.sh --dry-run       # affiche tout, ne change rien
infra/deploy.sh --no-backup     # sauter le dump (tu en as un d'il y a deux minutes)
infra/deploy.sh --no-rollback   # laisser la version cassée en place pour l'examiner
```

Trois choses autour de `git pull && docker compose up -d --build`, et rien d'autre :

1. **Un dump d'abord.** Les migrations tournent au boot du conteneur et ne se rejouent pas à
   l'envers. Revenir au commit précédent restaure le code et laisse le schéma où il est : le
   dump pris avant est la seule chose qui puisse défaire une mauvaise migration.
2. **Une attente sur `/ready`.** Cet endpoint renvoie 503 tant que l'API ne joint pas la base,
   donc « le conteneur a démarré » et « le site marche » ne sont pas confondus.
3. **Un retour arrière automatique du CODE** si la sonde ne passe jamais au vert.

Il refuse de démarrer si le dépôt a des modifications non commitées, parce que le retour
arrière est un `git reset --hard` et les emporterait.

Il ne restaure **pas** la base automatiquement — un retour arrière qui réécrit des données peut
détruire ce qui a été écrit entre le dump et la panne. Le chemin du dump est affiché ; le
restaurer est ta décision.

---

## `rollback.sh` — revenir en arrière après coup

```bash
infra/rollback.sh               # un commit en arrière
infra/rollback.sh <commit>      # jusqu'à un commit précis
infra/rollback.sh --dry-run
```

`deploy.sh` revient déjà en arrière tout seul quand un déploiement ne remonte pas. Celui-ci est
pour l'autre cas, le plus courant : le déploiement a **réussi**, le site est remonté, et vingt
minutes plus tard quelqu'un remarque ce qu'il a cassé. Rien ne se déclenche tout seul à ce
moment-là, puisque rien n'a échoué.

Il affiche les commits qu'il défait, la commande pour annuler le retour arrière lui-même, et —
**avant** d'agir, tant que c'est encore annulable — un avertissement si l'intervalle contient
une migration. Dans ce cas le schéma reste celui d'aujourd'hui et l'ancien code tourne dessus :
c'est le plus souvent sans problème, parfois non, et aucun script ne peut faire la différence.

---

## Ce qu'aucun de ces scripts ne fait

Aucun ne restaure la base. C'est délibéré et ça vaut pour les quatre : une restauration écrase
ce qui a été écrit depuis le dump, et seul un humain peut dire si c'est acceptable. La procédure
est dans [BACKUP_FR.md](BACKUP_FR.md).

Et une sauvegarde jamais restaurée est une hypothèse, pas une sauvegarde. Fais l'essai une fois
sur une machine jetable, avant d'en avoir besoin.
