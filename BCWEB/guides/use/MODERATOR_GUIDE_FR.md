# Le bon petit modérateur — modérer BetterCommunity

*Comment garder BetterCommunity (BCWEB) sûr et propre, avec les outils et le jugement qui
vont avec. Suppose un rôle **MOD** (ou supérieur). 🇬🇧 [English version](MODERATOR_GUIDE_EN.md).*

---

## 1. Rôles & ancienneté

BCWEB a une hiérarchie stricte. **Tu ne peux agir que sur les personnes en dessous de toi.**

| Rôle | Peut faire |
|---|---|
| **USER** | Membre normal. |
| **MOD** | Modérer le contenu ; **suspendre les utilisateurs** (pas le staff). |
| **ADMIN** | Tout ce qu'un MOD fait, plus **bannir les mods**, gérer la plupart des réglages. |
| **SUPERADMIN** | Contournement implicite partout ; peut **bannir les admins** ; reçoit les alertes d'actions sensibles. |

**À faire :** reste dans ton rang — un MOD suspend des *users*, un ADMIN bannit des *mods*, un
SUPERADMIN bannit des *admins*. **À éviter :** agir sur un pair ou un supérieur ; le serveur
le refuse de toute façon.

## 2. Capacités

Des **capacités** fines protègent chaque surface admin (`manage_reports`, `manage_catalogs`,
`manage_repos`, `manage_analytics`…). Tu ne vois que les onglets qui te sont accordés. Un
onglet manquant = capacité manquante ; demande à un admin, ne contourne pas.

## 3. La file des signalements

- **Admin → Signalements** (`/admin?s=reports`) est ta boîte de réception. Un signalement
  porte une cible (dépôt/catalogue/profil/article), une raison, et un fil optionnel avec le
  rapporteur.
- Filtre par **statut** ; tu peux suspendre la cible d'ici si c'est du contenu utilisateur.
- Reste factuel et enregistré.

**À faire :** lis tout le fil avant d'agir ; demande des précisions si c'est vague.
**À éviter :** clore un signalement sans note de résolution — le **journal d'audit** te tient.

## 4. Modérer les utilisateurs

- **Suspendre** (MOD+) verrouille l'utilisateur avec un panneau de connexion clair ; un
  suspendu **ne peut plus soumettre** de contenu. **Bannir** (ADMIN+, selon la hiérarchie)
  est plus lourd.
- Le `User.status` gate l'accès partout ; le verrou est appliqué côté serveur.

**Escalade recommandée :** avertir → suspension temporaire → ban. Réserve les bans aux
récidivistes ou aux fautes graves (malware, harcèlement ciblé, fraude).

## 5. Modérer catalogues & dépôts

- **Catalogues communautaires** (`manage_catalogs`) : suspendre / délister / relister, et
  définir un **statut** clair (En ligne / Hors ligne / Provisioning / Suspendu). Examine le
  contenu avant d'agir.
- **Dépôts serveur** (`manage_repos`) : vérifier (accorder le check vert), revalider,
  délister avec une raison (le propriétaire est notifié), et utiliser la **recherche par
  empreinte** (`BCR-XXXX-XXXX`) pour relier un dépôt à l'identité complète de son
  propriétaire (compte BCWEB + BMM/Discord liés + Ko-fi).
- **Pools de stockage** (`/admin?s=pools`) : voir les pools de tous les users ; fusionner /
  renommer / recolorer / **défusionner** un pool.

**À faire :** ne vérifie que du contenu réellement inspecté — le check vert est un signal de
confiance. **À éviter :** délister sans raison ; le propriétaire mérite de savoir quoi corriger.

## 6. Politique d'accès (globale)

- La **Politique d'accès globale** (whitelist / ban) se superpose aux réglages par dépôt et
  est basée sur le compte (id BCWEB ou Discord). Utilise le mode `whitelistOnly` avec
  parcimonie — il verrouille toute la plateforme sur une liste blanche.

## 7. La traçabilité

- Les actions du staff sont enregistrées dans un **journal d'audit inviolable** (chaîne de
  hash HMAC) avec un endpoint de vérification. Les actions sensibles alertent les SUPERADMIN.

**À faire :** suppose que chaque action est journalisée et attribuable. **À éviter :** utiliser
les outils DB pour contourner l'audit — les tables d'audit sont protégées.

## 8. Étiquette du modérateur

- Sois transparent, cohérent, et privilégie l'action **la moins sévère** qui règle le
  problème. Les toasts d'annulation existent pour une raison — une action hâtive se rattrape
  souvent dans la fenêtre, mais pas après.

---

### Récap à faire / à éviter

| ✅ À faire | ❌ À éviter |
|---|---|
| Agir dans ton rang | Toucher pairs ou supérieurs |
| Inspecter avant de vérifier/suspendre | Valider le check vert à l'aveugle |
| Laisser une raison + note de résolution | Clore en silence |
| Escalader proportionnellement | Sauter direct au ban |
