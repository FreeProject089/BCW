# Notifications, flux RSS et carte de lancement BMM

🇬🇧 [English version](NOTIFICATIONS_EN.md)

Trois choses qui partagent un seul moteur :

1. **Les notifications** : ce qui arrive dans la cloche d’un membre, son centre de
   notifications, l’app BMM et son flux RSS personnel.
2. **Les flux RSS / Atom** : un flux privé par membre, et un flux public d’actualités.
3. **La carte de lancement BMM** : ce que BetterModsManager montre dans sa fenêtre de démarrage.

Code : `apps/api/src/lib/notify.mjs` (le moteur), `apps/api/src/routes/notify.mjs` (flux,
suivis, composeur admin), `apps/api/src/lib/bmm-launch.mjs` et
`apps/api/src/routes/bmm-launch.mjs` (la carte de lancement). Tests :
`apps/api/test/notify.test.mjs`, `notify-feeds.test.mjs`, `bmm-launch.test.mjs`.

---

## 1. Envoyer une notification (pour les développeurs)

```js
import { notify } from '../lib/notify.mjs';

await notify({
  audience: 'role:STAFF',            // ou userIds: ['…'], voir plus bas
  kind: 'moderation.case',           // décide de la catégorie que l’on peut couper
  title: 'A case needs review',
  body: 'contact · score 7',         // facultatif
  titleFr: 'Un cas attend', bodyFr: '…', // facultatif
  url: '/admin?s=modqueue&case=…',   // un chemin du site (ou une URL absolue de ce site)
  dedupeKey: 'moderation.case:contact:123', // facultatif, rend l’appel idempotent
  priority: 1,                       // 0 normale, 1 haute, 2 urgente ('normal' | 'high' | 'urgent' acceptés aussi)
  expiresAt: new Date(Date.now() + 7 * 86400e3), // facultatif
});
// → { ok: true, sendId, deduped, targeted, delivered, muted }  ou  { ok: false, error }
```

Elle **ne lève jamais d’exception** : une notification est un effet de bord, et un effet de
bord raté ne doit pas faire échouer la requête qui l’a causé. Lis `ok`.

### Qui la reçoit

| Cible | Atteint |
|---|---|
| `userIds: [...]` | ces comptes (doublons fusionnés, comptes fermés ignorés) |
| `audience: 'all'` | chaque compte ouvert |
| `audience: 'role:MOD'` | un rôle : `USER`, `MOD`, `ADMIN`, `SUPERADMIN`, ou `STAFF` pour les trois niveaux d’équipe |
| `audience: 'cap:manage_reports'` | qui détient une capacité (admins, attributions directes, rôles personnalisés, les capacités par défaut d’un MOD) |
| `audience: 'project:bmm:followers'` | les membres qui suivent un projet (la clé, `sc:<slug>`, ou un slug de projet seul) |

### Idempotence

Avec une `dedupeKey`, un second appel ne fait rien et répond `deduped: true`. Deux appels
simultanés livrent une seule fois. Un envoi interrompu en cours de route (le processus est
mort) est **repris** par l’appel suivant avec la même clé, et personne ne le reçoit deux fois :
chaque ligne note son envoi, et le couple (envoi, destinataire) est unique.

### Diffusion

Une ligne par destinataire, écrite par paquets de 1000. Une ligne de diffusion plus un état de
lecture par membre aurait demandé de réécrire chaque lecteur (la cloche, le centre, l’API
publique que lit BMM, le point OAuth) ; une ligne par membre les garde tous tels quels et rend
les sourdines, l’état lu et la suppression propres à chacun. Chaque appel écrit aussi une ligne
`NotificationSend` : l’historique admin, la clé d’idempotence, et la source du flux public.

### Sourdines

Un membre coupe des catégories dans *Notifications → Ce que tu reçois*. Le type décide de la
catégorie (`NOTIF_CATEGORIES` dans `lib/lib.mjs`). La sourdine s’applique **à l’écriture** : un
membre qui a coupé ne reçoit aucune ligne. Nouvelles catégories : **Projets que tu suis**
(types `project_…`) et **File de modération** (`moderation.…`, montrée à l’équipe seulement).
**Compte & sécurité** ne se coupe pas ; un type inconnu y tombe, il est donc livré plutôt
que perdu.

### Expiration

`expiresAt` cache la ligne à tous les lecteurs dès ce moment, et le balayeur la supprime dans
les dix minutes. Les fiches d’envoi de plus d’un an partent aussi, sauf celles du flux public.

---

## 2. Suivre un projet

Un bouton **Suivre** est sur chaque page de projet. Suivre veut dire une chose : un nouvel
article dans le blog de ce projet t’arrive en notification (type `project_post`), une fois par
article, à sa première publication, tant que le projet est public. L’équipe peut couper cela
pour tout le site dans *Admin → Écriture & avis → Envoyer une notification*. Un membre voit et
retire ce qu’il suit dans */notifications*.

---

## 3. Le composeur admin

*Admin → Écriture & avis → Envoyer une notification* (capacité `manage_announcements`).

- **À** : des comptes précis (recherche), un rôle, tout le monde, ou les abonnés d’un projet.
- **Type** : *Actualité* (le membre peut la couper) ou, pour des comptes précis seulement,
  *Avis de compte* (toujours livré).
- **Aperçu** : compte qui la reçoit une fois les sourdines appliquées et montre le texte exact
  dans chaque langue.
- **Garde anti-doublon** : le même texte au même public dans les 24 heures est refusé tant que
  l’admin ne confirme pas.
- **Double clic sans risque** : le formulaire porte un identifiant de requête ; un envoi rejoué
  est le même envoi.
- **Limite de débit** : 10 envois par 10 minutes et par admin.
- **Journal** : chaque envoi est écrit dans le journal d’audit infalsifiable (`notify.sent`).
- **Flux public** : un message à tout le monde peut aussi figurer dans `/feeds/news.xml`.

---

## 4. Flux RSS et Atom

| Flux | URL | Pour qui |
|---|---|---|
| Actualités publiques | `/feeds/news.xml`, `/feeds/news.atom` (`?lang=fr` pour le français) | tout le monde |
| Personnel | `/feeds/u/<id>.<secret>.xml` ou `.atom` | qui détient l’URL |

Le flux personnel liste les 50 dernières notifications en cours du membre, dans la langue de
son compte (`?lang=` la remplace). Il se crée, se remplace et se coupe dans */notifications*.

**L’URL personnelle est un identifiant secret.** Donc :

- seule l’empreinte SHA-256 du secret est stockée, comparée en temps constant ;
- elle n’est montrée **qu’une fois**, à sa création. Perdue : remplace-la (l’ancienne URL
  meurt aussitôt) ;
- un mauvais secret, un id inconnu, un compte fermé ou banni répondent tous le même `404` ;
- le chemin est masqué dans les journaux de l’API et les fiches d’erreur (`errorlog.mjs`),
  parce que le secret est dans le chemin et pas dans la chaîne de requête ;
- les réponses portent `Cache-Control: private` et `Referrer-Policy: no-referrer`.

Les deux flux envoient un `ETag` et répondent `304` à un `If-None-Match` qui correspond. Chaque
texte est échappé pour le XML et les caractères interdits par le XML sont retirés.

**Routage** : Caddy envoie `/feeds/*` à l’API sans préfixe (`infra/caddy/Caddyfile`) ; le
serveur de dev Vite fait de même. L’API les sert aussi sous `/api/feeds/…`.

---

## 5. La carte de lancement BMM

*Admin → Écriture & avis → Carte de lancement BMM* (capacité `manage_announcements`).

BMM demande, au démarrage :

```
GET /api/bmm/launch?version=<semver de bmm>&lang=<fr|en>
```

```json
{ "v": 1, "generatedAt": "ISO", "items": [
  { "id": "…", "rev": 3, "kind": "blog",
    "title": "…", "summary": "… (texte brut, 400 caractères au plus)",
    "url": "https://…", "imageUrl": "https://… ou null", "publishedAt": "ISO",
    "display": { "mode": "always | once | times", "times": 3,
                 "from": "ISO ou null", "until": "ISO ou null",
                 "minVersion": "semver ou null", "maxVersion": "semver ou null" },
    "priority": 0 } ] }
```

Chaque carte est l’une de : **le dernier article d’un blog** (celui de BMM par défaut), **un
article choisi**, ou une **carte personnalisée** (titre, résumé, lien https, image, dans les deux
langues). Réglages par carte : montrée *une fois*, *un nombre de fois* ou *à chaque lancement* ;
dates de début et de fin ; version BMM minimale et maximale ; priorité ; active ou non. Un
interrupteur global coupe tout (« aucune »).

- Seules les cartes **actives** sont servies : allumées, dans leurs dates, compatibles avec la
  version quand BMM l’envoie (les bornes voyagent aussi dans la carte, l’app peut donc les
  vérifier elle-même).
- **`rev`** bouge quand ce que dit une carte change (un nouvel article le plus récent, un titre
  ou une image modifiés). L’app compte les affichages par id et rev, donc un nouveau rev remontre
  la carte. Changer seulement combien de fois ou quand elle s’affiche ne le fait pas bouger.
- **Liens** : seules des URL absolues en `https://` sortent, analysées et non comparées par
  préfixe (`javascript:`, `data:`, le `http:` simple et les URL avec identifiants sont refusés à
  l’enregistrement et filtrés à nouveau à la sortie). Seule exception : sur une installation de
  développement dont l’adresse est `http://localhost`, ses liens de blog sont en http.
- **Cache** : les cartes résolues sont gardées une minute (invalidées à chaque enregistrement
  admin) ; la réponse porte `Cache-Control: public, max-age=60` et un `ETag` calculé sur les
  cartes.
- L’écran admin prévisualise chaque carte comme l’app la dessine, en anglais et en français.

---

## Données personnelles

Suivre un projet (quel compte suit quel projet, depuis quand) et le jeton du flux personnel (une
empreinte, sa date de création, la dernière lecture par un lecteur) sont de nouvelles données.
Les deux sont effacées avec le compte et décrites dans la Politique de confidentialité
(*Notifications, suivis et ton flux RSS*).
