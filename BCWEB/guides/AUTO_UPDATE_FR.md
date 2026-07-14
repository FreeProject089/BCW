# Auto-updates — comment BMM & BSM se mettent à jour, et comment les héberger sur BCWEB

*Comment les apps desktop vérifient et appliquent les mises à jour, comment publier une
release, et comment servir les updates depuis **BetterCommunity (BCWEB)** au lieu de (ou en
plus de) GitHub. 🇬🇧 [English version](AUTO_UPDATE_EN.md).*

---

## 1. Comment fonctionne l'updater de BMM

BMM interroge un endpoint **`autoupdate_api`** qui renvoie des données au **format de l'API
GitHub Releases**. L'URL vient de `links.json` (`autoupdate_api`), donc éditable sans
recompiler.

À la vérification (`check_for_update` dans `src-tauri/src/commands/autoupdate.rs`) :
1. Récupère la dernière release (`{api}/latest`, ou la liste si les pré-releases sont activées).
2. Lit `tag_name` → la dernière version ; compare avec la version en cours.
3. Dans les **assets** de la release, cherche :
   - l'installeur — `*.msi`, sinon `*.exe` / `*.zip` → **`download_url`** (install complète) ;
   - **`update-manifest.json`** → **`manifest_url`** (update **incrémentale** optionnelle).
4. Si plus récent : applique l'update **incrémentale** (télécharge seulement les fichiers
   modifiés listés dans le manifeste, chacun vérifié par SHA-256 + garde anti-traversal) ou
   télécharge et lance l'**installeur complet**.

Donc deux éléments par release : **l'installeur** (toujours) et un **`update-manifest.json`**
optionnel (pour des updates incrémentales rapides et légères).

## 2. Publier une release BMM

1. Incrémente `version` dans `src-tauri/tauri.conf.json`.
2. Build l'app (ton build Tauri habituel → produit l'installeur `.exe` / `.msi`).
3. Génère le manifeste incrémental + les assets :
   ```bash
   node scripts/gen-update-manifest.mjs            # utilise la version de tauri.conf.json
   # ou : node scripts/gen-update-manifest.mjs --version 1.2.3
   ```
   La sortie va dans `dist/release-assets-v<version>/` (`update-manifest.json` + les fichiers
   suivis, ex. `lang-en.json`).
4. Publie la release avec ces assets attachés — sur **GitHub** (tag `v<version>`) ou sur
   **BCWEB** (§3).

## 3. Servir les updates depuis BCWEB (au lieu de GitHub)

BCWEB expose un feed compatible GitHub Releases construit depuis un installeur hébergé, donc
tu peux pointer `autoupdate_api` vers BCWEB :

| Endpoint | Renvoie |
|---|---|
| `GET /api/updates/bmm/latest` | la dernière release (format GitHub `/releases/latest`) |
| `GET /api/updates/bmm/releases` | une liste d'une release (format GitHub `/releases`) |

(`bsm` et `bi` fonctionnent pareil.)

**Setup (Admin → Téléchargements & assets) :**
1. Téléverse l'installeur dans le slot **`bmm-installer`** ; définis sa **version** et son
   **canal** (`stable`, ou autre chose → traité comme *pré-release*).
2. *(Optionnel)* téléverse/colle **`bmm-update-manifest`** (JSON) pour les updates
   incrémentales, et **`bmm-release-notes`** (`{ "body": "…" }`) pour les notes affichées.
3. Dans l'asset **`links.json`**, mets :
   ```json
   "autoupdate_api": "https://bettercommunity.ch/api/updates/bmm/releases"
   ```
   BMM lit `links.json` **BCWEB-first**, donc chaque client le récupère sans recompiler.

:::note
Si BCWEB est injoignable, `links.json` retombe sur la copie GitHub puis la copie locale
bundlée — une panne BCWEB ne casse jamais l'updater ; il utilise les derniers liens connus.
:::

**Note incrémentale :** les URLs des fichiers dans `update-manifest.json` doivent être
joignables. Si tu héberges sur BCWEB et veux les updates incrémentales, héberge aussi les
fichiers en assets et pointe le manifeste dessus ; sinon omets le manifeste et BCWEB sert des
updates **par installeur complet** (qui marchent toujours).

## 4. Auto-updates BSM

Les releases BSM sont sur **https://github.com/FreeProject089/Better-Sound.Maker/releases**.
Deux options, comme BMM :
- **GitHub (le plus simple) :** pointe l'endpoint d'update de BSM vers
  `https://api.github.com/repos/FreeProject089/Better-Sound.Maker/releases` et attache
  l'installeur à chaque release GitHub.
- **BCWEB :** téléverse l'installeur BSM dans le slot **`bsm-installer`** (version + canal) et
  pointe BSM vers `https://bettercommunity.ch/api/updates/bsm/releases`.

## 5. Vérifier que ça marche

- Ouvre `https://bettercommunity.ch/api/updates/bmm/latest` dans un navigateur — tu dois
  obtenir un JSON avec `tag_name`, `assets[].browser_download_url`, `prerelease`.
- Dans l'app, lance « Vérifier les mises à jour » ; la ligne de log `[UPDATE] …` montre la
  source et le résultat.
- Monte la `version` hébergée au-dessus de celle de l'app et confirme que l'app propose l'update.

:::tip[Garde GitHub en secours]
Même en servant depuis BCWEB, garder une release GitHub en miroir est une assurance pas
chère — il suffit de remettre `autoupdate_api` dessus en cas de besoin.
:::
