# Autres projets — Guide complet

*🇬🇧 [English version](OTHER_PROJECTS_GUIDE_EN.md).*

« Autres projets » permet à un admin de mettre en avant N'IMPORTE QUEL projet sur le site avec
le même style de page riche que BMM/BSM (onglets, téléchargements, suivi d'avancement, notes de
version, communauté, légal) — sans toucher au code. Chacun a une page publique à
`/project/<slug>` et une carte sur la grille `/projects`.

Tout se gère depuis **Admin → Contenu → Autres projets** (créer/éditer/supprimer) et
**Admin → Contenu → Projets** (l'éditeur de config partagé, où chaque Autre projet apparaît
comme son propre onglet).

---

## 1. Créer un projet

**Admin → Autres projets → Nouveau projet.**

| Champ | Signification |
|---|---|
| Nom du projet | Nom d'affichage complet (génère aussi le slug d'URL, ex. « Better Sound Maker » → `/project/better-sound-maker`). |
| Court (≤5) | Le badge de 2 à 5 caractères montré sur les cartes et la pastille de la topbar (ex. `BSM`). |
| Accroche | Description d'une ligne sous le nom. |
| Sous-onglets | Aperçu est toujours actif. Active **Notes de version**, **Communauté**, **Légal** par projet. |
| Détails (JSON) | La config complète de la page — voir section 2. Le bouton **Modèle** pré-remplit un squelette valide. |
| Publié | Off = caché partout (un brouillon). On = en ligne, soumis à la Visibilité (section 3). |
| Épingler comme sa propre pastille de topbar | Ajoute le projet à côté de BMM/BSM dans la navigation du haut, pas juste sur la grille /projects. |

## 2. Le JSON de config

Toutes les sections sont optionnelles — omets ce que tu n'utilises pas.

```jsonc
{
  "tagline": "Description d'une ligne",

  // Bouton(s) de téléchargement. UNE entrée = un seul bouton. PLUSIEURS entrées = un
  // bouton scindé : le principal ouvre directement, le chevron ouvre un menu listant
  // chaque option avec son propre libellé (installeur / portable / source…).
  "downloads": [
    { "label": "Télécharger (Windows)", "url": "https://…", "primary": true },
    { "label": "Code source",           "url": "https://github.com/…" }
  ],

  // Rangée de liens à icônes sous l'en-tête. Tous optionnels.
  "links": {
    "github": "", "source": "", "discord": "", "kofi": "",
    "reddit": "", "website": "", "docs": "",
    "customLabel": "", "customUrl": ""      // un lien libre supplémentaire
  },

  // Média héros de l'aperçu — choisis UN : image, vidéo, ou un replay rrweb.
  "overview": { "image": "", "video": "", "replayUrl": "", "rrwebUrl": "" },

  // Suivi d'avancement : une URL brute vers progress.json
  // ({ lastUpdate, art, code, categories:[{ name, items:[{ label, status, percent }] }] }).
  // Repli : "progressData" inline avec la même forme.
  "progressSource": "https://raw.githubusercontent.com/…/progress.json",

  // Onglet notes de version : liste chaque .md d'un dossier GitHub (les sous-dossiers
  // deviennent des groupes repliables). Les fichiers sont récupérés versionnés par sha,
  // donc les modifications apparaissent sans astuce de cache.
  "releaseNotes": { "owner": "toi", "repo": "ton-repo", "branch": "main", "path": "notes" },

  // Onglet communauté : soit un contributors.json distant (caché 5 min, purgeable depuis
  // Config des projets → « Rafraîchir les caches »), des contributeurs inline, ou un
  // simple lien d'appel à l'action via "url".
  "community": {
    "url": "",
    "contributorsUrl": "https://raw.githubusercontent.com/…/contributors.json",
    "contributors": [
      { "display_name": "Nom", "role": "Rôle", "description": "", "pfp": "https://…",
        "links": { "github": "", "website": "" }, "category": "staff" }
    ],
    "messages": [ { "message": "Message de bandeau défilant" } ]
  },

  // Onglet légal : une grille de cartes. icon : shield | lock | book | file | scroll | globe | docs.
  // title/text acceptent une chaîne simple OU { "en": "...", "fr": "..." }.
  "legal": [
    { "icon": "shield", "title": "Licence", "text": "MIT", "url": "https://…" }
  ]
}
```

## 3. Visibilité

Réglée par projet, dans la modale d'édition (et pour les pages fixes BMM/BSM/Installer sous
**Config des projets** — Communauté est toujours publique) :

- **Public** — tout le monde voit la page ; elle est listée sur /projects et peut être épinglée à la topbar.
- **Non listé** — caché de la topbar/grille projets, mais quiconque AVEC le lien direct
  `/project/<slug>` peut la voir. Bien pour des lancements en douceur.
- **Privé** — personne ne peut la voir (les admins la gèrent via le dashboard comme d'habitude).
- **Liste blanche** — seuls les comptes listés peuvent la voir. Les entrées peuvent être :
  - un **compte BC** (recherché par nom/e-mail/id),
  - un **compte Discord** (doit être lié à un compte BC),
  - un **creator id BMM** brut (tout compte ayant lié ce creator id).

Les visiteurs qui échouent au contrôle obtiennent une page neutre « Non disponible » (l'API renvoie 403).

## 4. Annonces de projet (teaser à compte à rebours)

Pour un projet que tu veux TEASER avant le lancement, active **Annonce de projet** dans la
modale d'édition :

- **Titre** — l'accroche « bientôt disponible ».
- **URL du logo** — image optionnelle au-dessus de l'accroche.
- **Description Markdown** — markdown complet (alertes GitHub, badges, images…).
- **Révéler le** — date/heure de fin du compte à rebours.

Pendant le compte à rebours, **tout le monde** qui ouvre `/project/<slug>` voit la page teaser
(logo + compte à rebours J/H/M/S en direct + markdown) au lieu de la vraie page — même si la
visibilité est privée/liste blanche ; c'est le but d'une annonce. Le projet apparaît quand même
sur /projects et (si épinglé) dans la topbar, étiqueté avec le titre de l'annonce. Au moment où
le compte à rebours atteint zéro, la page bascule automatiquement vers la vraie page projet
(les visiteurs sur la page la voient changer sans rafraîchir) et les règles de Visibilité
normales reprennent.

Recette de lancement en douceur typique : visibilité **Non listé** + annonce activée + épinglée
à la topbar → le teaser fait le buzz pour tout le monde, et à la révélation seules les personnes
à qui tu as donné le lien (ou en passant Public à ce moment) voient la vraie page.

## 5. Mises à jour planifiées

Toute page projet (Autres projets ET les configs fixes BMM/BSM/Installer/Communauté) peut
préparer un **échange de contenu futur** :

- Autres projets : l'icône horloge sur la ligne du projet (Admin → Autres projets), ou le bouton « Planifier une mise à jour » dans Config des projets.
- Projets fixes : le bouton « Planifier une mise à jour » dans Config des projets.

Choisis une date/heure et édite le contenu « suivant » (nom/court + config JSON pour les Autres
projets ; config JSON seulement pour les pages fixes). Rien ne change tant que le moment n'est
pas passé — puis la version préparée remplace la version live automatiquement (appliquée
paresseusement au premier affichage après l'échéance ; pas de cron, pas d'action admin). Un
planning en attente s'affiche comme un badge `màj <date>` sur la ligne du projet ; rouvrir la
modale de planning permet d'éditer ou d'**Annuler le planning**.

## 6. Intégration blog

Chaque Autre projet peut avoir son propre espace blog :

- **Afficher l'onglet « Blog » sur la page projet** (Config des projets) — ajoute un onglet Blog listant uniquement les articles de ce projet.
- **Afficher dans « Dernières news » de l'accueil** — si ses articles remontent aussi dans le fil de l'accueil (ils s'affichent toujours sur /blog).
- Poste dedans depuis l'admin Blog en choisissant la « page personnalisée » du projet comme espace de l'article.

## 7. Notes sur le cache

Les réponses de `progressSource`, `releaseNotes` et `contributorsUrl` passent par un cache
GitHub partagé de 5 minutes. Les fetchs d'URL brutes sont versionnés par sha, donc les
modifications de fichiers sur GitHub apparaissent en général immédiatement ; si quelque chose
semble périmé, utilise **Config des projets → Rafraîchir les caches**.

## 8. Recettes rapides

- **Mettre en avant un projet secondaire terminé** : Nouveau projet → remplis downloads/links/legal → Publié + Public. Fini.
- **Teaser un projet non sorti** : Nouveau projet → annonce activée avec une date de révélation → épingle à la topbar → visibilité Non listé (ou Public à la révélation).
- **Bêta réservée aux testeurs** : visibilité Liste blanche → ajoute les testeurs par compte BC/Discord/creator id → partage le lien direct.
- **Lancement v2 coordonné** : Planifie une mise à jour avec la config v2 calée sur ton moment de sortie — la page bascule toute seule pendant que tu dors.
