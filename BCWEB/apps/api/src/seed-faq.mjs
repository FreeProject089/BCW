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
    question: 'What is BetterCommunity?',
    answer: 'The web home for the Better\\* projects — **BMM** (mods) and **BSM** (sound presets). It hosts the catalogs BMM installs from, Server Repos, community blogs, and your account. The desktop apps talk to it; you don\'t have to.',
    answerFr: 'La maison web des projets Better\\* — **BMM** (mods) et **BSM** (presets sonores). Elle héberge les catalogues d\'où BMM installe, les Dépôts Serveur, les blogs communautaires et ton compte. Les apps de bureau lui parlent ; toi, tu n\'es pas obligé.',
  },
  {
    category: 'General', order: 20,
    question: 'Do I need an account to download mods?',
    answer: 'Only when the source asks for it. A public repo or catalog with no access rules downloads without an account. If the owner set a whitelist, a ban list, or a creator/Discord/BetterCommunity restriction, you have to be signed in so it can check you — otherwise no login is needed.',
    answerFr: 'Seulement si la source l\'exige. Un dépôt ou catalogue public sans règle d\'accès se télécharge sans compte. Si le propriétaire a mis une whitelist, une banlist, ou une restriction créateur/Discord/BetterCommunity, il faut être connecté pour qu\'il puisse te vérifier — sinon aucune connexion n\'est requise.',
  },
  // ── Using BMM ──
  {
    category: 'Using BMM', order: 100,
    question: 'What\'s the difference between a profile and a modpack?',
    answer: 'A **profile** answers "which mods are on, in what order, for this game" — it\'s your setup. A **modpack** is a named bundle of mods you toggle on and off in one click, and it can even mix mods from different profiles. Rule of thumb: a profile is *your* configuration; a modpack is *a group of mods* meant to travel together.',
    answerFr: 'Un **profil** répond à « quels mods sont actifs, dans quel ordre, pour ce jeu » — c\'est ta configuration. Un **modpack** est un lot de mods nommé que tu actives/désactives en un clic, et il peut même mélanger des mods de profils différents. En bref : un profil est *ta* config ; un modpack est *un groupe de mods* fait pour voyager ensemble.',
  },
  {
    category: 'Using BMM', order: 110,
    question: 'I disabled a mod but it\'s still active in-game — why?',
    answer: 'Almost always two profiles pointing at the **same game folder**. Both deploy into the same place and neither knows what the other left behind, so files survive a profile switch. BMM warns about this when you set it up — it calls it "a major source of human error". Give each profile its own folder.',
    answerFr: 'Presque toujours deux profils qui pointent vers le **même dossier de jeu**. Les deux se déploient au même endroit et aucun ne sait ce que l\'autre a laissé, donc des fichiers survivent au changement de profil. BMM prévient à la configuration — il parle d\'« une source majeure d\'erreur humaine ». Donne à chaque profil son propre dossier.',
  },
  {
    category: 'Using BMM', order: 120,
    question: 'I installed a mod but the game acts like it isn\'t there.',
    answer: 'Nine times out of ten it\'s packaging, not BMM: the archive has one folder too many, so the game looks for `Data/` and finds `MyMod-v3/Data/`. Open the **Mapper**, run the **Structure Diagnostic** to see the final path, and remap before applying.',
    answerFr: 'Neuf fois sur dix c\'est l\'empaquetage, pas BMM : l\'archive a un dossier de trop, donc le jeu cherche `Data/` et trouve `MonMod-v3/Data/`. Ouvre le **Mapper**, lance le **Diagnostic de structure** pour voir le chemin final, et remappe avant d\'appliquer.',
  },
  {
    category: 'Using BMM', order: 130,
    question: 'Two mods conflict — what happens?',
    answer: 'They ship the same file, so **the last one activated wins** and overwrites the other. BMM detects this before you commit, lists the exact overlapping files, and lets you set the activation order — the order *is* the resolution.',
    answerFr: 'Ils livrent le même fichier, donc **le dernier activé gagne** et écrase l\'autre. BMM le détecte avant que tu valides, liste les fichiers qui se chevauchent, et te laisse fixer l\'ordre d\'activation — l\'ordre *est* la résolution.',
  },
  {
    category: 'Using BMM', order: 140,
    question: 'BMM says a mod has no update, but I know it does.',
    answer: 'If the mod\'s source is a **direct download**, BMM is being honest: a raw file URL has no version number, so there\'s nothing to compare. Link the mod to a **Server Repo** that publishes versions for real update detection, or use the direct re-download.',
    answerFr: 'Si la source du mod est un **téléchargement direct**, BMM est honnête : l\'URL d\'un fichier brut n\'a pas de numéro de version, il n\'y a donc rien à comparer. Lie le mod à un **Dépôt Serveur** qui publie des versions pour une vraie détection, ou utilise le retéléchargement direct.',
  },
  {
    category: 'Using BMM', order: 150,
    question: 'Are community plugins safe?',
    answer: 'They\'re **not officially reviewed** — treat them like any other program you install. But they are **bounded**: a plugin acts through the API with its own token and only does what you\'ve granted it (`mods.write`, `profiles.write`, …). Review those grants in **Plugins → Permissions**.',
    answerFr: 'Ils **ne sont pas officiellement relus** — traite-les comme n\'importe quel programme installé. Mais ils sont **bornés** : un plugin agit via l\'API avec son propre token et ne fait que ce que tu lui as accordé (`mods.write`, `profiles.write`…). Relis ces autorisations dans **Plugins → Permissions**.',
  },
  // ── Publishing & hosting ──
  {
    category: 'Publishing & hosting', order: 200,
    question: 'How do I publish content to a catalog?',
    answer: 'Build a catalog JSON (app, plugin, theme or preset), host it — on GitHub, or with us — and add its raw URL as a source. The docs have a page per catalog type with the exact fields and checksums. BMM users then install from it in one click.',
    answerFr: 'Construis un JSON de catalogue (app, plugin, thème ou preset), héberge-le — sur GitHub, ou chez nous — et ajoute son URL brute comme source. La doc a une page par type de catalogue avec les champs exacts et les sommes de contrôle. Les utilisateurs de BMM installent ensuite en un clic.',
  },
  {
    category: 'Publishing & hosting', order: 210,
    question: 'Is Server Repo hosting a recurring charge?',
    answer: 'A **repo** is **prepaid per term** — you pick a size, and there\'s no recurring charge to cancel; deleting it just stops future renewals. A hosted **catalog** subscription is different — it *is* recurring. A deleted repo is kept for 72 hours before its files go, so you can undo.',
    answerFr: 'Un **dépôt** est **prépayé par terme** — tu choisis une taille, et il n\'y a pas d\'abonnement à résilier ; le supprimer arrête juste les renouvellements. Un abonnement de **catalogue** hébergé, lui, *est* récurrent. Un dépôt supprimé est gardé 72 heures avant que ses fichiers partent, tu peux donc annuler.',
  },
  {
    category: 'Publishing & hosting', order: 220,
    question: 'Can I host my own repo instead of paying?',
    answer: 'Yes — point BMM at your own self-hosted repo URL and it works the same, with no hosting fee. Our hosting exists for when you want a stable managed URL and access controls (whitelist, bans, upload limits) without running a server yourself.',
    answerFr: 'Oui — pointe BMM vers l\'URL de ton propre dépôt auto-hébergé et ça marche pareil, sans frais. Notre hébergement existe pour quand tu veux une URL managée stable et des contrôles d\'accès (whitelist, bans, limites d\'upload) sans gérer de serveur toi-même.',
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
    if (existing) {
      await p.faqItem.update({ where: { id: existing.id }, data: { answer: f.answer, answerFr: f.answerFr, category: f.category, order: f.order, published: true } });
      updated++;
    } else {
      await p.faqItem.create({ data: { question: f.question, answer: f.answer, answerFr: f.answerFr, category: f.category, order: f.order ?? i * 10, published: true } });
      created++;
    }
  }
  console.log(`faq seed: ${created} created, ${updated} updated, ${FAQ.length} total.`);
  await p.$disconnect();
};
run().catch((e) => { console.error(e); process.exit(1); });
