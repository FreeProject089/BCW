// French for the seeded blog posts, keyed by slug.
//
// The four news posts (welcome, what's-new, roadmap, hosting) were already bilingual inline.
// The five reference posts — the Markdown guide and the four catalog guides — were not, and
// nothing said so: an untranslated post renders in English with a small "not translated"
// note, which is easy to miss when the four posts above it are French.
//
// Same arrangement as seed-docs-fr.mjs, for the same reason: a translation is reviewed as a
// whole, and interleaving two languages in one array makes both hard to read.
export const BLOG_FR = {
  'markdown-guide': {
    title: 'Guide Markdown \u2014 le vocabulaire complet',
    excerpt: 'Les 32 blocs du Markdown BetterCommunity, chacun avec un exemple vivant : boutons, onglets, cartes, \u00e9tapes, math\u00e9matiques et le reste.',
    body: `Le blog, la documentation et la FAQ de BetterCommunity utilisent le **même Markdown**, plus un **système de blocs à la GitBook**. Écrivez en **Markdown** ou passez en **Visuel** — les deux enregistrent le même contenu, et le mode Visuel porte désormais la même barre d'outils « sélectionner pour formater ».

::toc[Sommaire]

:::tip[Deux façons d'écrire]
Utilisez le bouton **Blocs** en mode Markdown, ou basculez en **Visuel** et construisez le billet en glissant des blocs. Sélectionnez des mots dans l'un ou l'autre mode pour les formater.
:::

## Les bases du texte
\`**gras**\` · \`*italique*\` · \`~~barré~~\` · \`code en ligne\` · \`[un lien](https://exemple.com)\`

Une séparation entre deux sections, c'est trois tirets seuls sur leur ligne. Une citation, c'est un \`>\` en début de ligne.

## Boutons
Une seule forme, trois tailles, n'importe quelle couleur — et un logo quand c'est une marque.

:button[Regarder]{brand=youtube href=https://youtube.com} :button[Rejoindre]{brand=discord href=https://discord.gg} :button[Soutenir]{brand=kofi href=https://ko-fi.com}

\`:button[Libellé]{brand=youtube href=…}\` — marques : \`youtube\` \`discord\` \`kofi\` \`github\` \`twitch\` \`x\` \`reddit\` \`telegram\`
\`:button[Libellé]{color=#0a7 size=lg href=…}\` — tailles \`sm\` \`md\` \`lg\`, ajoutez \`outline\` pour la version discrète.

Forme courte : \`:btn[…]\` fait la même chose.

## Liens colorés
:link[un lien rouge]{color=#e11 href=/docs} — \`:link[texte]{color=#e11 href=/docs}\`. Souligné comme tous les autres liens, parce que la couleur seule n'est pas un signal que tout le monde perçoit.

## Badges et étiquettes
:badge[NOUVEAU] :badge[Sur mesure]{color="#0a7"} — \`:badge[NOUVEAU]\` ou \`:badge[N'importe quel texte]{color="#0a7"}\`. \`:tag[…]\` est la même pastille sous un autre nom.

## Emoji
:rocket: :tada: :white_check_mark: — écrits \`:rocket:\` \`:tada:\` \`:white_check_mark:\`. 384 noms, les mêmes que sur GitHub. Un nom inconnu reste tel que tu l'as tapé plutôt que de disparaître, et rien dans du code n'est touché — \`10:30:45\` et un bloc clôturé sont à l’abri.

## Icônes et touches
:icon[rocket] :kbd[Ctrl+K] — \`:icon[rocket]\` accepte n'importe quel nom lucide ou une marque ; \`:kbd[Ctrl+Shift+S]\` dessine de vraies touches.

## Encadrés
:::note[Note]
\`:::note\` \`:::tip\` \`:::success\` \`:::warning\` \`:::danger\` — et \`:::callout{icon=rocket color="#7c3aed"}\` pour le vôtre — \`:::custom\` est le même bloc, sous le nom qu'emploie le menu Blocs de l'éditeur.
:::

## Onglets
:::tabs
:::tab{title="Windows"}
Lancez \`install.exe\`.
:::
:::tab{title="Linux"}
Lancez \`./install.sh\`.
:::
:::

\`:::tabs\` qui enveloppe des blocs \`:::tab{title="…"}\`. Chaque onglet contient le markdown que vous voulez — code, images, encadrés.

## Cartes
:::cards
:::card{title="Une carte" href=/docs icon=book}
Les cartes se placent côte à côte dans \`:::cards\`. Une seule fonctionne aussi.
:::
:::

## Téléchargements
:file[setup.exe]{href=/api/assets/setup.exe size="42 Mo"} — l'icône suit l'extension : PDF, zip, image, vidéo, audio, code. \`:file[nom.ext]{href=… size="…"}\`

## Colonnes et alignement
:::columns
:::column
\`:::columns\` avec \`:::column\` à l'intérieur. \`:::row\` et \`:::col\` sont identiques.
:::
:::column
\`:::center\`, \`:::left\` et \`:::right\` alignent un bloc.
:::
:::

## Étapes
:::steps
:::step[D'abord]
Numérotées, dans l'ordre.
:::
:::step[Ensuite]
\`:::steps\` qui enveloppe des \`:::step[Titre]\`.
:::
:::

## Replier et détails
:::collapse[Cliquez pour ouvrir]
Caché jusqu'à ce qu'on le demande. \`:::collapse[Résumé]\` — \`:::details\` est identique.
:::

## Progression
\`:::progress\` est le bloc feuille de route sous un second nom — écris celui qui se lit le mieux. Il n'y a pas de pourcentage en ligne : un nombre seul est un pourcentage de rien, et c'est la feuille de route ci-dessous qui dit de quoi.

## Feuille de route
La méthode courte — des jalons, pas de JSON. Chaque puce sous un jalon devient un élément suivi :

:::roadmap[Où on en est]
:::stage[Livré]{state=done}
- Le système de blocs
:::
:::stage[En cours]{state=doing percent=40}
- Le constructeur de pages
:::
:::

\`:::stage[Titre]{state=done|doing|planned}\`, plus \`percent=\` et \`eta=\`. \`:::phase\` est le même bloc.
Pour un pourcentage par élément, mets plutôt un bloc \`json\` à l'intérieur — \`{ "categories": [{ "name": "v1.0", "items": [{ "label": "Cœur", "status": "done" }] }] }\` — ou pointe vers un fichier avec \`:::roadmap{src="https://…/progress.json"}\`. \`orientation=horizontal\` aligne les jalons sur une piste.

## Médias
Images et YouTube s'insèrent depuis la barre d'outils de l'éditeur. Un enregistrement \`.bmmreplay\` s'intègre avec \`:::replay{src="…"}\` — \`:::bmmreplay\` est identique.

## Mathématiques
Écrites \`$$…$$\`, en ligne ou en bloc :

$$E = mc^2$$

Le dollar simple \`$x$\` est volontairement désactivé : ce site affiche des prix, et « \$5 et \$10 » serait composé comme une formule.

## Tableaux et code
| Fonctionnalité | État |
|---|---|
| Thème sombre | Livré |
| Sync de dépôt | Plus rapide |

Les blocs de code délimités sont colorés par langage.

## Renvois
\`:ref[libellé]{href=…}\` crée un lien portant le nom de sa cible. Les liens internes vers la documentation affichent une carte d'aperçu au survol, avec l'icône de la page et sa première ligne.

Voilà tout le vocabulaire. Combinez encadrés, cartes et listes courtes pour des pages que les gens lisent vraiment.`,
  },
  'guide-app-catalog': {
    title: 'Publier une app : ce que BMM lit avant de télécharger quoi que ce soit',
    excerpt: 'Trois étiquettes décident de ce qu\'un utilisateur voit avant même que votre fichier n\'existe chez lui — et celles que vous omettez sont remplies par des opinions.',
    body: `:badge[Catalogue]{color="#2563eb"} :badge[Apps]{color="#16a34a"}

Une entrée de catalogue d'app ressemble à un lien entouré d'étiquettes. Ce n'en est pas un. BMM
lit plusieurs de ces étiquettes **avant** de télécharger, et il agit en conséquence — et celles
que vous laissez vides ne restent pas vides. Elles sont remplies par un défaut qui a exactement
l'air d'un choix.

::toc[Sur cette page]

## L'URL est lue, pas seulement suivie

Avant d'installer, BMM décide s'il doit demander *où* poser l'app. Il le demande quand le
téléchargement est une simple archive ; il ne le demande pas quand c'est un programme
d'installation, parce qu'un installeur choisit sa propre destination et qu'une deuxième question
serait un mensonge.

Il le déduit de deux choses : le \`file_type\` déclaré, **et l'adresse elle-même**. Une URL qui
contient \`setup\` ou \`install\` est traitée comme un installeur.

:::warning[Une URL parfaitement ordinaire peut changer le parcours d'installation]
\`https://cdn.exemple.com/install/monoutil-1.4.zip\` est un zip. BMM lit \`/install/\` dans le
chemin, saute le sélecteur de dossier, et invite l'utilisateur à suivre un assistant qui
n'existe pas.

Rien n'échoue. L'app atterrit simplement quelque part qu'il n'a pas choisi. Servez le fichier
depuis un chemin sans ces deux mots et le parcours archive revient.
:::

## Omis n'est pas vide

Le flux comble les trous au moment où il est construit. Pas de \`file_type\` et votre zip est
annoncé comme un **EXE** — sur la carte et dans la fenêtre d'installation. Pas de \`category\` et
il est classé en *other*. Pas de \`price\` et il est annoncé *gratuit*.

Rien de tout cela n'échoue. Cela publie une entrée qui affirme des choses que vous n'avez jamais
dites.

## La somme de contrôle est le champ optionnel qui vaut l'effort

\`download.sha256\` est optionnel, et il est réellement vérifié : BMM recalcule l'empreinte
*pendant* le téléchargement et refuse de terminer si elle ne correspond pas — le fichier \`.part\`
n'est jamais renommé.

Elle est aussi visible avant le clic, en petite pastille sur la carte :

:::columns
:::column
:badge[somme publiée]{color="#16a34a"}
Le catalogue publie une empreinte. Ce qui arrive lui est confronté.
:::
:::column
:badge[non vérifiable]{color="#64748b"}
Aucune empreinte. C'est courant et cela ne prouve rien — mais c'est la différence entre deux
entrées qui proposent la même app.
:::
:::

:::tip[Vous n'avez pas à la calculer à la main]
Le formulaire **Créer une app** possède une sonde : donnez-lui l'URL (ou choisissez le fichier
local) et elle remplit la taille et le SHA-256. En \`http\` simple elle le dit franchement, parce
que ce qu'elle a lu est l'empreinte de *ce qui est arrivé* — et en http cela ne dépend pas que
de vous.
:::

## Une entrée sans URL de téléchargement n'est pas une erreur

C'est une omission silencieuse. L'élément est enregistré, sa page s'affiche, et le flux ne le
liste tout simplement pas : les entrées sans téléchargement exploitable sont retirées à la
construction du flux. Si votre app est publiée et n'apparaît pas dans BMM, vérifiez cela avant
tout le reste.

## Une entrée remplie exprès

\`\`\`json
{
  "id": "tag-cleaner",
  "title": "Tag Cleaner",
  "description": "Trouve et fusionne les tags en double d'une bibliothèque de mods.",
  "category": "utility",
  "price": "free",
  "tags": ["tags", "cleanup"],
  "version": "1.4.0",
  "images": { "thumb": "https://exemple.com/tag-cleaner/thumb.png" },
  "download": {
    "url": "https://exemple.com/dl/tag-cleaner-1.4.0.zip",
    "file_type": "zip",
    "size": 4194304,
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  }
}
\`\`\`

Chaque champ y est un champ que vous avez écrit. C'est tout l'intérêt de l'exercice.

:::card{title="Tous les champs, toujours à jour" href=/docs/app-catalog icon=book}
La référence — obligatoire, optionnel, et les valeurs exactes acceptées — est dans la
documentation. Cet article parle de ce qui se passe une fois qu'elle est remplie.
:::`,
  },
  'guide-plugin-catalog': {
    title: 'Deux sommes de contrôle, trois verdicts : comment un .bmmplug est jugé',
    excerpt: 'La plupart des paquets déclarés invalides n\'ont pas été altérés. Voici ce que les deux empreintes répondent vraiment, et le verdict auquel personne ne s\'attend.',
    body: `:badge[Catalogue]{color="#2563eb"} :badge[Plugins]{color="#7c3aed"}

Un \`.bmmplug\` porte deux sommes de contrôle, et elles répondent à deux questions différentes.
La plupart des paquets déclarés **invalides** n'ont violé ni l'une ni l'autre.

::toc[Sur cette page]

## Deux questions, deux empreintes

Le \`sha256\` de l'entrée de catalogue couvre **tout le paquet** : *est-ce bien les octets
attendus ?* À l'intérieur du ZIP, \`checksums.json\` couvre **chaque fichier** : *chaque fichier
est-il bien celui qu'il prétend être ?*

Modifier un fichier change son empreinte et celle du paquet en même temps : un paquet altéré ne
peut pas être valide pendant que sa liste interne l'est encore. C'est tout le modèle
d'intégrité, et il est petit volontairement.

## Le verdict auquel personne ne s'attend : \`unlisted_files\`

La validité n'est pas « tout ce qui est listé correspond ». C'est **« tout ce qui est listé
correspond *et* tout ce qui est présent est listé »**. Un fichier du ZIP que \`checksums.json\`
ne mentionne pas suffit à rendre le paquet invalide, sans la moindre non-concordance.

:::danger[La cause habituelle est un README]
Générez \`checksums.json\`, puis déposez un \`README.md\` ou un \`LICENSE\` à côté, puis zippez.
Le paquet est désormais invalide — et l'échec ressemble à une falsification alors que c'est du
rangement.

Régénérez la liste **en dernier**, quand tous les fichiers sont en place.
:::

\`checksums.json\` est la seule exception : il ne peut pas lister sa propre empreinte, et il est
ignoré.

## Invalide et non vérifié ne sont pas la même pastille

Il existe un troisième état, et il existe parce que les deux premiers servaient à dire quelque
chose qu'ils ne veulent pas dire.

:::columns
:::column
**Invalide** — le paquet a été récupéré et il ne passe pas. Un vrai défaut d'intégrité. BMM
recommande de ne pas l'installer.
:::
:::column
**Non vérifié** — le paquet n'a pas pu être récupéré du tout : pas encore hébergé, lien mort,
adresse que le récupérateur refuse. On ne sait rien de son contenu.
:::
:::

Un plugin sain qui n'est simplement pas encore téléversé n'est pas un plugin altéré : il n'est
donc pas marqué en rouge. La raison est enregistrée dans les deux cas, et la modération la voit.

## Ce que les sommes de contrôle ne disent pas

Elles ne disent pas qui a fabriqué le paquet. N'importe qui peut réempaqueter un plugin et
recalculer honnêtement les empreintes : le résultat est une archive parfaitement valide
contenant le travail de quelqu'un d'autre.

C'est une autre question, et elle demande une autre réponse : un paquet **écrit par BMM
lui-même** porte \`bmm_signature.json\`, une signature ed25519 sur les entrées. L'intégrité dit
que la boîte n'a pas été ouverte en route. La signature dit qui l'a fermée.

## Demandez les permissions que vous utilisez

Un plugin demande des capacités dans l'ensemble réel de permissions de l'API — \`mods.write\`,
\`profiles.write\`, \`catalog.read\`, \`app.write\` et les autres — pas des mots libres comme
« réseau » ou « fichiers ». **L'utilisateur voit la liste et accorde chaque ligne.**

Tout demander n'est pas un défaut prudent : c'est la phrase que quelqu'un lit juste avant de
décider s'il vous fait confiance.

:::card{title="La structure complète du paquet" href=/docs/plugin-catalog icon=book}
Champs du manifeste, champs de l'entrée, et la disposition exacte du ZIP — dans la documentation.
:::

:::card{title="La liste des permissions" href=/docs/api-reference icon=code}
Toutes les capacités qu'un plugin peut demander, et ce qu'elles ouvrent.
:::`,
  },
  'guide-preset-catalog': {
    title: 'Le mot « preset » désigne deux choses différentes',
    excerpt: 'Pour BSM, le preset est le fichier. Pour BMM, il pointe vers un fichier. Ils partagent un nom, un type de catalogue et un flux — et rien d\'autre.',
    body: `:badge[Catalogue]{color="#2563eb"} :badge[BSM]{color="#db2777"} :badge[BMM]{color="#2563eb"}

**« Preset » désigne ici deux choses différentes**, et savoir laquelle vous publiez, c'est
l'essentiel du travail. Elles partagent un nom, un type de catalogue et un flux — et ce ne sont
pas le même document.

::toc[Sur cette page]

## BSM : le preset *est* le fichier

Un preset BSM est un **unique document JSON dont les métadonnées sont l'élément**. Pas de ZIP,
pas de manifeste à côté, pas de dossier : \`name\`, \`version\` et \`assetPaths\` vivent dans le
fichier publié.

C'est pour cela qu'un preset BSM se partage en le collant dans une conversation, et pour cela
que la plateforme valide son contenu à la soumission — elle *a* le contenu.

## BMM : le preset pointe vers un fichier

Un preset BMM est une **automatisation de tâches planifiées**, un \`.bmmpa\`. L'entrée de
catalogue ne le porte pas ; elle *pointe* vers lui avec une URL de téléchargement, exactement
comme tous les autres types de catalogue BMM.

Rien n'est validé au-delà de « il y a une adresse à récupérer ». BMM signe et inspecte
l'automatisation lui-même, et un second avis rendu par un serveur incapable d'ouvrir le fichier
serait une supposition déguisée en vérification.

:::warning[Ce n'est pas un détail — cela décidait si vous pouviez publier]
Pendant longtemps, le flux émettait déjà la forme BMM tandis que chaque chemin d'*écriture*
appliquait le schéma BSM à la soumission, quel que soit le projet. Une automatisation BMM ne
pouvait donc pas être soumise du tout : elle était rejetée comme preset invalide faute de
\`assetPaths\`, un champ qu'elle n'est pas censée avoir.

Chaque moitié était cohérente avec elle-même, et c'est exactement pour cela que rien n'échouait
bruyamment. Choisissez le bon **projet** dans le formulaire et les bonnes règles suivent.
:::

## \`assetPaths\` est le preset ; le reste est de l'étiquetage

Un tableau de chaînes, chacune un chemin d'asset tel que BSM le connaît. Il nomme ce que le
preset touche — les valeurs, elles, vivent dans BSM. Ce fichier nomme les cibles.

:::danger[Un tableau vide se publie sans problème]
\`"assetPaths": []\` est un preset valide. Il se téléverse, il apparaît au catalogue, quelqu'un
l'installe, et il ne pilote rien.

C'est le seul échec que personne ne signale, parce que de l'extérieur il a l'air d'avoir marché.
:::

## Les champs supplémentaires survivent

Le validateur laisse passer ce qu'il ne reconnaît pas : un champ que BSM ajoutera plus tard ne
rendra pas vos presets invalides rétroactivement. N'y lisez pas plus que cela — seuls les champs
documentés sont interprétés ici.

## Publier l'un ou l'autre

**Tableau de bord → Soumettre du contenu**, et le projet décide du reste : **BSM** demande le
JSON, **BMM** demande un lien vers le \`.bmmpa\`.

Sur la page catalogue, les presets se téléchargent un par un ou par lot, et se trient par
*populaire* (tout temps ou ce mois-ci), *récent* ou *le plus vu*. Chaque téléchargement compte
dans les statistiques de celui qui a publié.

:::card{title="Le format de preset BSM, champ par champ" href=/docs/preset-catalog icon=book}
Champs obligatoires et optionnels, limites, et un fichier complet qui fonctionne.
:::`,
  },
  'guide-theme-catalog': {
    title: 'L\'id de votre thème est une adresse, pas une étiquette',
    excerpt: 'Ce qui survit au ZIP, pourquoi deux thèmes peuvent silencieusement n\'en faire qu\'un, et le champ du manifeste que tout le monde écrit de travers.',
    body: `:badge[Catalogue]{color="#2563eb"} :badge[Thèmes]{color="#d97706"}

Un \`.bmmtheme\` est un ZIP contenant un \`theme.json\`. L'intéressant est de l'autre côté :
**l'\`id\` de ce manifeste n'est pas une étiquette, c'est une adresse.**

::toc[Sur cette page]

## \`id\` est l'endroit où vit le thème

À l'import, BMM lit \`theme.json\`, prend son \`id\`, et installe le thème dans un dossier de ce
nom sous le répertoire des thèmes de l'utilisateur.

:::danger[Deux thèmes avec le même id sont un seul thème]
Il n'y a ni détection de collision ni avertissement. Le second import écrase le premier, sur la
machine d'un inconnu, et le seul symptôme est que son thème a changé tout seul.

\`dark\` et \`blue\` ne sont pas des ids. \`votrenom-minuit\` en est un. Prenez quelque chose que
personne d'autre ne prendra.
:::

Un manifeste sans \`id\` est la seule erreur dure : l'import s'arrête sur \`missing id\`.

## Trois chemins survivent au ZIP

L'importeur copie \`theme.json\`, tout ce qui est sous \`assets/\`, et tout ce qui est sous
\`fonts/\`.

**Tout le reste de l'archive est abandonné en silence.** Un \`LICENSE\` ou une capture d'écran
posés à la racine du ZIP n'atteignent pas le disque de l'utilisateur — sans erreur : ils ne sont
simplement plus là ensuite. Mettez sous \`assets/\` ce qui doit survivre.

Les entrées qui tentent de sortir de la racine de l'archive sont ignorées d'emblée : un chemin
comme \`assets/../../evil\` n'est jamais écrit.

## Le champ du manifeste s'appelle \`vars\`

Cela mérite d'être dit clairement, parce que c'est facile à rater de mémoire : la table des
propriétés personnalisées \`--bmm-*\` s'appelle **\`vars\`**. Un thème qui l'écrit \`tokens\` se
charge sans se plaindre et ne change rien.

Le reste du manifeste est optionnel et additif : \`mode\` (\`dark\` ou \`light\`), \`fonts\`,
\`assets\`, \`global_css\`, \`pages\` pour du CSS par vue, \`element_overrides\` pour des
propriétés par sélecteur, et \`html_swaps\`.

## Exportez-le, ne l'écrivez pas

L'**éditeur de thèmes** intégré exporte un paquet valide en une étape, et il fait trois choses
qu'il faudrait sinon penser à faire :

:::steps
:::step[Il parcourt tout le dossier du thème]
Assets et polices suivent, aux bons chemins. Le zip fait à la main est l'endroit où les fichiers
disparaissent.
:::
:::step[Il écrit \`bmm_signature.json\`]
Une signature sur chaque entrée de l'archive — collectée avant l'écriture du ZIP, depuis la même
liste que celle utilisée pour écrire, de sorte que « ce qui a été signé » et « ce qui a été
écrit » ne peuvent pas diverger.
:::
:::step[Il nomme le fichier d'après le thème]
\`votre-id-de-theme.bmmtheme\`, qui est aussi le dossier où il atterrira.
:::
:::

Puis publiez : **Tableau de bord → Soumettre du contenu**, projet **BMM**, type **Thème**.
Installer un thème n'écrit que des blocs de style — cela ne touche jamais aux fichiers sources,
et c'est réversible depuis le même écran.

:::card{title="Le paquet et l'entrée de catalogue" href=/docs/theme-catalog icon=book}
L'entrée du flux \`themes\` et la disposition du \`.bmmtheme\`, dans la documentation.
:::

:::card{title="Thématiser depuis BMM" href=/docs/themes icon=palette}
La surface de tokens, l'éditeur, et ce que le runtime fait pour un thème incomplet.
:::`,
  },
};
