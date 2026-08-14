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
    answer: 'Almost always two profiles pointing at the **same game folder**. Both deploy into the same place and neither knows what the other left behind, so files survive a profile switch. BMM warns about this when you set it up — it calls it "a major source of human error". Give each profile its own folder.',
    answerFr: 'Presque toujours deux profils qui pointent vers le **même dossier de jeu**. Les deux se déploient au même endroit et aucun ne sait ce que l\'autre a laissé, donc des fichiers survivent au changement de profil. BMM prévient à la configuration — il parle d\'« une source majeure d\'erreur humaine ». Donne à chaque profil son propre dossier.',
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
    answer: 'They\'re **not officially reviewed** — treat them like any other program you install. But they are **bounded**: a plugin acts through the API with its own token and only does what you\'ve granted it (`mods.write`, `profiles.write`, …). Review those grants in **Plugins → Permissions**.',
    answerFr: 'Ils **ne sont pas officiellement relus** — traite-les comme n\'importe quel programme installé. Mais ils sont **bornés** : un plugin agit via l\'API avec son propre token et ne fait que ce que tu lui as accordé (`mods.write`, `profiles.write`…). Relis ces autorisations dans **Plugins → Permissions**.',
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
