// The Discord bot dashboard, control by control — the reference the Admin guide renders
// under its "Discord bot" entry (the way the hosting entry renders every hosting setting).
// Pages → modules → controls, each with what it does in full. Hand-written from the screens
// (admin.jsx AdminBot) so the guide can be complete without the screens carrying manuals.
//
// Shape: { id, page: {en,fr}, modules: [{ id, name: {en,fr}, what: {en,fr},
//          controls: [{ label: {en,fr}, what: {en,fr} }] }] }

const c = (en, fr) => ({ en, fr });

export const BOT_DASHBOARD_REF = [
  {
    id: 'overview', page: c('Overview', 'Vue d’ensemble'),
    modules: [
      { id: 'hero', name: c('Status hero', 'Hero de statut'),
        what: c('The one card the dashboard opens on: the bot’s identity with a live dot, the master switch, live stat tiles and Save.', 'La carte d’ouverture : identité du bot avec un point live, l’interrupteur principal, des tuiles de stats en direct et Enregistrer.'),
        controls: [
          { label: c('Master switch', 'Interrupteur principal'), what: c('Off = the bot disconnects within ~20 s and ignores every command everywhere; nothing is deleted. Turn it off to change the token.', 'Off = le bot se déconnecte en ~20 s et ignore toute commande partout ; rien n’est supprimé. Coupe-le pour changer le jeton.') },
          { label: c('Servers · users · temp voice · uptime', 'Serveurs · utilisateurs · vocal temp · uptime'), what: c('Live from the last heartbeat (every 20 s). Offline shows “last seen” instead of stale numbers.', 'En direct depuis le dernier heartbeat (toutes les 20 s). Hors ligne, « vu pour la dernière fois » remplace des chiffres périmés.') },
          { label: c('Save changes', 'Enregistrer'), what: c('Writes the WHOLE config at once. Every module on every page is part of one document; nothing is saved per card.', 'Écrit TOUTE la config d’un coup. Chaque module de chaque page fait partie d’un seul document ; rien n’est enregistré par carte.') },
        ] },
      { id: 'token', name: c('Bot token', 'Jeton du bot'),
        what: c('Where the Discord token lives. Stored server-side, never shown again.', 'Où vit le jeton Discord. Stocké côté serveur, jamais réaffiché.'),
        controls: [
          { label: c('Set / Change / Clear', 'Définir / Changer / Effacer'), what: c('Only while the master switch is OFF. A DISCORD_TOKEN in the environment overrides this field and disables it.', 'Seulement quand l’interrupteur principal est OFF. Un DISCORD_TOKEN dans l’environnement prime et désactive ce champ.') },
          { label: c('Reconnect bot', 'Reconnecter le bot'), what: c('Drops and re-opens the Discord connection. It does NOT deploy new code — that is a container restart.', 'Coupe et rouvre la connexion Discord. Ne déploie PAS de nouveau code — ça, c’est un redémarrage de conteneur.') },
        ] },
      { id: 'memberdb', name: c('Member database', 'Base de membres'),
        what: c('ONE database for every server the bot is in — the full roster of each (name, avatar, join date, roles, last message / voice), refreshed every 30 minutes. Admin-owned: servers do not choose any more; their owners see their own list and manage roles from their dashboard.', 'UNE base pour tous les serveurs où est le bot — le roster complet de chacun (nom, avatar, date d’arrivée, rôles, dernier message / vocal), rafraîchi toutes les 30 minutes. Pilotée par l’admin : les serveurs ne choisissent plus ; leurs propriétaires voient leur liste et gèrent les rôles depuis leur tableau de bord.'),
        controls: [
          { label: c('Cap (MB)', 'Plafond (Mo)'), what: c('The one budget, ~512 bytes per member row. The bar shows stored / linked / inactive and the row maximum.', 'Le seul budget, ~512 octets par ligne membre. La barre montre stockés / liés / inactifs et le maximum de lignes.') },
          { label: c('Evict inactive members when the cap is reached', 'Évincer les inactifs quand le plafond est atteint'), what: c('Priority: linked members are never evicted (Never evict a linked member); active members are kept over inactive; the inactive unlinked ones (no message or voice for N days) are removed — oldest first — to make room for newcomers, and the daily sweep keeps 5% of headroom. Off: nothing is evicted and the database stops growing at the cap (a linked newcomer still gets a slot).', 'Priorité : les membres liés ne sont jamais évincés (Ne jamais évincer un membre lié) ; les actifs passent avant les inactifs ; les inactifs non liés (ni message ni vocal depuis N jours) sont retirés — les plus anciens d’abord — pour faire de la place, et le balayage quotidien garde 5 % de marge. Off : rien n’est évincé et la base arrête de grossir au plafond (un nouveau lié obtient quand même sa place).') },
          { label: c('Per server', 'Par serveur'), what: c('Read-only: each server’s stored / real member count.', 'Lecture seule : membres stockés / réels de chaque serveur.') },
        ] },
    ],
  },
  {
    id: 'announcements', page: c('Announcements', 'Annonces'),
    modules: [
      { id: 'compose', name: c('Write an announcement', 'Écrire une annonce'),
        what: c('Compose and send one by hand — same queue, routing and failure reporting as every automatic announcement.', 'Rédige et envoie à la main — même file, routage et remontée d’erreur que toute annonce automatique.'),
        controls: [
          { label: c('Server · channel · role · embed', 'Serveur · salon · rôle · embed'), what: c('Pick from the live server lists; a role is an optional ping. The result (posted / failed and why) shows under the composer within ~30 s.', 'Choisis dans les listes en direct ; le rôle est un ping optionnel. Le résultat (posté / échec et pourquoi) apparaît sous l’éditeur en ~30 s.') },
        ] },
      { id: 'routes', name: c('Where announcements go', 'Où vont les annonces'),
        what: c('One channel per kind of site notice — commissions, incidents, legal, needs-attention, events, promos — each with an optional urgent-only role. Test each route with one click.', 'Un salon par type d’avis du site — commandes, incidents, légal, à traiter, événements, promos — chacun avec un rôle « urgent » optionnel. Teste chaque route en un clic.'),
        controls: [
          { label: c('Legal notices', 'Avis légaux'), what: c('Empty means NOTHING is sent (not the general channel): a notice identifies its sender, so only a heads-up + link ever leaves the dashboard.', 'Vide = RIEN n’est envoyé (pas le salon général) : un avis identifie son expéditeur, donc seul un rappel + lien sort du tableau de bord.') },
          { label: c('Test this route', 'Tester cette route'), what: c('Queues one message to that channel and reports what happened — how you find out an 18-digit id is wrong before a real commission lands elsewhere.', 'Met un message en file vers ce salon et rapporte ce qui s’est passé — la façon de découvrir qu’un id de 18 chiffres est faux avant qu’une vraie commande atterrisse ailleurs.') },
        ] },
      { id: 'blog', name: c('Blog announcements', 'Annonces de blog'),
        what: c('Post new blog posts to channels, each route filtered by project. Multiple routes, any server.', 'Poste les nouveaux articles dans des salons, chaque route filtrée par projet. Plusieurs routes, n’importe quel serveur.'),
        controls: [ { label: c('Route', 'Route'), what: c('Channel + which blogs feed it (all, BMM, BSM, community, installer, developers, other projects). Already-announced posts are never re-posted.', 'Salon + quels blogs l’alimentent (tous, BMM, BSM, communauté, installeur, développeurs, autres projets). Un article déjà annoncé n’est jamais reposté.') } ] },
      { id: 'alerts', name: c('Alerts', 'Alertes'),
        what: c('Server performance alerts as they fire.', 'Les alertes de performance serveur au moment où elles tombent.'),
        controls: [ { label: c('Performance / incidents channel', 'Salon performance / incidents'), what: c('CPU, memory, disk, Web Vitals and storage go to the performance channel; service-unreachable and error bursts to the incidents channel (empty = also performance).', 'CPU, mémoire, disque, Web Vitals et stockage vont au salon performance ; service injoignable et rafales d’erreurs au salon incidents (vide = performance aussi).') } ] },
      { id: 'kofi', name: c('Ko-fi tips', 'Dons Ko-fi'), what: c('Thank each new tip in a channel with the running total. Old tips are never re-posted.', 'Remercie chaque nouveau don dans un salon avec le total courant. Les anciens dons ne sont jamais repostés.'), controls: [] },
      { id: 'payments', name: c('Payments & refunds', 'Paiements & remboursements'),
        what: c('Post each successful Stripe payment and each refund to the chosen channels.', 'Poste chaque paiement Stripe réussi et chaque remboursement dans les salons choisis.'),
        controls: [ { label: c('Send test message', 'Envoyer un test'), what: c('A sample embed to the channels above — proves the bot can post there. Only NEW payments are announced after enabling.', 'Un embed d’exemple vers les salons ci-dessus — prouve que le bot peut y poster. Seuls les NOUVEAUX paiements sont annoncés après activation.') } ] },
    ],
  },
  {
    id: 'community', page: c('Rules, panels & DMs', 'Règles, panneaux & MP'),
    modules: [
      { id: 'panels', name: c('Rules & role panels', 'Règles & panneaux de rôles'),
        what: c('Post your rules with roles attached — buttons or a dropdown. Save publishes: the bot posts each panel and edits it in place when you change it; no separate publish step.', 'Publie tes règles avec des rôles attachés — boutons ou menu. Enregistrer publie : le bot poste chaque panneau et le modifie sur place quand tu changes ; pas d’étape de publication séparée.'),
        controls: [
          { label: c('Server', 'Serveur'), what: c('Assign the panel to a server so its OWNER can edit it from their own dashboard; unassigned panels are admin-only.', 'Assigne le panneau à un serveur pour que son PROPRIÉTAIRE l’édite depuis son tableau de bord ; non assigné = admin seulement.') },
          { label: c('Roles in: buttons / dropdown · multi', 'Rôles en : boutons / menu · multi'), what: c('Buttons toggle one role each; a dropdown lets a member pick several at once when “multi” is on.', 'Les boutons basculent un rôle chacun ; un menu laisse choisir plusieurs rôles d’un coup si « multi » est actif.') },
        ] },
      { id: 'dm', name: c('Message every member', 'Message à tous les membres'),
        what: c('One DM to everyone the bot has seen. Slow on purpose — Discord treats a burst of DMs as spam.', 'Un MP à tous ceux que le bot a vus. Lent exprès — Discord traite une rafale de MP comme du spam.'),
        controls: [ { label: c('Only linked members', 'Seulement les membres liés'), what: c('Recommended. An unsolicited DM to someone who never linked is what gets a bot reported.', 'Recommandé. Un MP non sollicité à quelqu’un qui n’a rien lié, c’est ce qui fait signaler un bot.') } ] },
      { id: 'giveaways', name: c('Giveaways', 'Giveaways'),
        what: c('A prize, a channel, a duration, N winners. The bot posts the entry button, draws at the end and DMs winners (with a gift code if the prize is one).', 'Un lot, un salon, une durée, N gagnants. Le bot poste le bouton, tire au sort à la fin et envoie un MP aux gagnants (avec un code cadeau si le lot en est un).'),
        controls: [] },
    ],
  },
  {
    id: 'servers', page: c('Per-server', 'Par serveur'),
    modules: [
      { id: 'scope', name: c('Scope', 'Portée'),
        what: c('Every server has its own moderation, welcome, join-to-create and gated roles — there are no shared defaults. Pick a server (the first one is selected for you) and “Configure this server”; its owner can also do it from their own dashboard. What stays here in the admin dashboard is what touches BCWEB itself: announcements, alerts, payments, Ko-fi, limits, the economy.', 'Chaque serveur a sa propre modération, sa bienvenue, son vocal à la demande et ses rôles réservés — il n’y a pas de réglages partagés. Choisis un serveur (le premier est sélectionné pour toi) et « Configurer ce serveur » ; son propriétaire peut aussi le faire depuis son tableau de bord. Ce qui reste ici, dans le tableau de bord admin, c’est ce qui touche BCWEB : annonces, alertes, paiements, Ko-fi, limites, l’économie.'),
        controls: [ { label: c('Block & leave / Just disable', 'Bloquer & quitter / Juste désactiver'), what: c('Two strengths of server ban. /appeal in that server returns the reference shown here.', 'Deux forces de bannissement. /appeal dans ce serveur renvoie la référence affichée ici.') } ] },
      { id: 'moderation', name: c('Moderation', 'Modération'), what: c('Auto-kick + purge in no-post channels; anti-selfbot timeout on mass mentions.', 'Auto-kick + purge dans les salons sans publication ; exclusion anti-selfbot sur les mentions de masse.'), controls: [] },
      { id: 'jtc', name: c('Join-to-create voice', 'Vocal à la demande'), what: c('Joining a lobby channel spawns a personal temp voice room in its category; rooms vanish when empty. Counted against Max temp channels.', 'Rejoindre un salon lobby crée un vocal temporaire personnel dans sa catégorie ; il disparaît vide. Compté dans Max salons temp.'), controls: [] },
      { id: 'welcome', name: c('Welcome / bye', 'Bienvenue / au revoir'), what: c('Animated banner + message on join/leave. Variables: {user} {username} {servername} {joinnumber} {joindate}. Background = a preset colour or an uploaded image (moderatable).', 'Bannière animée + message à l’arrivée/départ. Variables : {user} {username} {servername} {joinnumber} {joindate}. Fond = couleur preset ou image téléversée (modérable).'), controls: [] },
      { id: 'gating', name: c('Gated access', 'Accès gaté'), what: c('Each rule grants ONE role to members meeting its link requirements (Discord linked / BCWEB account / BMM). Re-checked every ~5 min; /refreshroles syncs instantly.', 'Chaque règle accorde UN rôle aux membres remplissant ses conditions de lien (Discord lié / compte BCWEB / BMM). Revérifié toutes les ~5 min ; /refreshroles synchronise aussitôt.'), controls: [] },
    ],
  },
  {
    id: 'members', page: c('Members', 'Membres'),
    modules: [
      { id: 'roster', name: c('Roster', 'Annuaire'), what: c('Everyone the bot has stored: joined / last message / last voice, roles, linked account. Filter linked / not linked / role, sort, search, CSV.', 'Tous les membres stockés : arrivée / dernier message / dernier vocal, rôles, compte lié. Filtre lié / non lié / rôle, tri, recherche, CSV.'),
        controls: [ { label: c('Lv · points + Give', 'Nv · points + Donner'), what: c('A linked member shows their level and balance; Give applies XP or points inline (XP moves the level along the curve).', 'Un membre lié affiche niveau et solde ; Donner applique de l’XP ou des points en ligne (l’XP fait bouger le niveau selon la courbe).') } , { label: c('One row per person · Details', 'Une ligne par personne · Détails'), what: c('The row is name, linked account, joined / last message. Under the chevron: ids, the roles PER SERVER, and the Give form — the roster stays readable at 200 members.', 'La ligne : nom, compte lié, arrivée / dernier message. Sous le chevron : ids, les rôles PAR SERVEUR, et le formulaire Donner — l’annuaire reste lisible à 200 membres.') }, { label: c('Manage', 'Gérer'), what: c('A modal per member: their roles on each server (× removes, a picker adds — queued to the bot like every action, so Discord’s refusal shows in the history), the moderation actions (time out / kick / ban and their undo), and what was done before.', 'Une fenêtre par membre : ses rôles sur chaque serveur (× retire, un sélecteur ajoute — mis en file pour le bot comme toute action, donc un refus de Discord apparaît dans l’historique), les actions de modération (timeout / kick / ban et leur annulation), et ce qui a été fait avant.') } ] },
      { id: 'economy', name: c('Levels & economy view', 'Vue Niveaux & économie'), what: c('The leaderboard by level and points with totals, and the same Give (XP / points) per member — the former “Balances & leaderboard” card. Under it, “Purchases to hand out” (roles and custom rewards bought with points, a Handed-out button per row) and “Point history” — the whole ledger: purchases, casino plays, gifts between members, level-ups, staff grants, searchable by member and filterable by kind.', 'Le classement par niveau et points avec totaux, et le même Donner (XP / points) par membre — l’ancienne carte « Soldes & classement ». Dessous, « Achats à remettre » (rôles et récompenses perso achetés avec des points, un bouton Remis par ligne) et « Historique des points » — tout le registre : achats, parties de casino, dons entre membres, montées de niveau, attributions du staff, cherchable par membre et filtrable par type.'), controls: [ { label: c('Handed out', 'Remis'), what: c('Marks a pending purchase delivered; the member’s inventory (site and /inventory) follows at once. Badges, pools, boosts, hosting and fixed promo codes never appear here — the API delivers them itself.', 'Marque un achat en attente comme remis ; l’inventaire du membre (site et /inventory) suit aussitôt. Badges, pools, boosts, hébergement et codes promo fixes n’apparaissent jamais ici — l’API les livre elle-même.') } ] },
    ],
  },
  {
    id: 'economy', page: c('Levels & economy', 'Niveaux & économie'),
    modules: [
      { id: 'eco', name: c('Economy', 'Économie'), what: c('Currency name/emoji/image, XP rates (message / reaction / voice minute), the level curve with a live preview, points per N levels, stats-public default.', 'Nom/emoji/image de la devise, taux d’XP (message / réaction / minute vocale), courbe de niveaux avec aperçu, points tous les N niveaux, stats publiques par défaut.'),
        controls: [ { label: c('Curve factor', 'Facteur de courbe'), what: c('Each level needs factor× the XP of the previous one — higher = slower. Lv 1/5/10/25/50 preview under the fields.', 'Chaque niveau demande facteur× l’XP du précédent — plus haut = plus lent. Aperçu Nv 1/5/10/25/50 sous les champs.') } ] },
      { id: 'casino', name: c('Casino', 'Casino'), what: c('Min / max bet and house edge. The edge is a tax on the PROFIT of a winning play only: a 1× bucket returns the whole bet, a 0.3× bucket exactly 30 % of it, a 2× win pays the bet plus the bet times (1 − edge). The payout preview prices every game (coin flip, dice, slots, roulette, wheel, plinko) with that rule so you see who wins long-term before saving. On Discord, /casino with no options opens an interactive table (game, bet presets / all-in / custom, per-game options, Play); the min / max here are the bet presets it offers.', 'Mise min / max et avantage maison. L’avantage ne taxe que le GAIN d’une partie gagnante : une case 1× rend toute la mise, une case 0,3× exactement 30 % de celle-ci, un 2× paie la mise plus la mise × (1 − avantage). L’aperçu des gains chiffre chaque jeu (pile ou face, dé, machine à sous, roulette, roue, plinko) avec cette règle pour voir qui gagne sur la durée avant d’enregistrer. Sur Discord, /casino sans option ouvre une table interactive (jeu, paliers de mise / tapis / montant libre, options du jeu, Jouer) ; le min / max ici sont les paliers qu’elle propose.'), controls: [] },
      { id: 'shop', name: c('Shop', 'Boutique'), what: c('What points buy, on Discord (/shop) and on the site (Dashboard → Shop & inventory) — the same list, the same purchase function. Every item needs a linked BCWEB account. Kinds: BCWEB badge (granted on the spot, bound), storage pool / catalog-or-repo boost / free hosting / promo code (a CODE, sealed in the inventory until the holder reveals it — then minted with its validity), Discord role and custom (you hand them out).', 'Ce que les points achètent, sur Discord (/shop) et sur le site (Tableau de bord → Boutique & inventaire) — la même liste, la même fonction d’achat. Chaque article demande un compte BCWEB lié. Types : badge BCWEB (accordé sur-le-champ, lié), pool de stockage / boost catalogue-ou-dépôt / hébergement offert / code promo (un CODE, scellé dans l’inventaire jusqu’à ce que le détenteur le révèle — créé à ce moment, avec sa validité), rôle Discord et perso (tu les remets).'),
        controls: [
          { label: c('Cost · Stock · Listed until', 'Coût · Stock · Listé jusqu’au'), what: c('Stock empty = unlimited; a number caps sales across both doors and shows “Limited · N left” on the item. A listing end date hides the item after that day.', 'Stock vide = illimité ; un nombre plafonne les ventes sur les deux portes et affiche « Limité · N restants » sur l’article. Une date de fin de listage cache l’article après ce jour.') },
          { label: c('One per account · Giftable · Code valid N days', 'Un par compte · Offrable · Code valide N jours'), what: c('Exclusive = one purchase per account (shown as “Exclusive”). Giftable = an unopened item can be handed to another member and its code is not bound to the buyer; a badge or a role is never giftable. Code validity starts at reveal.', 'Un par compte = un seul achat par compte (affiché « Exclusif »). Offrable = un article non ouvert peut être remis à un autre membre et son code n’est pas lié à l’acheteur ; un badge ou un rôle n’est jamais offrable. La validité du code démarre à la révélation.') },
          { label: c('Per-kind fields', 'Champs par type'), what: c('Pool / hosting: GB (+ months for hosting). Boost: days + what it boosts (catalog item or repo). Promo: a fixed code you typed, or a generated discount (% off, months free). Role: the server, then the role.', 'Pool / hébergement : Go (+ mois pour l’hébergement). Boost : jours + ce que ça booste (élément du catalogue ou dépôt). Promo : un code fixe tapé, ou une remise générée (% ou mois offerts). Rôle : le serveur, puis le rôle.') },
        ] },
      { id: 'gifts', name: c('Gifts between members', 'Dons entre membres'), what: c('/gift on Discord and the Boutique → History tab on the site: points between two linked accounts, with a minimum and an optional daily cap per giver. Giftable items change hands unopened.', '/gift sur Discord et Boutique → onglet Historique sur le site : des points entre deux comptes liés, avec un minimum et un plafond quotidien optionnel par donneur. Les articles offrables changent de mains sans être ouverts.'), controls: [] },
      { id: 'history', name: c('History', 'Historique'), what: c('Every point movement is a ledger row (purchases, casino, gifts, level-ups, staff grants). Members see theirs (site, /history); admins see everything under Members → Levels & economy. “Keep for N days” prunes old rows daily; 0 keeps forever. Purchases are never pruned.', 'Chaque mouvement de points est une ligne de registre (achats, casino, dons, montées de niveau, attributions du staff). Les membres voient le leur (site, /history) ; les admins voient tout dans Membres → Niveaux & économie. « Garder N jours » élague chaque jour ; 0 garde toujours. Les achats ne sont jamais élagués.'), controls: [] },
      { id: 'icons', name: c('Button icons', 'Icônes des boutons'), what: c('Custom emoji on the bot’s buttons. Download the icon pack (PNGs drawn by the API), upload them on the application’s Emojis page in the Discord Developer Portal, paste each <:name:id> in its field. Empty = the unicode fallback.', 'Des emojis personnalisés sur les boutons du bot. Télécharge le pack (des PNG dessinés par l’API), téléverse-les sur la page Emojis de l’application dans le Developer Portal Discord, colle chaque <:nom:id> dans son champ. Vide = l’emoji unicode par défaut.'), controls: [] },
    ],
  },
  {
    id: 'limits', page: c('Limits', 'Limites'),
    modules: [
      { id: 'limits', name: c('Limits', 'Limites'), what: c('Max temp voice channels at once, and the member-database cap.', 'Max de salons vocaux temporaires simultanés, et plafond de la base de membres.'), controls: [] },
      { id: 'retention', name: c('Linked-account retention', 'Rétention des comptes liés'), what: c('What the sweeper may do to LINKED members when a limit is hit.', 'Ce que le nettoyeur peut faire aux membres LIÉS quand une limite est atteinte.'),
        controls: [
          { label: c('Never purge linked members', 'Ne jamais purger les membres liés'), what: c('Anonymous rows go first; a linked person’s row is never dropped by a cap.', 'Les lignes anonymes partent d’abord ; la ligne d’une personne liée n’est jamais supprimée par un plafond.') },
          { label: c('If purged anyway, unlink', 'Si purgé quand même, délier'), what: c('Sever the site link so the person is asked to re-link, rather than looking linked to a record that no longer exists.', 'Rompre le lien pour que la personne soit invitée à se relier, plutôt que de paraître liée à une fiche disparue.') },
          { label: c('Force re-link every N days', 'Forcer une reliaison tous les N jours'), what: c('0 = never. Older links are marked stale and the member is prompted to re-authorise.', '0 = jamais. Les liens plus anciens sont marqués périmés et le membre est invité à réautoriser.') },
        ] },
    ],
  },
];
