// What a marketplace product HANDS OVER, as one catalog.
//
// The delivery kinds used to be eight labels in a `<select>` — "Fixed key", "Key from a
// pool", "External generator" — and nothing anywhere said what the difference was. Picking
// between them meant knowing the implementation, so the safe choice was whichever one you
// had used before, and "Revealed content" ended up carrying download links (a public URL, in
// every buyer's purchase row, for ever) because it was the one everybody understood.
//
// Data-only, and shared: this file is the source for the picker, the "learn more" panel in
// the product modal, and the comparison table. Icons are lucide NAMES, resolved by each
// consumer, so nothing here imports React.
//
// Each row's EN strings are the English source AND the t() fallback; FR lives in i18n under
// mkd.l.<v> / mkd.d.<v> / mkd.buyer.<v> / mkd.setup.<v> / mkd.when.<v>.

export const DELIVERY_KINDS = [
  {
    v: 'file', icon: 'FileDown',
    label: 'A file, stored here',
    desc: 'The platform holds the file. Each download is a fresh link that expires in ten minutes.',
    buyer: 'A download button on their purchase, good for one visit at a time.',
    setup: 'Save the product first, then attach the file. It counts against the marketplace storage pool.',
    when: 'Anything you would otherwise put behind a download link. This is the one to use: a pasted link is public the moment one buyer shares it, and it stays public.',
  },
  {
    v: 'key_license', icon: 'KeyRound',
    label: 'A unique key per buyer',
    desc: 'A key nobody else has, minted at the sale and recorded on the purchase.',
    buyer: 'Their own key, traceable back to their purchase if it turns up somewhere else.',
    setup: 'Nothing. Unlimited supply, unlike a pool, and traceable, unlike a fixed key.',
    when: 'Licence keys for your own software, when you can check a key against the list of ones you issued.',
  },
  {
    v: 'key_pool', icon: 'Layers',
    label: 'A key from a pool you upload',
    desc: 'One key drawn from a finite list you paste in, claimed race-safely so two buyers can never get the same one.',
    buyer: 'One key from the batch.',
    setup: 'Paste or generate the keys after saving. When the pool runs dry the product refuses to sell rather than taking money it cannot fulfil.',
    when: 'Keys somebody else generated — a game bundle, a third-party licence batch, promo codes from a partner.',
  },
  {
    v: 'key_static', icon: 'Key',
    label: 'One fixed key, the same for everyone',
    desc: 'The same string handed to every buyer.',
    buyer: 'The key you typed.',
    setup: 'Type the key. There is no way to tell who leaked it, because everybody has the same one.',
    when: 'A coupon code, a shared Discord invite, anything you would happily see reposted.',
  },
  {
    v: 'key_external', icon: 'Webhook',
    label: 'A key from your own system',
    desc: 'We ask your endpoint for a key at the moment of sale, signed so you can tell the request is ours.',
    buyer: 'Whatever your system returns.',
    setup: 'A URL that accepts POST and answers { key }, plus a shared secret. We send X-BC-Signature = HMAC-SHA256(body). A dead endpoint fails the delivery rather than hanging the purchase.',
    when: 'You already have a licence server and it should stay the one that decides.',
  },
  {
    v: 'link', icon: 'Link2',
    label: 'A link',
    desc: 'A plain URL, handed over as a real button.',
    buyer: 'A button to a page you control.',
    setup: 'The URL. It does not expire and it is not secret — anyone the buyer forwards it to has it too.',
    when: 'A page that does its own access check. For a file, use the file kind instead.',
  },
  {
    v: 'content', icon: 'FileText',
    label: 'Revealed text',
    desc: 'Text kept hidden until the sale, then shown on the purchase.',
    buyer: 'The text, on their purchase, for as long as the purchase exists.',
    setup: 'Write the text. Do NOT put a download link here — it becomes a permanent public URL the moment one buyer shares it.',
    when: 'Instructions, a coupon, a server address, a short recipe.',
  },
  {
    v: 'role', icon: 'Users',
    label: 'A Discord role',
    desc: 'The bot grants a role on your server.',
    buyer: 'The role, on the account they linked.',
    setup: 'The role id, and the bot has to be on the server and able to manage that role.',
    when: 'Supporter tiers, private channels, anything your Discord already gates.',
  },
];

/** The catalog keyed by value, for the picker and the modal. */
export const DELIVERY_BY_V = Object.fromEntries(DELIVERY_KINDS.map((d) => [d.v, d]));

/** i18n keys, so the picker, the explainer and the guide all read the same strings. */
export const mkdKey = (v, part) => `mkd.${part}.${v}`;

// Billing modes. Two, and the difference is worth spelling out where it is chosen: a
// subscription re-runs the DELIVERY every cycle — a pool product hands over a new key each
// month, which is either exactly what you want or a pool that empties twelve times faster
// than you planned.
export const BILLING_MODES = [
  { v: 'one_time', label: 'One-off purchase', desc: 'Paid once, delivered once.' },
  { v: 'subscription', label: 'Subscription', desc: 'Billed every cycle, and the delivery runs again on each renewal — a new key, a new link, a fresh file.' },
];
