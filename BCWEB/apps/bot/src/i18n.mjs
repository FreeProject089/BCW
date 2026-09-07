// The bot's own language layer.
//
// Three sources, in this order: the ADMIN's overrides (edited on the site under Languages →
// Discord bot, delivered with the config), the built-in dictionary below, then English. Which
// language: the server's choice if its admin picked one in the onboarding (/setup), otherwise
// the member's own Discord locale (`interaction.locale`), otherwise English — so a French
// member in an "auto" server reads French and a German one reads German, without anybody
// configuring anything.
//
// Keys, not sentences, so a string changed in one place changes everywhere it is shown; the
// English text is the reference the site's translator shows beside each field.
import { config } from './config.mjs';

export const LANGS = ['en', 'fr', 'de', 'es'];

export const BASE = {
  en: {
    'btn.level': 'My level', 'btn.shop': 'Shop', 'btn.inventory': 'Inventory', 'btn.leaderboard': 'Leaderboard', 'btn.history': 'History', 'btn.site': 'Open on the site',
    'btn.link': 'Link my account', 'btn.balance': 'My balance', 'btn.again': 'Play again ({n})', 'btn.change': 'Change bet / game', 'btn.play': 'Play — {n} {cur}', 'btn.playPlain': 'Play',
    'btn.prev': 'Previous', 'btn.next': 'Next', 'btn.buy': 'Buy', 'btn.reveal': 'Reveal', 'btn.gift': 'Gift', 'btn.refresh': 'Refresh', 'btn.server': 'This server', 'btn.global': 'Global',
    'btn.games': 'Games', 'btn.pickNumber': 'Pick a number', 'btn.number': 'Number: {n}', 'btn.profile': 'View full profile', 'btn.dashboard': 'Open the dashboard', 'btn.docs': 'Read the docs',
    'notlinked.title': 'Not linked yet',
    'notlinked.body': 'Link your BetterCommunity account first — it takes a minute. Your XP, levels and points are already counting; linking is what lets you spend, give and receive them (see /level).',
    'level.title': 'Level {n}', 'level.unlinked': 'not linked yet', 'level.xp': '{a} / {b} XP', 'level.next': '{n} XP to level {l}', 'level.balance': '{n} {cur}',
    'level.waiting': '{i} **{n}** {cur} waiting — link your BetterCommunity account to spend, give or receive them.',
    'level.nothing': 'Nothing counted yet — messages, reactions and voice time earn XP from your first one.',
    'level.nothing2': 'Link your BetterCommunity account to spend, give or receive points once you have some.',
    'level.rates': '{m} XP / message · {r} / reaction · {v} / voice minute',
    'stat.messages': '{i} **{n}** messages', 'stat.reactions': '{i} **{n}** reactions', 'stat.voice': '{i} **{h} h {m} min** in voice',
    'shop.title': 'Points shop', 'shop.off': 'The economy is currently off.', 'shop.empty': 'The shop is empty for now — check back later.',
    'shop.balance': 'You have **{n}** {cur}. Everything here needs a linked BetterCommunity account — the codes and perks land on it.',
    'shop.link': 'Link your account to buy — **/link**.', 'shop.page': 'Page {p} / {t} · everything you buy lands in /inventory',
    'shop.footer': 'Everything you buy lands in /inventory — and on the site, under Dashboard → Shop & inventory.',
    'inv.title': 'Inventory', 'inv.empty': 'Nothing here yet — the shop is one button away.', 'inv.pending': '**{n}** still on the way (an admin hands those out).', 'inv.count': '{n} purchase(s).',
    'inv.more': '…and {n} more on the site.', 'inv.footer': 'Reveal mints the code for whoever holds the item; Gift hands an unopened item to someone else.',
    'hist.title': 'History', 'hist.empty': 'Nothing yet — earn, buy, play or gift and it shows up here.', 'hist.emptyKind': 'Nothing of that kind yet.', 'hist.footer': 'The full history, with filters, is on the site.',
    'lb.title': 'Leaderboard · {scope}', 'lb.thisServer': 'this server', 'lb.global': 'global', 'lb.empty': 'Nobody has a level yet — say something.', 'lb.you': 'You: **#{r}** · Lv {l} · {p} pts', 'lb.footer': '{n} members have a level · by level, then XP',
    'link.already': 'Already linked', 'link.alreadyBody': 'Your Discord is already linked to a BetterCommunity account.', 'link.title': 'Link your account',
    'link.body': 'Enter this code on your profile page to link your account:', 'link.expires': 'expires in 15 min', 'link.open': 'Open my profile', 'link.fail': 'Could not create a link code right now — try again later.',
    'cas.title': 'Casino', 'cas.off': '⛔ The casino is off right now.', 'cas.linkFirst': '🔗 Link your BetterCommunity account to play — points live on the site.',
    'cas.pick': 'Pick a game — each page shows the rules, the odds and the options before you bet.', 'cas.balance': 'Balance **{n}** {cur} · bets **{a}–{b}**', 'cas.bets': 'Bets **{a}–{b}** {cur} · link your account to play',
    'cas.footer': 'The house edge only taxes what you win: a 1× bucket gives your bet back to the point.', 'cas.pickBet': 'Pick a bet between **{a}** and **{b}** below.', 'cas.betRange': '⚠ Bets go from **{a}** to **{b}**.',
    'cas.onlyHave': '⚠ You only have **{n}** {cur}.', 'cas.pickNumber': '🔢 Pick your number (0–36) below.', 'cas.ready': '✅ Ready — press **Play**. The result is posted in the channel.',
    'cas.bet': 'Bet', 'cas.betOn': 'Bet on', 'cas.goingFor': 'Going for', 'cas.risk': 'Risk', 'cas.allIn': 'All in — {n} {cur}', 'cas.custom': '✏️ Custom amount…', 'cas.customDesc': 'Any amount from {a} to {b}',
    'cas.page': 'Game {i} / {n} · ◀ ▶ to browse · the edge only taxes what you win', 'cas.howTo': 'How to play', 'cas.odds': 'Odds & payouts', 'cas.options': 'Options', 'cas.open': 'Open',
    'cas.win': '{g} — you win!', 'cas.push': '{g} — push', 'cas.lose': '{g} — you lose', 'cas.won': '{i} You won **+{n}** — balance **{b}**.', 'cas.pushed': '{i} Push — your **{n}** came back. Balance **{b}**.',
    'cas.lost': '💀 You lost **{n}**{of}. Balance **{b}**.', 'cas.of': ' of your {n}', 'cas.someoneElse': 'That is somebody else’s table — run **/casino** to open your own.',
    'game.coinflip': 'Coin flip', 'game.dice': 'Dice', 'game.slots': 'Slots', 'game.roulette': 'Roulette', 'game.wheel': 'Wheel', 'game.plinko': 'Plinko',
    'game.coinflip.d': 'Heads or tails — 2×, one chance in two', 'game.dice.d': 'Roll 4, 5 or 6 to double — 2×, one chance in two', 'game.slots.d': 'Three of a kind pays 8×, any pair 1.5×',
    'game.roulette.d': 'A colour 2×, green 14×, an exact number 35×', 'game.wheel.d': 'Pick a multiplier — the bigger it is, the thinner its slice', 'game.plinko.d': 'A ball drops into a multiplier bucket — you pick the risk table',
    'game.coinflip.how': 'Call it. **Heads** doubles your bet, **tails** loses it.', 'game.dice.how': 'One die. A **4, 5 or 6** doubles your bet; **1, 2 or 3** loses it.',
    'game.slots.how': 'Three reels. **Three of a kind** pays 8×, **any pair** 1.5×, anything else loses.', 'game.roulette.how': 'European wheel, 0–36. Pick a colour, the green zero, or an exact number.',
    'game.wheel.how': 'Pick the multiplier you go for. The wheel stops on one slice — you win **only if it is yours**.', 'game.plinko.how': 'A ball bounces down **10 rows of pegs** into one of 11 buckets. The edges pay big, the middle pays little.',
    'onb.title': '👋 Thanks for adding BetterCommunity', 'onb.body': 'Three steps and the bot is yours:',
    'onb.step1': '**1 · Link your account** — press *Link my account* and enter the code on your BetterCommunity profile. Levels, points, the shop and the casino live on the site.',
    'onb.step2': '**2 · Pick the bot’s language for this server** — below. *Auto* follows each member’s own Discord language.',
    'onb.step3': '**3 · Configure the server** on the dashboard — moderation, welcome messages, join-to-create voice rooms, role panels, gated access.',
    'onb.lang': 'Bot language for this server', 'onb.auto': 'Auto — each member’s Discord language', 'onb.saved': 'Language saved: **{l}**.', 'onb.only': 'Only a server manager can change the bot’s language.',
    'lang.en': 'English', 'lang.fr': 'Français', 'lang.de': 'Deutsch', 'lang.es': 'Español',
  },
  fr: {
    'btn.level': 'Mon niveau', 'btn.shop': 'Boutique', 'btn.inventory': 'Inventaire', 'btn.leaderboard': 'Classement', 'btn.history': 'Historique', 'btn.site': 'Ouvrir sur le site',
    'btn.link': 'Lier mon compte', 'btn.balance': 'Mon solde', 'btn.again': 'Rejouer ({n})', 'btn.change': 'Changer mise / jeu', 'btn.play': 'Jouer — {n} {cur}', 'btn.playPlain': 'Jouer',
    'btn.prev': 'Précédent', 'btn.next': 'Suivant', 'btn.buy': 'Acheter', 'btn.reveal': 'Révéler', 'btn.gift': 'Offrir', 'btn.refresh': 'Actualiser', 'btn.server': 'Ce serveur', 'btn.global': 'Global',
    'btn.games': 'Jeux', 'btn.pickNumber': 'Choisir un numéro', 'btn.number': 'Numéro : {n}', 'btn.profile': 'Voir le profil complet', 'btn.dashboard': 'Ouvrir le dashboard', 'btn.docs': 'Lire la doc',
    'notlinked.title': 'Pas encore lié',
    'notlinked.body': 'Lie d’abord ton compte BetterCommunity — une minute suffit. Tes XP, niveaux et points comptent déjà ; le lien est ce qui permet de les dépenser, donner et recevoir (voir /level).',
    'level.title': 'Niveau {n}', 'level.unlinked': 'pas encore lié', 'level.xp': '{a} / {b} XP', 'level.next': '{n} XP avant le niveau {l}', 'level.balance': '{n} {cur}',
    'level.waiting': '{i} **{n}** {cur} en attente — lie ton compte BetterCommunity pour les dépenser, donner ou recevoir.',
    'level.nothing': 'Rien de compté pour l’instant — messages, réactions et temps en vocal rapportent de l’XP dès le premier.',
    'level.nothing2': 'Lie ton compte BetterCommunity pour dépenser, donner ou recevoir des points quand tu en auras.',
    'level.rates': '{m} XP / message · {r} / réaction · {v} / minute en vocal',
    'stat.messages': '{i} **{n}** messages', 'stat.reactions': '{i} **{n}** réactions', 'stat.voice': '{i} **{h} h {m} min** en vocal',
    'shop.title': 'Boutique de points', 'shop.off': 'L’économie est désactivée pour l’instant.', 'shop.empty': 'La boutique est vide pour le moment — reviens plus tard.',
    'shop.balance': 'Tu as **{n}** {cur}. Tout ici demande un compte BetterCommunity lié — les codes et avantages y atterrissent.',
    'shop.link': 'Lie ton compte pour acheter — **/link**.', 'shop.page': 'Page {p} / {t} · tout ce que tu achètes va dans /inventory',
    'shop.footer': 'Tout ce que tu achètes va dans /inventory — et sur le site, Dashboard → Boutique & inventaire.',
    'inv.title': 'Inventaire', 'inv.empty': 'Rien ici pour l’instant — la boutique est à un bouton.', 'inv.pending': '**{n}** encore en route (un admin les remet).', 'inv.count': '{n} achat(s).',
    'inv.more': '…et {n} de plus sur le site.', 'inv.footer': 'Révéler génère le code pour qui détient l’objet ; Offrir remet un objet non ouvert à quelqu’un d’autre.',
    'hist.title': 'Historique', 'hist.empty': 'Rien pour l’instant — gagne, achète, joue ou offre et ça apparaît ici.', 'hist.emptyKind': 'Rien de ce type pour l’instant.', 'hist.footer': 'L’historique complet, avec filtres, est sur le site.',
    'lb.title': 'Classement · {scope}', 'lb.thisServer': 'ce serveur', 'lb.global': 'global', 'lb.empty': 'Personne n’a encore de niveau — dis quelque chose.', 'lb.you': 'Toi : **#{r}** · Niv {l} · {p} pts', 'lb.footer': '{n} membres ont un niveau · par niveau, puis XP',
    'link.already': 'Déjà lié', 'link.alreadyBody': 'Ton Discord est déjà lié à un compte BetterCommunity.', 'link.title': 'Lier ton compte',
    'link.body': 'Entre ce code sur ta page de profil pour lier ton compte :', 'link.expires': 'expire dans 15 min', 'link.open': 'Ouvrir mon profil', 'link.fail': 'Impossible de créer un code de lien pour l’instant — réessaie plus tard.',
    'cas.title': 'Casino', 'cas.off': '⛔ Le casino est fermé pour l’instant.', 'cas.linkFirst': '🔗 Lie ton compte BetterCommunity pour jouer — les points vivent sur le site.',
    'cas.pick': 'Choisis un jeu — chaque page montre les règles, les cotes et les options avant de miser.', 'cas.balance': 'Solde **{n}** {cur} · mises **{a}–{b}**', 'cas.bets': 'Mises **{a}–{b}** {cur} · lie ton compte pour jouer',
    'cas.footer': 'L’avantage maison ne taxe que ce que tu gagnes : une case 1× rend ta mise au point près.', 'cas.pickBet': 'Choisis une mise entre **{a}** et **{b}** ci-dessous.', 'cas.betRange': '⚠ Les mises vont de **{a}** à **{b}**.',
    'cas.onlyHave': '⚠ Tu n’as que **{n}** {cur}.', 'cas.pickNumber': '🔢 Choisis ton numéro (0–36) ci-dessous.', 'cas.ready': '✅ Prêt — appuie sur **Jouer**. Le résultat est posté dans le salon.',
    'cas.bet': 'Mise', 'cas.betOn': 'Mise sur', 'cas.goingFor': 'Objectif', 'cas.risk': 'Risque', 'cas.allIn': 'Tapis — {n} {cur}', 'cas.custom': '✏️ Montant libre…', 'cas.customDesc': 'N’importe quel montant de {a} à {b}',
    'cas.page': 'Jeu {i} / {n} · ◀ ▶ pour parcourir · l’avantage ne taxe que les gains', 'cas.howTo': 'Comment jouer', 'cas.odds': 'Cotes & gains', 'cas.options': 'Options', 'cas.open': 'Ouvrir',
    'cas.win': '{g} — gagné !', 'cas.push': '{g} — nul', 'cas.lose': '{g} — perdu', 'cas.won': '{i} Tu gagnes **+{n}** — solde **{b}**.', 'cas.pushed': '{i} Nul — tes **{n}** te reviennent. Solde **{b}**.',
    'cas.lost': '💀 Tu perds **{n}**{of}. Solde **{b}**.', 'cas.of': ' sur tes {n}', 'cas.someoneElse': 'C’est la table de quelqu’un d’autre — lance **/casino** pour ouvrir la tienne.',
    'game.coinflip': 'Pile ou face', 'game.dice': 'Dé', 'game.slots': 'Machine à sous', 'game.roulette': 'Roulette', 'game.wheel': 'Roue', 'game.plinko': 'Plinko',
    'game.coinflip.d': 'Pile ou face — 2×, une chance sur deux', 'game.dice.d': 'Fais 4, 5 ou 6 pour doubler — 2×, une chance sur deux', 'game.slots.d': 'Trois identiques paient 8×, une paire 1,5×',
    'game.roulette.d': 'Une couleur 2×, le vert 14×, un numéro exact 35×', 'game.wheel.d': 'Choisis un multiplicateur — plus il est gros, plus sa part est fine', 'game.plinko.d': 'Une bille tombe dans une case multiplicatrice — tu choisis la table de risque',
    'game.coinflip.how': 'Annonce. **Face** double ta mise, **pile** la perd.', 'game.dice.how': 'Un dé. Un **4, 5 ou 6** double ta mise ; **1, 2 ou 3** la perd.',
    'game.slots.how': 'Trois rouleaux. **Trois identiques** paient 8×, **une paire** 1,5×, le reste perd.', 'game.roulette.how': 'Roue européenne, 0–36. Choisis une couleur, le zéro vert, ou un numéro exact.',
    'game.wheel.how': 'Choisis le multiplicateur visé. La roue s’arrête sur une part — tu gagnes **seulement si c’est la tienne**.', 'game.plinko.how': 'Une bille rebondit sur **10 rangées de picots** vers l’une des 11 cases. Les bords paient gros, le milieu peu.',
    'onb.title': '👋 Merci d’avoir ajouté BetterCommunity', 'onb.body': 'Trois étapes et le bot est à toi :',
    'onb.step1': '**1 · Lie ton compte** — appuie sur *Lier mon compte* et entre le code sur ton profil BetterCommunity. Niveaux, points, boutique et casino vivent sur le site.',
    'onb.step2': '**2 · Choisis la langue du bot pour ce serveur** — ci-dessous. *Auto* suit la langue Discord de chaque membre.',
    'onb.step3': '**3 · Configure le serveur** sur le dashboard — modération, messages de bienvenue, salons vocaux à la demande, panneaux de rôles, accès réservé.',
    'onb.lang': 'Langue du bot pour ce serveur', 'onb.auto': 'Auto — la langue Discord de chaque membre', 'onb.saved': 'Langue enregistrée : **{l}**.', 'onb.only': 'Seul un gestionnaire du serveur peut changer la langue du bot.',
    'lang.en': 'English', 'lang.fr': 'Français', 'lang.de': 'Deutsch', 'lang.es': 'Español',
  },
  de: {
    'btn.level': 'Mein Level', 'btn.shop': 'Shop', 'btn.inventory': 'Inventar', 'btn.leaderboard': 'Rangliste', 'btn.history': 'Verlauf', 'btn.site': 'Auf der Website öffnen',
    'btn.link': 'Konto verknüpfen', 'btn.balance': 'Mein Guthaben', 'btn.again': 'Nochmal ({n})', 'btn.change': 'Einsatz / Spiel ändern', 'btn.play': 'Spielen — {n} {cur}', 'btn.playPlain': 'Spielen',
    'btn.prev': 'Zurück', 'btn.next': 'Weiter', 'btn.buy': 'Kaufen', 'btn.reveal': 'Aufdecken', 'btn.gift': 'Schenken', 'btn.refresh': 'Aktualisieren', 'btn.server': 'Dieser Server', 'btn.global': 'Global',
    'btn.games': 'Spiele', 'btn.pickNumber': 'Zahl wählen', 'btn.number': 'Zahl: {n}', 'btn.profile': 'Ganzes Profil ansehen', 'btn.dashboard': 'Dashboard öffnen', 'btn.docs': 'Doku lesen',
    'notlinked.title': 'Noch nicht verknüpft',
    'notlinked.body': 'Verknüpfe zuerst dein BetterCommunity-Konto — das dauert eine Minute. XP, Level und Punkte zählen bereits; die Verknüpfung erlaubt es, sie auszugeben, zu verschenken und zu erhalten (siehe /level).',
    'level.title': 'Level {n}', 'level.unlinked': 'noch nicht verknüpft', 'level.xp': '{a} / {b} XP', 'level.next': '{n} XP bis Level {l}', 'level.balance': '{n} {cur}',
    'level.waiting': '{i} **{n}** {cur} warten — verknüpfe dein BetterCommunity-Konto, um sie auszugeben, zu verschenken oder zu erhalten.',
    'level.nothing': 'Noch nichts gezählt — Nachrichten, Reaktionen und Sprachzeit bringen ab der ersten XP.',
    'level.nothing2': 'Verknüpfe dein BetterCommunity-Konto, um Punkte auszugeben, zu verschenken oder zu erhalten.',
    'level.rates': '{m} XP / Nachricht · {r} / Reaktion · {v} / Sprachminute',
    'stat.messages': '{i} **{n}** Nachrichten', 'stat.reactions': '{i} **{n}** Reaktionen', 'stat.voice': '{i} **{h} h {m} min** im Sprachkanal',
    'shop.title': 'Punkte-Shop', 'shop.off': 'Die Wirtschaft ist derzeit aus.', 'shop.empty': 'Der Shop ist gerade leer — schau später wieder vorbei.',
    'shop.balance': 'Du hast **{n}** {cur}. Alles hier braucht ein verknüpftes BetterCommunity-Konto — Codes und Vorteile landen dort.',
    'shop.link': 'Verknüpfe dein Konto zum Kaufen — **/link**.', 'shop.page': 'Seite {p} / {t} · alles Gekaufte landet in /inventory',
    'shop.footer': 'Alles Gekaufte landet in /inventory — und auf der Website unter Dashboard → Shop & Inventar.',
    'inv.title': 'Inventar', 'inv.empty': 'Noch nichts hier — der Shop ist einen Klick entfernt.', 'inv.pending': '**{n}** noch unterwegs (ein Admin übergibt sie).', 'inv.count': '{n} Kauf/Käufe.',
    'inv.more': '…und {n} weitere auf der Website.', 'inv.footer': 'Aufdecken erzeugt den Code für den Besitzer; Schenken übergibt einen ungeöffneten Artikel.',
    'hist.title': 'Verlauf', 'hist.empty': 'Noch nichts — verdiene, kaufe, spiele oder verschenke, und es erscheint hier.', 'hist.emptyKind': 'Noch nichts dieser Art.', 'hist.footer': 'Der vollständige Verlauf mit Filtern ist auf der Website.',
    'lb.title': 'Rangliste · {scope}', 'lb.thisServer': 'dieser Server', 'lb.global': 'global', 'lb.empty': 'Noch niemand hat ein Level — sag etwas.', 'lb.you': 'Du: **#{r}** · Lv {l} · {p} Pkt', 'lb.footer': '{n} Mitglieder haben ein Level · nach Level, dann XP',
    'link.already': 'Bereits verknüpft', 'link.alreadyBody': 'Dein Discord ist bereits mit einem BetterCommunity-Konto verknüpft.', 'link.title': 'Konto verknüpfen',
    'link.body': 'Gib diesen Code auf deiner Profilseite ein, um dein Konto zu verknüpfen:', 'link.expires': 'läuft in 15 min ab', 'link.open': 'Mein Profil öffnen', 'link.fail': 'Gerade kein Verknüpfungscode möglich — versuch es später.',
    'cas.title': 'Casino', 'cas.off': '⛔ Das Casino ist gerade geschlossen.', 'cas.linkFirst': '🔗 Verknüpfe dein BetterCommunity-Konto zum Spielen — Punkte leben auf der Website.',
    'cas.pick': 'Wähle ein Spiel — jede Seite zeigt Regeln, Quoten und Optionen, bevor du setzt.', 'cas.balance': 'Guthaben **{n}** {cur} · Einsätze **{a}–{b}**', 'cas.bets': 'Einsätze **{a}–{b}** {cur} · verknüpfe dein Konto zum Spielen',
    'cas.footer': 'Der Hausvorteil besteuert nur den Gewinn: ein 1×-Feld gibt den Einsatz exakt zurück.', 'cas.pickBet': 'Wähle unten einen Einsatz zwischen **{a}** und **{b}**.', 'cas.betRange': '⚠ Einsätze gehen von **{a}** bis **{b}**.',
    'cas.onlyHave': '⚠ Du hast nur **{n}** {cur}.', 'cas.pickNumber': '🔢 Wähle unten deine Zahl (0–36).', 'cas.ready': '✅ Bereit — drücke **Spielen**. Das Ergebnis wird im Kanal gepostet.',
    'cas.bet': 'Einsatz', 'cas.betOn': 'Setzen auf', 'cas.goingFor': 'Ziel', 'cas.risk': 'Risiko', 'cas.allIn': 'All-in — {n} {cur}', 'cas.custom': '✏️ Eigener Betrag…', 'cas.customDesc': 'Jeder Betrag von {a} bis {b}',
    'cas.page': 'Spiel {i} / {n} · ◀ ▶ zum Blättern · der Vorteil besteuert nur Gewinne', 'cas.howTo': 'So wird gespielt', 'cas.odds': 'Quoten & Auszahlung', 'cas.options': 'Optionen', 'cas.open': 'Öffnen',
    'cas.win': '{g} — gewonnen!', 'cas.push': '{g} — unentschieden', 'cas.lose': '{g} — verloren', 'cas.won': '{i} Du gewinnst **+{n}** — Guthaben **{b}**.', 'cas.pushed': '{i} Unentschieden — deine **{n}** kommen zurück. Guthaben **{b}**.',
    'cas.lost': '💀 Du verlierst **{n}**{of}. Guthaben **{b}**.', 'cas.of': ' von deinen {n}', 'cas.someoneElse': 'Das ist der Tisch von jemand anderem — starte **/casino** für deinen eigenen.',
    'game.coinflip': 'Münzwurf', 'game.dice': 'Würfel', 'game.slots': 'Slots', 'game.roulette': 'Roulette', 'game.wheel': 'Glücksrad', 'game.plinko': 'Plinko',
    'game.coinflip.d': 'Kopf oder Zahl — 2×, eine Chance von zwei', 'game.dice.d': 'Würfle 4, 5 oder 6 zum Verdoppeln — 2×, eine Chance von zwei', 'game.slots.d': 'Drei Gleiche zahlen 8×, ein Paar 1,5×',
    'game.roulette.d': 'Eine Farbe 2×, Grün 14×, eine exakte Zahl 35×', 'game.wheel.d': 'Wähle einen Multiplikator — je größer, desto schmaler sein Feld', 'game.plinko.d': 'Eine Kugel fällt in ein Multiplikator-Fach — du wählst die Risikotabelle',
    'game.coinflip.how': 'Sag es an. **Kopf** verdoppelt den Einsatz, **Zahl** verliert ihn.', 'game.dice.how': 'Ein Würfel. Eine **4, 5 oder 6** verdoppelt; **1, 2 oder 3** verliert.',
    'game.slots.how': 'Drei Walzen. **Drei Gleiche** zahlen 8×, **ein Paar** 1,5×, alles andere verliert.', 'game.roulette.how': 'Europäisches Rad, 0–36. Wähle eine Farbe, die grüne Null oder eine exakte Zahl.',
    'game.wheel.how': 'Wähle deinen Multiplikator. Das Rad stoppt auf einem Feld — du gewinnst **nur, wenn es deins ist**.', 'game.plinko.how': 'Eine Kugel springt über **10 Reihen Stifte** in eines von 11 Fächern. Die Ränder zahlen viel, die Mitte wenig.',
    'onb.title': '👋 Danke, dass du BetterCommunity hinzugefügt hast', 'onb.body': 'Drei Schritte und der Bot gehört dir:',
    'onb.step1': '**1 · Konto verknüpfen** — drücke *Konto verknüpfen* und gib den Code in deinem BetterCommunity-Profil ein. Level, Punkte, Shop und Casino leben auf der Website.',
    'onb.step2': '**2 · Sprache des Bots für diesen Server wählen** — unten. *Auto* folgt der Discord-Sprache jedes Mitglieds.',
    'onb.step3': '**3 · Server einrichten** im Dashboard — Moderation, Willkommensnachrichten, Sprachräume auf Abruf, Rollen-Panels, geschützter Zugang.',
    'onb.lang': 'Bot-Sprache für diesen Server', 'onb.auto': 'Auto — die Discord-Sprache jedes Mitglieds', 'onb.saved': 'Sprache gespeichert: **{l}**.', 'onb.only': 'Nur ein Server-Manager kann die Sprache des Bots ändern.',
    'lang.en': 'English', 'lang.fr': 'Français', 'lang.de': 'Deutsch', 'lang.es': 'Español',
  },
  es: {
    'btn.level': 'Mi nivel', 'btn.shop': 'Tienda', 'btn.inventory': 'Inventario', 'btn.leaderboard': 'Clasificación', 'btn.history': 'Historial', 'btn.site': 'Abrir en la web',
    'btn.link': 'Vincular mi cuenta', 'btn.balance': 'Mi saldo', 'btn.again': 'Jugar otra vez ({n})', 'btn.change': 'Cambiar apuesta / juego', 'btn.play': 'Jugar — {n} {cur}', 'btn.playPlain': 'Jugar',
    'btn.prev': 'Anterior', 'btn.next': 'Siguiente', 'btn.buy': 'Comprar', 'btn.reveal': 'Revelar', 'btn.gift': 'Regalar', 'btn.refresh': 'Actualizar', 'btn.server': 'Este servidor', 'btn.global': 'Global',
    'btn.games': 'Juegos', 'btn.pickNumber': 'Elegir un número', 'btn.number': 'Número: {n}', 'btn.profile': 'Ver perfil completo', 'btn.dashboard': 'Abrir el panel', 'btn.docs': 'Leer la documentación',
    'notlinked.title': 'Aún sin vincular',
    'notlinked.body': 'Vincula primero tu cuenta de BetterCommunity — tarda un minuto. Tus XP, niveles y puntos ya cuentan; vincular es lo que permite gastarlos, darlos y recibirlos (mira /level).',
    'level.title': 'Nivel {n}', 'level.unlinked': 'aún sin vincular', 'level.xp': '{a} / {b} XP', 'level.next': '{n} XP para el nivel {l}', 'level.balance': '{n} {cur}',
    'level.waiting': '{i} **{n}** {cur} esperando — vincula tu cuenta de BetterCommunity para gastarlos, darlos o recibirlos.',
    'level.nothing': 'Nada contado todavía — mensajes, reacciones y tiempo en voz dan XP desde el primero.',
    'level.nothing2': 'Vincula tu cuenta de BetterCommunity para gastar, dar o recibir puntos cuando tengas.',
    'level.rates': '{m} XP / mensaje · {r} / reacción · {v} / minuto de voz',
    'stat.messages': '{i} **{n}** mensajes', 'stat.reactions': '{i} **{n}** reacciones', 'stat.voice': '{i} **{h} h {m} min** en voz',
    'shop.title': 'Tienda de puntos', 'shop.off': 'La economía está desactivada ahora mismo.', 'shop.empty': 'La tienda está vacía por ahora — vuelve más tarde.',
    'shop.balance': 'Tienes **{n}** {cur}. Todo aquí requiere una cuenta de BetterCommunity vinculada — los códigos y ventajas llegan allí.',
    'shop.link': 'Vincula tu cuenta para comprar — **/link**.', 'shop.page': 'Página {p} / {t} · todo lo que compras va a /inventory',
    'shop.footer': 'Todo lo que compras va a /inventory — y en la web, en Panel → Tienda e inventario.',
    'inv.title': 'Inventario', 'inv.empty': 'Nada aquí todavía — la tienda está a un botón.', 'inv.pending': '**{n}** todavía en camino (un admin los entrega).', 'inv.count': '{n} compra(s).',
    'inv.more': '…y {n} más en la web.', 'inv.footer': 'Revelar genera el código para quien tiene el objeto; Regalar entrega un objeto sin abrir a otra persona.',
    'hist.title': 'Historial', 'hist.empty': 'Nada todavía — gana, compra, juega o regala y aparecerá aquí.', 'hist.emptyKind': 'Nada de ese tipo todavía.', 'hist.footer': 'El historial completo, con filtros, está en la web.',
    'lb.title': 'Clasificación · {scope}', 'lb.thisServer': 'este servidor', 'lb.global': 'global', 'lb.empty': 'Nadie tiene nivel todavía — di algo.', 'lb.you': 'Tú: **#{r}** · Nv {l} · {p} pts', 'lb.footer': '{n} miembros tienen nivel · por nivel, luego XP',
    'link.already': 'Ya vinculada', 'link.alreadyBody': 'Tu Discord ya está vinculado a una cuenta de BetterCommunity.', 'link.title': 'Vincular tu cuenta',
    'link.body': 'Introduce este código en tu página de perfil para vincular tu cuenta:', 'link.expires': 'caduca en 15 min', 'link.open': 'Abrir mi perfil', 'link.fail': 'No se pudo crear un código de vinculación — inténtalo más tarde.',
    'cas.title': 'Casino', 'cas.off': '⛔ El casino está cerrado ahora mismo.', 'cas.linkFirst': '🔗 Vincula tu cuenta de BetterCommunity para jugar — los puntos viven en la web.',
    'cas.pick': 'Elige un juego — cada página muestra las reglas, las probabilidades y las opciones antes de apostar.', 'cas.balance': 'Saldo **{n}** {cur} · apuestas **{a}–{b}**', 'cas.bets': 'Apuestas **{a}–{b}** {cur} · vincula tu cuenta para jugar',
    'cas.footer': 'La ventaja de la casa solo grava lo que ganas: una casilla 1× devuelve la apuesta exacta.', 'cas.pickBet': 'Elige abajo una apuesta entre **{a}** y **{b}**.', 'cas.betRange': '⚠ Las apuestas van de **{a}** a **{b}**.',
    'cas.onlyHave': '⚠ Solo tienes **{n}** {cur}.', 'cas.pickNumber': '🔢 Elige abajo tu número (0–36).', 'cas.ready': '✅ Listo — pulsa **Jugar**. El resultado se publica en el canal.',
    'cas.bet': 'Apuesta', 'cas.betOn': 'Apostar a', 'cas.goingFor': 'Objetivo', 'cas.risk': 'Riesgo', 'cas.allIn': 'Todo — {n} {cur}', 'cas.custom': '✏️ Cantidad libre…', 'cas.customDesc': 'Cualquier cantidad de {a} a {b}',
    'cas.page': 'Juego {i} / {n} · ◀ ▶ para navegar · la ventaja solo grava las ganancias', 'cas.howTo': 'Cómo se juega', 'cas.odds': 'Probabilidades y pagos', 'cas.options': 'Opciones', 'cas.open': 'Abrir',
    'cas.win': '{g} — ¡ganaste!', 'cas.push': '{g} — empate', 'cas.lose': '{g} — perdiste', 'cas.won': '{i} Ganaste **+{n}** — saldo **{b}**.', 'cas.pushed': '{i} Empate — tus **{n}** vuelven. Saldo **{b}**.',
    'cas.lost': '💀 Perdiste **{n}**{of}. Saldo **{b}**.', 'cas.of': ' de tus {n}', 'cas.someoneElse': 'Esa es la mesa de otra persona — usa **/casino** para abrir la tuya.',
    'game.coinflip': 'Cara o cruz', 'game.dice': 'Dado', 'game.slots': 'Tragaperras', 'game.roulette': 'Ruleta', 'game.wheel': 'Rueda', 'game.plinko': 'Plinko',
    'game.coinflip.d': 'Cara o cruz — 2×, una de dos', 'game.dice.d': 'Saca 4, 5 o 6 para doblar — 2×, una de dos', 'game.slots.d': 'Tres iguales pagan 8×, una pareja 1,5×',
    'game.roulette.d': 'Un color 2×, el verde 14×, un número exacto 35×', 'game.wheel.d': 'Elige un multiplicador — cuanto mayor, más fina su porción', 'game.plinko.d': 'Una bola cae en una casilla multiplicadora — tú eliges la tabla de riesgo',
    'game.coinflip.how': 'Elige. **Cara** dobla tu apuesta, **cruz** la pierde.', 'game.dice.how': 'Un dado. Un **4, 5 o 6** dobla tu apuesta; **1, 2 o 3** la pierde.',
    'game.slots.how': 'Tres rodillos. **Tres iguales** pagan 8×, **una pareja** 1,5×, lo demás pierde.', 'game.roulette.how': 'Ruleta europea, 0–36. Elige un color, el cero verde o un número exacto.',
    'game.wheel.how': 'Elige el multiplicador que buscas. La rueda se detiene en una porción — ganas **solo si es la tuya**.', 'game.plinko.how': 'Una bola rebota por **10 filas de clavijas** hasta una de 11 casillas. Los bordes pagan mucho, el centro poco.',
    'onb.title': '👋 Gracias por añadir BetterCommunity', 'onb.body': 'Tres pasos y el bot es tuyo:',
    'onb.step1': '**1 · Vincula tu cuenta** — pulsa *Vincular mi cuenta* e introduce el código en tu perfil de BetterCommunity. Niveles, puntos, tienda y casino viven en la web.',
    'onb.step2': '**2 · Elige el idioma del bot para este servidor** — abajo. *Auto* sigue el idioma de Discord de cada miembro.',
    'onb.step3': '**3 · Configura el servidor** en el panel — moderación, mensajes de bienvenida, salas de voz bajo demanda, paneles de roles, acceso restringido.',
    'onb.lang': 'Idioma del bot para este servidor', 'onb.auto': 'Auto — el idioma de Discord de cada miembro', 'onb.saved': 'Idioma guardado: **{l}**.', 'onb.only': 'Solo un administrador del servidor puede cambiar el idioma del bot.',
    'lang.en': 'English', 'lang.fr': 'Français', 'lang.de': 'Deutsch', 'lang.es': 'Español',
  },
};

/** The language a reply to `i` should use: the server's choice, else the member's Discord locale. */
export function localeOf(i, cfg) {
  const forced = cfg?.guildLanguages?.[i?.guildId || ''];
  if (forced && forced !== 'auto' && BASE[forced]) return forced;
  const own = String(i?.locale || '').toLowerCase().slice(0, 2);
  if (BASE[own]) return own;
  const global = String(cfg?.language || '').toLowerCase().slice(0, 2);
  return BASE[global] ? global : 'en';
}

/** A translator for one language: admin overrides → built-in → English → the key itself. */
export function makeT(lang, overrides) {
  const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (_m, k) => (vars && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : `{${k}}`));
  return (key, vars = {}) => {
    const s = overrides?.[lang]?.[key] ?? BASE[lang]?.[key] ?? overrides?.en?.[key] ?? BASE.en[key] ?? key;
    return fill(s, vars);
  };
}

/** `const { t, lang } = await tr(i)` — the one call a handler makes. */
export async function tr(i) {
  const cfg = await config().catch(() => null);
  const lang = localeOf(i, cfg);
  return { t: makeT(lang, cfg?.i18n), lang };
}
