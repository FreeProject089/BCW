// FAQ content — the questions people actually ask, grounded in how BMM/BetterCommunity really
// behave (see seed-docs.mjs and the app's own strings, not invented). Idempotent: upserts by a
// stable slug-in-question hash so re-running refreshes rather than duplicates. There was no FAQ
// seeder before this; the admin FAQ page and /faq were empty on a fresh install.
// Run: `docker compose exec api node src/seed-faq.mjs`.
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

// Each: question (EN) + answer (EN markdown) + answerFr, a category, and an order.
const FAQ = [
  // ── General ──
  {
    category: 'General', order: 10,
    categoryFr: 'Général',
    question: 'What is BetterCommunity?',
    questionFr: 'C’est quoi BetterCommunity ?',
    answer: 'The web home for the Better\\* projects — **BMM** (mods) and **BSM** (sound presets). It hosts the catalogs BMM installs from, Server Repos, community blogs, and your account. The desktop apps talk to it; you don\'t have to.',
    answerFr: 'La maison web des projets Better\\* — **BMM** (mods) et **BSM** (presets sonores). Elle héberge les catalogues d\'où BMM installe, les Dépôts Serveur, les blogs communautaires et ton compte. Les apps de bureau lui parlent ; toi, tu n\'es pas obligé.',
  },
  {
    category: 'General', order: 20,
    categoryFr: 'Général',
    question: 'Do I need an account to download mods?',
    questionFr: 'Faut-il un compte pour télécharger des mods ?',
    answer: 'Only when the source asks for it. A public repo or catalog with no access rules downloads without an account. If the owner set a whitelist, a ban list, or a creator/Discord/BetterCommunity restriction, you have to be signed in so it can check you — otherwise no login is needed.',
    answerFr: 'Seulement si la source l\'exige. Un dépôt ou catalogue public sans règle d\'accès se télécharge sans compte. Si le propriétaire a mis une whitelist, une banlist, ou une restriction créateur/Discord/BetterCommunity, il faut être connecté pour qu\'il puisse te vérifier — sinon aucune connexion n\'est requise.',
  },
  // ── Using BMM ──
  {
    category: 'Using BMM', order: 100,
    categoryFr: 'Utiliser BMM',
    question: 'What\'s the difference between a profile and a modpack?',
    questionFr: 'Quelle différence entre un profil et un modpack ?',
    answer: 'A **profile** answers "which mods are on, in what order, for this game" — it\'s your setup. A **modpack** is a named bundle of mods you toggle on and off in one click, and it can even mix mods from different profiles. Rule of thumb: a profile is *your* configuration; a modpack is *a group of mods* meant to travel together.',
    answerFr: 'Un **profil** répond à « quels mods sont actifs, dans quel ordre, pour ce jeu » — c\'est ta configuration. Un **modpack** est un lot de mods nommé que tu actives/désactives en un clic, et il peut même mélanger des mods de profils différents. En bref : un profil est *ta* config ; un modpack est *un groupe de mods* fait pour voyager ensemble.',
  },
  {
    category: 'Using BMM', order: 110,
    categoryFr: 'Utiliser BMM',
    question: 'I disabled a mod but it\'s still active in-game — why?',
    questionFr: 'J’ai désactivé un mod mais il est toujours actif en jeu — pourquoi ?',
    answer: 'Almost always two profiles pointing at the **same game folder**. Both deploy into the same place and neither knows what the other left behind, so files survive a profile switch. BMM warns about this when you set it up — it calls it "a major source of human error". \n\n:::warning[Give each profile its own folder]\nTwo profiles sharing one game folder is the single most common cause of this. Point them at separate folders and it cannot happen.\n:::',
    answerFr: 'Presque toujours deux profils qui pointent vers le **même dossier de jeu**. Les deux se déploient au même endroit et aucun ne sait ce que l\'autre a laissé, donc des fichiers survivent au changement de profil. BMM prévient à la configuration — il parle d\'« une source majeure d\'erreur humaine ». \n\n:::warning[Donne à chaque profil son propre dossier]\nDeux profils qui partagent un dossier de jeu sont de loin la première cause. Sépare les dossiers et le problème ne peut plus se produire.\n:::',
  },
  {
    category: 'Using BMM', order: 120,
    categoryFr: 'Utiliser BMM',
    question: 'I installed a mod but the game acts like it isn\'t there.',
    questionFr: 'J’ai installé un mod mais le jeu fait comme s’il n’existait pas.',
    answer: 'Nine times out of ten it\'s packaging, not BMM: the archive has one folder too many, so the game looks for `Data/` and finds `MyMod-v3/Data/`. Open the **Mapper**, run the **Structure Diagnostic** to see the final path, and remap before applying.',
    answerFr: 'Neuf fois sur dix c\'est l\'empaquetage, pas BMM : l\'archive a un dossier de trop, donc le jeu cherche `Data/` et trouve `MonMod-v3/Data/`. Ouvre le **Mapper**, lance le **Diagnostic de structure** pour voir le chemin final, et remappe avant d\'appliquer.',
  },
  {
    category: 'Using BMM', order: 130,
    categoryFr: 'Utiliser BMM',
    question: 'Two mods conflict — what happens?',
    questionFr: 'Deux mods entrent en conflit — que se passe-t-il ?',
    answer: 'They ship the same file, so **the last one activated wins** and overwrites the other. BMM detects this before you commit, lists the exact overlapping files, and lets you set the activation order — the order *is* the resolution.',
    answerFr: 'Ils livrent le même fichier, donc **le dernier activé gagne** et écrase l\'autre. BMM le détecte avant que tu valides, liste les fichiers qui se chevauchent, et te laisse fixer l\'ordre d\'activation — l\'ordre *est* la résolution.',
  },
  {
    category: 'Using BMM', order: 140,
    categoryFr: 'Utiliser BMM',
    question: 'BMM says a mod has no update, but I know it does.',
    questionFr: 'BMM dit qu’un mod n’a pas de mise à jour, alors que si.',
    answer: 'If the mod\'s source is a **direct download**, BMM is being honest: a raw file URL has no version number, so there\'s nothing to compare. Link the mod to a **Server Repo** that publishes versions for real update detection, or use the direct re-download.',
    answerFr: 'Si la source du mod est un **téléchargement direct**, BMM est honnête : l\'URL d\'un fichier brut n\'a pas de numéro de version, il n\'y a donc rien à comparer. Lie le mod à un **Dépôt Serveur** qui publie des versions pour une vraie détection, ou utilise le retéléchargement direct.',
  },
  {
    category: 'Using BMM', order: 150,
    categoryFr: 'Utiliser BMM',
    question: 'Are community plugins safe?',
    questionFr: 'Les plugins communautaires sont-ils sûrs ?',
    answer: 'They\'re **not officially reviewed** — treat them like any other program you install. But they are **bounded**: a plugin acts through the API with its own token and only does what you\'ve granted it (`mods.write`, `profiles.write`, …). Review those grants in **Plugins → Permissions**. A `.bmmplug` also carries a signature over *every* file it contains — **Inspect a BMM file** tells you whether the one you downloaded is still the one its author signed.',
    answerFr: 'Ils **ne sont pas officiellement relus** — traite-les comme n\'importe quel programme installé. Mais ils sont **bornés** : un plugin agit via l\'API avec son propre token et ne fait que ce que tu lui as accordé (`mods.write`, `profiles.write`…). Relis ces autorisations dans **Plugins → Permissions**. Un `.bmmplug` porte aussi une signature sur *chacun* des fichiers qu\'il contient — **Inspecter un fichier BMM** te dit si celui que tu as téléchargé est toujours celui que son auteur a signé.',
  },
  {
    category: 'Using BMM', order: 155,
    categoryFr: 'Utiliser BMM',
    question: 'Can I tell whether a BMM file has been tampered with?',
    questionFr: 'Puis-je savoir si un fichier BMM a été modifié ?',
    answer: 'Yes — drop it into **Inspect a BMM file** on this site. BMM signs everything it writes with the ed25519 key behind your creator id, and the check runs **in your browser**: the file is never uploaded. JSON documents (`.mm`, `.bmmpa`, `.bmmnav`, modpacks, the `.DATABMM` manifest) carry a `bmm_signature` block; ZIP formats (`.bmmplug`, `.bmmtheme`) carry a `bmm_signature.json` entry listing every other file and its SHA-256 — so swapping a script beside an untouched manifest is caught too.\n\nFour verdicts, and the difference matters: **valid** (unchanged since that key signed it), **tampered** (it changed, or the block was lifted from another file), **unsigned** (nothing was claimed — normal for anything written before signing existed, and for files other tools produce), **malformed** (there is a block but it is not one). Note what it does *not* say: `author_id` is a public key, not an identity. It proves two files came from the same BMM install — what that is worth is your call.',
    answerFr: 'Oui — dépose-le dans **Inspecter un fichier BMM** sur ce site. BMM signe tout ce qu\'il écrit avec la clé ed25519 derrière ton identifiant créateur, et la vérification tourne **dans ton navigateur** : le fichier n\'est jamais envoyé. Les documents JSON (`.mm`, `.bmmpa`, `.bmmnav`, modpacks, le manifeste `.DATABMM`) portent un bloc `bmm_signature` ; les formats ZIP (`.bmmplug`, `.bmmtheme`) portent une entrée `bmm_signature.json` qui liste chaque autre fichier et son SHA-256 — échanger un script à côté d\'un manifeste intact est donc détecté aussi.\n\nQuatre verdicts, et la nuance compte : **valide** (inchangé depuis la signature), **altéré** (il a changé, ou le bloc vient d\'un autre fichier), **non signé** (rien n\'est revendiqué — normal pour tout ce qui a été écrit avant l\'existence des signatures, et pour les fichiers produits par d\'autres outils), **malformé** (il y a un bloc, mais ce n\'en est pas un). Note ce que ça ne dit *pas* : `author_id` est une clé publique, pas une identité. Ça prouve que deux fichiers viennent de la même installation de BMM — ce que ça vaut, c\'est à toi d\'en juger.',
  },
  // ── Publishing & hosting ──
  {
    category: 'Publishing & hosting', order: 200,
    categoryFr: 'Publier et héberger',
    question: 'How do I publish content to a catalog?',
    questionFr: 'Comment publier du contenu dans un catalogue ?',
    answer: 'Build a catalog JSON (app, plugin, theme or preset), host it — on GitHub, or with us — and add its raw URL as a source. The docs have a page per catalog type with the exact fields and checksums. BMM users then install from it in one click.',
    answerFr: 'Construis un JSON de catalogue (app, plugin, thème ou preset), héberge-le — sur GitHub, ou chez nous — et ajoute son URL brute comme source. La doc a une page par type de catalogue avec les champs exacts et les sommes de contrôle. Les utilisateurs de BMM installent ensuite en un clic.',
  },
  {
    category: 'Publishing & hosting', order: 210,
    categoryFr: 'Publier et héberger',
    question: 'Is Server Repo hosting a recurring charge?',
    questionFr: 'L’hébergement de Dépôt Serveur est-il un abonnement ?',
    answer: 'A **repo** is **prepaid per term** — you pick a size, and there\'s no recurring charge to cancel; deleting it just stops future renewals. A hosted **catalog** subscription is different — it *is* recurring. A deleted repo is kept for 72 hours before its files go, so you can undo.',
    answerFr: 'Un **dépôt** est **prépayé par terme** — tu choisis une taille, et il n\'y a pas d\'abonnement à résilier ; le supprimer arrête juste les renouvellements. Un abonnement de **catalogue** hébergé, lui, *est* récurrent. Un dépôt supprimé est gardé 72 heures avant que ses fichiers partent, tu peux donc annuler.',
  },
  {
    category: 'Publishing & hosting', order: 220,
    categoryFr: 'Publier et héberger',
    question: 'Can I host my own repo instead of paying?',
    questionFr: 'Puis-je héberger mon dépôt moi-même au lieu de payer ?',
    answer: 'Yes — point BMM at your own self-hosted repo URL and it works the same, with no hosting fee. Our hosting exists for when you want a stable managed URL and access controls (whitelist, bans, upload limits) without running a server yourself.',
    answerFr: 'Oui — pointe BMM vers l\'URL de ton propre dépôt auto-hébergé et ça marche pareil, sans frais. Notre hébergement existe pour quand tu veux une URL managée stable et des contrôles d\'accès (whitelist, bans, limites d\'upload) sans gérer de serveur toi-même.',
  },
  // ── Your account ──
  {
    category: 'Your account', order: 200,
    categoryFr: 'Ton compte',
    question: 'My account was suspended — what can I still do?',
    questionFr: 'Mon compte est suspendu — que puis-je encore faire ?',
    answer: 'You can still **sign in**, read your account, see the reason and the end date, download your invoices and cancel a subscription. What stops is the **service**: your API keys are refused, your hosted repos and catalog items are taken offline, and paid subscriptions are cancelled. The distinction is deliberate — being unable to sign in would also mean being unable to find out why, or to stop paying.',
    answerFr: 'Tu peux toujours **te connecter**, consulter ton compte, voir le motif et la date de fin, télécharger tes factures et résilier un abonnement. Ce qui s\'arrête, c\'est le **service** : tes clés API sont refusées, tes dépôts et éléments de catalogue hébergés sont retirés, et les abonnements payants sont annulés. La distinction est voulue : ne plus pouvoir se connecter, ce serait aussi ne plus pouvoir savoir pourquoi, ni arrêter de payer.',
  },
  {
    category: 'Your account', order: 210,
    categoryFr: 'Ton compte',
    question: 'And if I am banned?',
    questionFr: 'Et si je suis banni ?',
    answer: 'Everything stops, including access to the account. No new session is issued and any session already open stops working — a ban that only blocked the login form would leave whoever was already signed in exactly where they were. Subscriptions are cancelled and hosted content goes offline. A ban has no end date unless one was set.',
    answerFr: 'Tout s\'arrête, y compris l\'accès au compte. Aucune nouvelle session n\'est délivrée et toute session déjà ouverte cesse de fonctionner — un ban qui ne bloquerait que le formulaire de connexion laisserait la personne déjà connectée exactement là où elle était. Les abonnements sont annulés et le contenu hébergé passe hors ligne. Un ban n\'a pas de date de fin, sauf si une a été fixée.',
  },
  {
    category: 'Your account', order: 220,
    categoryFr: 'Ton compte',
    question: 'How do I close my account, and can I change my mind?',
    questionFr: 'Comment fermer mon compte, et puis-je revenir en arrière ?',
    answer: 'Profile → close the account. You get **30 days** to change your mind, and a single link that cancels the whole thing. During those 30 days your content is **suspended, not deleted** — a grace month is only a grace month if what it protects is still there at the end of it. Any pending ownership transfer you had offered is withdrawn, and your invoices are e-mailed to you with the notice, because "download them before you go" is advice nobody reads in time.',
    answerFr: 'Profil → fermer le compte. Tu as **30 jours** pour changer d\'avis, et un seul lien qui annule tout. Pendant ces 30 jours ton contenu est **suspendu, pas supprimé** — un mois de grâce n\'en est un que si ce qu\'il protège est encore là à la fin. Tout transfert de propriété que tu avais proposé est retiré, et tes factures te sont envoyées par mail avec l\'avis, parce que « télécharge-les avant de partir » est un conseil que personne ne lit à temps.',
  },
  {
    category: 'Your account', order: 230,
    categoryFr: 'Ton compte',
    question: 'Can I stop getting certain notifications?',
    questionFr: 'Puis-je ne plus recevoir certaines notifications ?',
    answer: 'Yes — **/notifications** has a switch per category: hosting & billing, your repos, your catalog items, reports & support, commissions, promotions, site news & events. Switching one off stops those notifications being **created**, not merely hidden, so turning it back on shows nothing from the meantime. One category cannot be switched off: account & security. An account able to silence its own ban notice finds out too late.',
    answerFr: 'Oui — **/notifications** propose un interrupteur par catégorie : hébergement & facturation, tes dépôts, tes éléments de catalogue, signalements & support, commandes sur mesure, promotions, actualités & événements. En couper une empêche ces notifications d\'être **créées**, pas seulement de s\'afficher : les rallumer ne fait donc rien réapparaître. Une catégorie ne se coupe pas : compte & sécurité. Un compte capable de faire taire son propre avis de bannissement l\'apprend trop tard.',
  },
  // ── Developers ──
  {
    category: 'Developers', order: 300,
    categoryFr: 'Développeurs',
    question: 'Do I need an API key or "Sign in with BetterCommunity"?',
    questionFr: 'Me faut-il une clé API ou « Se connecter avec BetterCommunity » ?',
    answer: 'It depends who your program acts as. A **key** acts as *you* and needs nobody\'s permission — which is why it can only ever reach your own data. Use it for a script, a sync job, a bot you run. **Sign in with BetterCommunity** is for anything with its own users: they authorise it, and you never touch their password. Both live at **/dev**.',
    answerFr: 'Ça dépend de qui ton programme agit au nom. Une **clé** agit en *ton* nom et n\'a besoin de la permission de personne — c\'est pourquoi elle ne peut atteindre que tes propres données. À utiliser pour un script, une synchro, un bot que tu fais tourner. **Se connecter avec BetterCommunity** sert à tout ce qui a ses propres utilisateurs : ce sont eux qui autorisent, et tu ne touches jamais à leur mot de passe. Les deux sont sur **/dev**.',
  },
  {
    category: 'Developers', order: 310,
    categoryFr: 'Développeurs',
    question: 'Can I try a call without changing anything?',
    questionFr: 'Puis-je essayer un appel sans rien modifier ?',
    answer: 'Yes. Send `X-BCW-Sandbox: 1` on a write — or use the console at **/dev**, where it is on by default. Your key is authenticated and the scope is checked for real, then nothing is written. Reads are never simulated: a `GET` changes nothing anyway, and answering with invented data would make the console useless for what it is for.',
    answerFr: 'Oui. Envoie `X-BCW-Sandbox: 1` sur une écriture — ou utilise la console de **/dev**, où c\'est actif par défaut. Ta clé est authentifiée et le scope vérifié pour de vrai, puis rien n\'est écrit. Les lectures ne sont jamais simulées : un `GET` ne change rien de toute façon, et répondre avec des données inventées rendrait la console inutile pour ce à quoi elle sert.',
  },
  {
    category: 'Developers', order: 320,
    categoryFr: 'Développeurs',
    question: 'My key stopped working — why?',
    questionFr: 'Ma clé ne marche plus — pourquoi ?',
    answer: 'Read the body. `insufficient_scope` means the key is fine but lacks that permission — it tells you which one. `invalid_key` is the single answer for unknown, revoked *and* expired, on purpose: someone probing keys must not learn that one of them was ever real. `account_suspended` means the account behind the key is under sanction, not the key. And a deleted key is really deleted — there is no un-deleting it, only minting a new one.',
    answerFr: 'Lis le corps de la réponse. `insufficient_scope` : la clé est bonne mais n\'a pas cette permission — il te dit laquelle. `invalid_key` est la réponse unique pour inconnue, révoquée *et* expirée, volontairement : quelqu\'un qui teste des clés ne doit pas apprendre que l\'une d\'elles a existé. `account_suspended` veut dire que le compte derrière la clé est sous sanction, pas la clé. Et une clé supprimée l\'est vraiment : on n\'annule pas, on en crée une nouvelle.',
  },
  {
    category: 'Publishing & hosting', order: 330,
    categoryFr: 'Publier et héberger',
    question: 'What happens to my content when a hosting term ends?',
    questionFr: 'Qu\'arrive-t-il à mon contenu à la fin d\'un terme d\'hébergement ?',
    answer: 'You get one warning per term before it runs out. If it ends without renewal, the pool shrinks by that subscription\'s share and whatever no longer fits is **suspended** — repos stop serving, catalog items stop being listed — with a **72-hour** window before anything is deleted. Renewing inside the window restores all of it. If the pool is fed by several subscriptions and only one ends, everything that still fits stays online.',
    answerFr: 'Tu reçois un avertissement par terme avant l\'échéance. S\'il se termine sans renouvellement, le pool rétrécit de la part de cet abonnement et ce qui ne rentre plus est **suspendu** — les dépôts cessent de servir, les éléments de catalogue de s\'afficher — avec **72 heures** avant toute suppression. Renouveler dans cette fenêtre restaure tout. Si le pool est alimenté par plusieurs abonnements et qu\'un seul se termine, tout ce qui tient encore reste en ligne.',
  },

  {
    category: 'Developers', order: 330,
    categoryFr: 'Développeurs',
    question: 'How do I get told when something changes, without polling?',
    questionFr: 'Comment être prévenu d\'un changement sans interroger en boucle ?',
    answer: 'Register a webhook at **/dev/config**. Pick the events, keep the signing secret you are shown once, and answer 2xx within ten seconds. Every delivery is signed — HMAC-SHA256 over `timestamp + "." + body` — and you should reject anything whose timestamp is more than a few minutes old, or somebody who saw one delivery can replay it at you for ever. Failed deliveries retry from one minute to ten hours, and any of them can be replayed by hand once your receiver is fixed.',
    answerFr: 'Enregistre un webhook sur **/dev/config**. Choisis les événements, garde la clé de signature affichée une seule fois, et réponds 2xx en moins de dix secondes. Chaque livraison est signée — HMAC-SHA256 sur `timestamp + "." + corps` — et tu devrais rejeter tout horodatage vieux de plus de quelques minutes, sinon quiconque a vu une livraison peut te la rejouer indéfiniment. Les échecs sont réessayés d\'une minute à dix heures, et chacun peut être rejoué à la main une fois ton récepteur réparé.',
  },
  {
    category: 'Developers', order: 340,
    categoryFr: 'Développeurs',
    question: 'How do I test writes without touching my real data?',
    questionFr: 'Comment tester des écritures sans toucher à mes vraies données ?',
    answer: 'Two ways. Send `X-BCW-Sandbox: 1` on the call, or — better — tick **test key** when you create the key: every write it makes is simulated, with no header to remember. The header is opt-in per request, and the once you forget it you have written to your real account. Test mode is fixed at creation and never toggled, so a key your script is holding cannot change meaning underneath it.',
    answerFr: 'Deux façons. Envoie `X-BCW-Sandbox: 1` sur l\'appel, ou — mieux — coche **clé de test** à la création : toutes ses écritures sont simulées, sans aucun en-tête à retenir. L\'en-tête est opt-in par requête, et la fois où tu l\'oublies tu as écrit dans ton vrai compte. Le mode test est fixé à la création et jamais modifiable : une clé que ton script tient déjà ne peut pas changer de sens sous lui.',
  },
  {
    category: 'Your account', order: 240,
    categoryFr: 'Ton compte',
    question: 'What happens at the end of a suspension?',
    questionFr: 'Que se passe-t-il à la fin d\'une suspension ?',
    answer: 'Your account goes active on its own, and your content comes back **the way it was** — a repo that was offline before the sanction returns offline, not online. You get an e-mail and a notification quoting the reference. Subscriptions are the one thing not restored: the ones cancelled were cancelled at the payment provider, and taking one out again on your behalf is not ours to do — the e-mail lists them with a link to Billing so it is one click. The same applies to a ban with an end date.',
    answerFr: 'Ton compte redevient actif tout seul, et ton contenu revient **tel qu\'il était** — un dépôt qui était hors ligne avant la sanction revient hors ligne, pas en ligne. Tu reçois un e-mail et une notification citant la référence. Les abonnements sont la seule chose non restaurée : ceux qui ont été annulés l\'ont été chez le prestataire de paiement, et en reprendre un à ta place ne nous appartient pas — le mail les liste avec un lien vers la facturation, donc c\'est un clic. Idem pour un bannissement avec date de fin.',
  },

  // ── The reader-facing half of a mechanism the docs already describe ──
  //
  // server-repos covers locking a repo to a key from the OWNER's side: how to add one, what
  // the proof header carries, why the answer is 401 and not 403. Nobody had written the other
  // side of it — the person BMM has just asked for a password, who does not know whether that
  // is normal, whether they typed it wrong, or whether the thing is broken. That reader is the
  // whole audience of a FAQ.
  {
    category: 'Using BMM', order: 160,
    categoryFr: 'Utiliser BMM',
    question: 'BMM is asking me for a password for a repo or a catalog.',
    questionFr: 'BMM me demande un mot de passe pour un dépôt ou un catalogue.',
    answer: 'Then its owner set one, and BMM is doing the right thing. A protected source answers **401**, which BMM reads as "there is a credential to supply" rather than as an error — so it asks, once, and remembers the answer **for as long as the app is running**. Nothing is written to disk, which is deliberate: settings end up in backups and crash reports. If you already know a source is protected you can give the password before the first fetch instead of after it fails — every screen that adds a source has a **This source is protected** fold for exactly that.\n\n:::note[A wrong password looks the same as no password]\nBoth answer 401, so you will simply be asked again. The source itself never says which of the two it was — telling a stranger that their guess was close is telling them something they should have to hold the password to learn.\n:::',
    answerFr: 'C\'est que son propriétaire en a mis un, et BMM fait ce qu\'il faut. Une source protégée répond **401**, ce que BMM lit comme « il y a un identifiant à fournir » et non comme une erreur — donc il demande, une fois, et retient la réponse **tant que l\'application tourne**. Rien n\'est écrit sur le disque, et c\'est volontaire : les réglages finissent dans les sauvegardes et les rapports de plantage. Si tu sais déjà qu\'une source est protégée, tu peux donner le mot de passe avant la première requête plutôt qu\'après son échec — chaque écran qui ajoute une source a un volet **Cette source est protégée** pour ça.\n\n:::note[Un mauvais mot de passe ressemble à pas de mot de passe]\nLes deux répondent 401, donc on te redemandera simplement. La source ne dit jamais lequel des deux c\'était — dire à un inconnu que sa tentative était proche, c\'est lui apprendre quelque chose qu\'il devrait détenir le mot de passe pour savoir.\n:::',
  },
  {
    category: 'Using BMM', order: 170,
    categoryFr: 'Utiliser BMM',
    question: 'A repo wants a key, not a password. What is the difference?',
    questionFr: 'Un dépôt veut une clé, pas un mot de passe. Quelle différence ?',
    answer: 'A password is a **shared secret**: whoever has it can sync, and whoever has it can pass it on. That is what you want for a group and exactly the wrong tool for admitting one machine.\n\nA key cannot be handed on. The owner holds your **public** half; your BMM holds the private half and *signs* a short-lived statement on every request. Nothing that crosses the wire can be replayed against another server, and revoking you is deleting one line.\n\nYou set your private half up once, under **Settings → Identity & API → Identity keys** — only the path is stored, and the file is read at the moment a proof is signed. It is not per-source: a proof is addressed to one server, so BMM attaches it to every request and a server that does not require one ignores it. That is why there is no "key for this catalog" box anywhere; being asked which of your sources are protected is a question you would answer wrong once and then not understand.',
    answerFr: 'Un mot de passe est un **secret partagé** : qui l\'a peut synchroniser, et qui l\'a peut le transmettre. Parfait pour un groupe, et exactement le mauvais outil pour n\'admettre qu\'une machine.\n\nUne clé ne se transmet pas. Le propriétaire détient ta moitié **publique** ; ton BMM détient la privée et *signe* une attestation de courte durée à chaque requête. Rien de ce qui passe sur le réseau ne peut être rejoué contre un autre serveur, et te révoquer, c\'est supprimer une ligne.\n\nTu configures ta moitié privée une fois, dans **Réglages → Identité & API → Clés d\'identité** — seul le chemin est stocké, et le fichier n\'est lu qu\'au moment de signer. Ce n\'est pas par source : une preuve s\'adresse à un serveur, donc BMM la joint à toutes les requêtes et un serveur qui n\'en exige pas l\'ignore. D\'où l\'absence de case « clé pour ce catalogue » : demander lesquelles de tes sources sont protégées est une question à laquelle on répond mal une fois, puis qu\'on ne comprend plus.',
  },
  {
    category: 'Using BMM', order: 180,
    categoryFr: 'Utiliser BMM',
    question: 'Can BMM do things on a schedule without me?',
    questionFr: 'BMM peut-il faire des choses tout seul, à intervalle régulier ?',
    answer: 'Yes — that is what **Scheduling & automation** is. A task is a trigger and a list of steps: sync a repo every night at three, check for mod updates when the app starts, run something when a file changes or when BMM itself reports a problem.\n\nTwo things worth knowing before you build one. A task is created **disabled**, so you can read what it does before it can do it. And it can only do what you grant it: running a program, running a script, firing a deeplink, stopping a program and deleting things are five separate permissions, each off until you turn it on, and a step that needs one it was not given fails with a message rather than running.\n\n:::card{title="Automations, and sharing them" href=/docs/bmmscript icon=book}\nThe same task written as text, so it can be read, reviewed and sent to somebody.\n:::',
    answerFr: 'Oui — c\'est le rôle de **Planification & automatisation**. Une tâche, c\'est un déclencheur et une liste d\'étapes : synchroniser un dépôt chaque nuit à trois heures, chercher les mises à jour au démarrage, lancer quelque chose quand un fichier change ou quand BMM signale lui-même un problème.\n\nDeux choses à savoir avant d\'en écrire une. Une tâche est créée **désactivée**, pour que tu puisses lire ce qu\'elle fait avant qu\'elle puisse le faire. Et elle ne peut faire que ce que tu lui accordes : lancer un programme, exécuter un script, déclencher un deeplink, arrêter un programme et supprimer des choses sont cinq permissions distinctes, chacune désactivée tant que tu ne l\'actives pas — et une étape qui en réclame une qu\'elle n\'a pas échoue avec un message au lieu de s\'exécuter.\n\n:::card{title="Les automatisations, et comment les partager" href=/docs/bmmscript icon=book}\nLa même tâche écrite en texte, pour être lue, relue et envoyée à quelqu\'un.\n:::',
  },

  {
    category: 'General', order: 300,
    categoryFr: 'Général',
    question: 'What is the casino, and how do points work?',
    questionFr: 'C’est quoi le casino, et comment marchent les points ?',
    answer: 'The community Discord bot has a `/casino` where you wager **points** on small games (coin flip, dice, slots, roulette, wheel, plinko). Points are earned by being active on the server and are **not** bought with money — the casino is entertainment, not gambling for real stakes. The house edge is taken only from the **profit** of a win, never from your stake, and each game shows its odds before you bet. See [Levels, XP & points](/docs/economy).',
    answerFr: 'Le bot Discord communautaire a un `/casino` où tu mises des **points** sur de petits jeux (pile ou face, dé, machine à sous, roulette, roue, plinko). Les points se gagnent en étant actif sur le serveur et ne s’achètent **pas** avec de l’argent — le casino est un divertissement, pas un jeu d’argent réel. L’avantage de la maison n’est pris que sur le **gain** d’une victoire, jamais sur ta mise, et chaque jeu montre ses cotes avant que tu mises. Voir [Niveaux, XP & points](/docs/economy).',
  },
  {
    category: 'General', order: 310,
    categoryFr: 'Général',
    question: 'How do I earn badges?',
    questionFr: 'Comment gagner des badges ?',
    answer: 'Badges are granted automatically when you hit a milestone — reaching a level, sending a number of messages, publishing items, hosting a repo, linking Discord, enabling 2FA, and so on — or bought in the points shop. They show on your public profile. The exact rules are set by the community admins.',
    answerFr: 'Les badges sont accordés automatiquement quand tu atteins un palier — un niveau, un nombre de messages, des items publiés, un dépôt hébergé, Discord lié, 2FA activée, etc. — ou achetés dans la boutique de points. Ils s’affichent sur ton profil public. Les règles exactes sont fixées par les admins de la communauté.',
  },
  {
    category: 'General', order: 320,
    categoryFr: 'Général',
    question: 'What are the charity pot, promo codes and the newsletter?',
    questionFr: 'C’est quoi la cagnotte solidaire, les codes promo et la newsletter ?',
    answer: 'The **charity pot** on the home page collects a share of eligible revenue plus community donations for an association chosen by a community vote; the final payment is sent manually and shown as proof. **Promo codes** are redeemed on the Hosting page or your dashboard for a discount, free hosting or a storage/boost grant. The **newsletter** is a double-opt-in mailing you can subscribe to (and leave) from the footer; new blog posts can be announced through it.',
    answerFr: 'La **cagnotte solidaire** sur l’accueil récolte une part des revenus éligibles plus les dons de la communauté pour une association choisie par un vote communautaire ; le paiement final est envoyé manuellement et affiché comme preuve. Les **codes promo** se rentrent sur la page Hébergement ou ton tableau de bord pour une remise, de l’hébergement gratuit ou un octroi de stockage/boost. La **newsletter** est un envoi à double opt-in auquel tu t’abonnes (et te désabonnes) depuis le pied de page ; les nouveaux articles de blog peuvent y être annoncés.',
  },
];

// A stable slug from the question so re-runs upsert instead of duplicating. FaqItem has no
// unique text field, so we key on a deterministic slug stored nowhere — instead we clear the
// seeded set by a marker category prefix and re-insert. Simpler: match on (question) which is
// effectively unique here.
const run = async () => {
  let created = 0, updated = 0;
  for (const [i, f] of FAQ.entries()) {
    const existing = await p.faqItem.findFirst({ where: { question: f.question } });
    // questionFr and categoryFr were written by nobody. Every entry below has carried them
    // since the migration that added the columns, and the upsert listed answerFr but not the
    // other two — so a French reader got French answers under English questions, filed under
    // English category headings, with nothing to suggest a translation existed.
    const data = {
      answer: f.answer, answerFr: f.answerFr ?? null,
      category: f.category, categoryFr: f.categoryFr ?? null,
      questionFr: f.questionFr ?? null,
      order: f.order, published: true,
    };
    if (existing) {
      await p.faqItem.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await p.faqItem.create({ data: { question: f.question, ...data, order: f.order ?? i * 10 } });
      created++;
    }
  }
  console.log(`faq seed: ${created} created, ${updated} updated, ${FAQ.length} total.`);
  await p.$disconnect();
};
run().catch((e) => { console.error(e); process.exit(1); });
