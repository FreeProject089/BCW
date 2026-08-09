// The theme tokens a superadmin may set, what each one actually paints, and how heavily it
// is used.
//
// `uses` is measured, not guessed — a count of `var(--token` across apps/web/src. It orders
// the editor honestly: --faint paints 996 places and --avatar-ring paints one, and an editor
// that gave them equal prominence would be lying about the consequences of a change.
//
// `scope` says where the value lands:
//   'shared'  — one value for both light and dark (the accent is shared today: the dark block
//               never redefines --primary).
//   'mode'    — set per mode, because the shipped light and dark values differ.
//
// `derived: true` marks a token the engine can COMPUTE from the page colour and its text
// (see surfaceVars in theme.jsx). Those are pre-filled rather than required, which is what
// keeps "full control" from meaning "answer 27 questions before the site looks right".

export const TOKEN_GROUPS = [
  { id: 'accent', label: { en: 'Accent', fr: 'Accent' } },
  { id: 'page', label: { en: 'Page & surfaces', fr: 'Page et surfaces' } },
  { id: 'text', label: { en: 'Text', fr: 'Texte' } },
  { id: 'lines', label: { en: 'Lines & borders', fr: 'Lignes et bordures' } },
  { id: 'semantic', label: { en: 'Status colours', fr: 'Couleurs d’état' } },
  { id: 'effects', label: { en: 'Glow & focus', fr: 'Lueur et focus' } },
];

export const TOKENS = [
  // ── accent ────────────────────────────────────────────────────────────────────────
  { name: '--primary', group: 'accent', scope: 'shared', uses: 697,
    label: { en: 'Primary', fr: 'Principale' },
    affects: { en: 'Primary buttons, links, active nav, focus rings, the hero orb.',
               fr: 'Boutons principaux, liens, navigation active, anneaux de focus, l’orbe du héros.' } },
  { name: '--primary-2', group: 'accent', scope: 'shared', uses: 439,
    label: { en: 'Primary (gradient end)', fr: 'Principale (fin du dégradé)' },
    affects: { en: 'The far end of every accent gradient — buttons, headings, the orb.',
               fr: 'L’autre extrémité de chaque dégradé d’accent — boutons, titres, orbe.' } },
  { name: '--on-primary', group: 'accent', scope: 'shared', uses: 2, derived: true,
    label: { en: 'Ink on accent', fr: 'Encre sur l’accent' },
    affects: { en: 'Text sitting ON the accent fill. Derived from the accent’s luminance — override only if you have measured the contrast yourself.',
               fr: 'Le texte posé SUR l’accent. Dérivé de sa luminance — ne le force que si tu as mesuré le contraste toi-même.' } },

  // ── page & surfaces ───────────────────────────────────────────────────────────────
  { name: '--bg', group: 'page', scope: 'mode', uses: 88,
    label: { en: 'Page', fr: 'Page' },
    affects: { en: 'The page itself, behind everything.', fr: 'La page elle-même, derrière tout.' } },
  { name: '--bg-solid', group: 'page', scope: 'mode', uses: 78, derived: true,
    label: { en: 'Opaque page', fr: 'Page opaque' },
    affects: { en: 'Used where a surface MUST be opaque — popups, dropdowns. Never make this translucent or menu text lands on whatever is behind it.',
               fr: 'Là où une surface DOIT être opaque — popups, menus. Ne la rends jamais translucide, sinon le texte des menus se pose sur ce qu’il y a derrière.' } },
  { name: '--surface', group: 'page', scope: 'mode', uses: 350, derived: true,
    label: { en: 'Card', fr: 'Carte' },
    affects: { en: 'Cards and panels — the main content surface.', fr: 'Cartes et panneaux — la surface de contenu principale.' } },
  { name: '--surface-2', group: 'page', scope: 'mode', uses: 333, derived: true,
    label: { en: 'Raised', fr: 'Surélevée' },
    affects: { en: 'Hover states, inputs, chips, rows inside a card.', fr: 'Survols, champs, puces, lignes dans une carte.' } },
  { name: '--surface-3', group: 'page', scope: 'mode', uses: 7, derived: true,
    label: { en: 'Raised +1', fr: 'Surélevée +1' },
    affects: { en: 'One step further up — popovers over a raised row.', fr: 'Un cran au-dessus — popovers par-dessus une ligne surélevée.' } },
  { name: '--avatar-ring', group: 'page', scope: 'mode', uses: 0, derived: true,
    label: { en: 'Avatar ring', fr: 'Anneau d’avatar' },
    affects: { en: 'The opaque gap between overlapping avatars. Must match the card colour or the ring reads as a mismatched frame.',
               fr: 'L’écart opaque entre avatars superposés. Doit correspondre à la couleur de carte, sinon l’anneau ressemble à un cadre mal assorti.' } },

  // ── text ──────────────────────────────────────────────────────────────────────────
  { name: '--text', group: 'text', scope: 'mode', uses: 256,
    label: { en: 'Body text', fr: 'Texte principal' },
    affects: { en: 'Everything you read. Its contrast against the page decides whether the site is usable at all.',
               fr: 'Tout ce qui se lit. Son contraste avec la page décide si le site est utilisable ou non.' } },
  { name: '--muted', group: 'text', scope: 'mode', uses: 618, derived: true,
    label: { en: 'Secondary text', fr: 'Texte secondaire' },
    affects: { en: 'Subtitles, descriptions, inactive nav.', fr: 'Sous-titres, descriptions, navigation inactive.' } },
  { name: '--faint', group: 'text', scope: 'mode', uses: 996, derived: true,
    label: { en: 'Tertiary text', fr: 'Texte tertiaire' },
    affects: { en: 'The most-used token in the app: timestamps, counts, hints, placeholders. Needs 4.5:1 on a RAISED surface, not just on the page.',
               fr: 'Le jeton le plus utilisé de l’app : horodatages, compteurs, indices, placeholders. Il lui faut 4,5:1 sur une surface SURÉLEVÉE, pas seulement sur la page.' } },

  // ── lines ─────────────────────────────────────────────────────────────────────────
  { name: '--line', group: 'lines', scope: 'mode', uses: 593, derived: true,
    label: { en: 'Divider', fr: 'Séparateur' },
    affects: { en: 'Card borders, table rows, dividers.', fr: 'Bordures de cartes, lignes de tableaux, séparateurs.' } },
  { name: '--line-strong', group: 'lines', scope: 'mode', uses: 78, derived: true,
    label: { en: 'Strong divider', fr: 'Séparateur marqué' },
    affects: { en: 'Emphasised edges and scrollbar thumbs.', fr: 'Bords accentués et curseurs de barre de défilement.' } },
  { name: '--control-border', group: 'lines', scope: 'mode', uses: 2, derived: true,
    label: { en: 'Control border', fr: 'Bordure de contrôle' },
    affects: { en: 'The outline that says "this is a button/input". WCAG wants 3:1 against the page — a default button’s fill is nearly invisible without it.',
               fr: 'Le contour qui dit « ceci est un bouton/champ ». WCAG demande 3:1 avec la page — sans lui, le fond d’un bouton par défaut est quasi invisible.' } },

  // ── semantic ──────────────────────────────────────────────────────────────────────
  { name: '--info', group: 'semantic', scope: 'mode', uses: 14,
    label: { en: 'Info', fr: 'Info' }, affects: { en: 'Informational badges and notices.', fr: 'Badges et avis informatifs.' } },
  { name: '--success', group: 'semantic', scope: 'mode', uses: 26,
    label: { en: 'Success', fr: 'Succès' }, affects: { en: 'Confirmations, healthy states, published badges.', fr: 'Confirmations, états sains, badges publiés.' } },
  { name: '--warning', group: 'semantic', scope: 'mode', uses: 20,
    label: { en: 'Warning', fr: 'Avertissement' }, affects: { en: 'Pending states, quota warnings.', fr: 'États en attente, avertissements de quota.' } },
  { name: '--error', group: 'semantic', scope: 'mode', uses: 42,
    label: { en: 'Error', fr: 'Erreur' }, affects: { en: 'Failures, destructive actions, invalid input.', fr: 'Échecs, actions destructrices, saisies invalides.' } },

  // ── effects ───────────────────────────────────────────────────────────────────────
  { name: '--ring', group: 'effects', scope: 'shared', uses: 17, derived: true,
    label: { en: 'Focus ring', fr: 'Anneau de focus' },
    affects: { en: 'The keyboard-focus outline. Derived from the accent.', fr: 'Le contour de focus clavier. Dérivé de l’accent.' } },
  { name: '--primary-glow', group: 'effects', scope: 'shared', uses: 10, derived: true,
    label: { en: 'Accent glow', fr: 'Lueur d’accent' },
    affects: { en: 'The soft halo under primary buttons.', fr: 'Le halo diffus sous les boutons principaux.' } },
  { name: '--glow-a', group: 'effects', scope: 'mode', uses: 3, derived: true,
    label: { en: 'Page glow A', fr: 'Lueur de page A' },
    affects: { en: 'The large radial wash in the page background.', fr: 'Le grand dégradé radial du fond de page.' } },
  { name: '--glow-b', group: 'effects', scope: 'mode', uses: 3, derived: true,
    label: { en: 'Page glow B', fr: 'Lueur de page B' },
    affects: { en: 'The second radial wash, opposite corner.', fr: 'Le second dégradé radial, coin opposé.' } },
  { name: '--glow-c', group: 'effects', scope: 'mode', uses: 2, derived: true,
    label: { en: 'Page glow C', fr: 'Lueur de page C' },
    affects: { en: 'The third, wide wash along the bottom edge.', fr: 'Le troisième dégradé, large, le long du bas.' } },
];

export const TOKENS_BY_NAME = Object.fromEntries(TOKENS.map((t) => [t.name, t]));
/** The allowlist the API validates against — a token name that is not here is refused. */
export const TOKEN_NAMES = TOKENS.map((t) => t.name);
