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
        what: c('How much of the member database is used against the cap set in Limits.', 'Ce que la base de membres consomme par rapport au plafond fixé dans Limites.'),
        controls: [
          { label: c('Usage bar', 'Barre d’usage'), what: c('MB used / cap. Past the cap the sweeper prunes the oldest inactive rows (linked members are protected — see Limits).', 'Mo utilisés / plafond. Au-delà, le nettoyeur élague les lignes inactives les plus anciennes (les membres liés sont protégés — voir Limites).') },
        ] },
      { id: 'storage', name: c('Member storage strategy', 'Stratégie de stockage des membres'),
        what: c('A GLOBAL choice of how the bot builds its database across every server.', 'Un choix GLOBAL de comment le bot construit sa base sur tous les serveurs.'),
        controls: [
          { label: c('Per-server (recommended)', 'Par serveur (recommandé)'), what: c('Each server opts in on its own — a paid pool that stores members, or moderation logs only — with its own byte budget. Nothing is stored until a server turns it on.', 'Chaque serveur choisit pour lui — une pool payante qui stocke les membres, ou des logs de modération seulement — avec son propre budget. Rien n’est stocké tant qu’un serveur n’active pas.') },
          { label: c('Free — every server', 'Gratuit — chaque serveur'), what: c('Store members of every server, for free, against ONE shared budget. “Who to store” narrows it: linked accounts only / active members / everyone. Can grow fast.', 'Stocke les membres de chaque serveur, gratuitement, sur UN budget partagé. « Qui stocker » restreint : comptes liés / actifs / tout le monde. Peut grossir vite.') },
          { label: c('Unified per person', 'Unifié par personne'), what: c('One row per person with the list of servers they share with the bot, instead of one row per server.', 'Une ligne par personne avec la liste des serveurs partagés avec le bot, au lieu d’une ligne par serveur.') },
          { label: c('Require a paid pool to store members', 'Exiger une pool payante'), what: c('Per-server mode only. Off = every server may store members for free while keeping its own byte budget; the bot stops gating storage behind a purchase.', 'Mode par serveur seulement. Off = chaque serveur peut stocker gratuitement en gardant son budget ; le bot arrête de conditionner le stockage à un achat.') },
        ] },
      { id: 'guilds', name: c('Per-server storage', 'Stockage par serveur'),
        what: c('Every server the bot has seen, with its mode (none / moderation / pool), its quota and how many members it holds.', 'Chaque serveur vu par le bot, avec son mode (aucun / modération / pool), son quota et le nombre de membres stockés.'),
        controls: [
          { label: c('Mode', 'Mode'), what: c('none = nothing stored; moderation = Discord logs only (optionally copied here); pool = store members against the quota below.', 'aucun = rien ; modération = logs Discord seulement (copie optionnelle ici) ; pool = stocke les membres sur le quota ci-dessous.') },
          { label: c('Quota', 'Quota'), what: c('Bytes this server may use. The scan stops adding members the moment it is full; existing rows keep refreshing.', 'Octets que ce serveur peut utiliser. Le scan arrête d’ajouter des membres dès que c’est plein ; les lignes existantes continuent d’être rafraîchies.') },
        ] },
      { id: 'logs', name: c('Bot logs', 'Logs du bot'),
        what: c('The bot’s own console, shipped in the heartbeat — the fastest way to see WHY it did or did not post something (missing permission, unknown channel).', 'La console du bot, envoyée dans le heartbeat — le plus rapide pour voir POURQUOI il a (ou n’a pas) posté (permission manquante, salon inconnu).'),
        controls: [] },
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
        what: c('Global defaults apply to any server without its own config. Pick a server and “Customize this server” to give it its own moderation / welcome / join-to-create / gated roles.', 'Les défauts globaux s’appliquent à tout serveur sans config propre. Choisis un serveur et « Personnaliser » pour lui donner sa propre modération / bienvenue / vocal à la demande / rôles gatés.'),
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
        controls: [ { label: c('Lv · points + Give', 'Nv · points + Donner'), what: c('A linked member shows their level and balance; Give applies XP or points inline (XP moves the level along the curve).', 'Un membre lié affiche niveau et solde ; Donner applique de l’XP ou des points en ligne (l’XP fait bouger le niveau selon la courbe).') } , { label: c('One row per person · Details', 'Une ligne par personne · Détails'), what: c('The row is name, linked account, joined / last message. Roles, servers, ids and the Give form open under the chevron — the roster stays readable at 200 members.', 'La ligne : nom, compte lié, arrivée / dernier message. Rôles, serveurs, ids et le formulaire Donner s’ouvrent sous le chevron — l’annuaire reste lisible à 200 membres.') } ] },
      { id: 'economy', name: c('Levels & economy view', 'Vue Niveaux & économie'), what: c('The leaderboard by level and points with totals, and the same Give (XP / points) per member — the former “Balances & leaderboard” card. Under it, “Purchases to hand out”: roles and custom rewards bought with points, with a Handed-out button per row.', 'Le classement par niveau et points avec totaux, et le même Donner (XP / points) par membre — l’ancienne carte « Soldes & classement ». Dessous, « Achats à remettre » : rôles et récompenses perso achetés avec des points, avec un bouton Remis par ligne.'), controls: [ { label: c('Handed out', 'Remis'), what: c('Marks a pending purchase delivered; the member’s inventory (site and /inventory) follows at once. Badges, pools, boosts, hosting and fixed promo codes never appear here — the API delivers them itself.', 'Marque un achat en attente comme remis ; l’inventaire du membre (site et /inventory) suit aussitôt. Badges, pools, boosts, hébergement et codes promo fixes n’apparaissent jamais ici — l’API les livre elle-même.') } ] },
    ],
  },
  {
    id: 'economy', page: c('Levels & economy', 'Niveaux & économie'),
    modules: [
      { id: 'eco', name: c('Economy', 'Économie'), what: c('Currency name/emoji/image, XP rates (message / reaction / voice minute), the level curve with a live preview, points per N levels, stats-public default.', 'Nom/emoji/image de la devise, taux d’XP (message / réaction / minute vocale), courbe de niveaux avec aperçu, points tous les N niveaux, stats publiques par défaut.'),
        controls: [ { label: c('Curve factor', 'Facteur de courbe'), what: c('Each level needs factor× the XP of the previous one — higher = slower. Lv 1/5/10/25/50 preview under the fields.', 'Chaque niveau demande facteur× l’XP du précédent — plus haut = plus lent. Aperçu Nv 1/5/10/25/50 sous les champs.') } ] },
      { id: 'casino', name: c('Casino', 'Casino'), what: c('Min / max bet and house edge. The payout preview prices every game (coin flip, dice, slots, roulette, wheel, plinko) so you see who wins long-term before saving.', 'Mise min / max et avantage maison. L’aperçu des gains chiffre chaque jeu (pile ou face, dé, machine à sous, roulette, roue, plinko) pour voir qui gagne sur la durée avant d’enregistrer.'), controls: [] },
      { id: 'shop', name: c('Shop', 'Boutique'), what: c('What points buy: BCWEB badge, storage pool, catalog boost, free hosting, Discord role, promo code, custom. Badge / pool / boost / hosting are fulfilled by the site BEFORE the debit.', 'Ce que les points achètent : badge BCWEB, pool de stockage, boost de catalogue, hébergement offert, rôle Discord, code promo, custom. Badge / pool / boost / hébergement sont honorés par le site AVANT le débit.'), controls: [] },
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
