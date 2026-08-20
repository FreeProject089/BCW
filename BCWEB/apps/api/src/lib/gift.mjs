// Buying hosting FOR SOMEBODY ELSE.
//
// The obvious implementation is to provision the pool straight onto the recipient's account.
// This does not do that, on purpose: it mints a code assigned to them and mails it.
//
// Two reasons, and both are about what happens when the gift is wrong.
//
//   * The recipient may not have an account yet. A gift that requires one first is a gift that
//     cannot be given to the person you actually wanted to give it to. An `email:` token is
//     matched to whoever redeems it, so signing up afterwards works.
//   * Provisioning silently onto a stranger's account creates hosting they never asked for,
//     with storage attributed to them and a free-tier claim possibly spent. A code they choose
//     to redeem keeps the decision theirs — and an unredeemed code is a thing you can cancel,
//     where a provisioned pool is a thing you have to unpick.
//
// The redemption path is the one that already exists for admin-issued free-hosting codes, so a
// gift lands through code that has been in use since before gifts existed.
import crypto from 'node:crypto';
import { bcIdBody } from './repofingerprint.mjs';

/** Same alphabet as the other codes people have to read off a screen and type back in. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const genGiftCode = () =>
  Array.from({ length: 10 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('').replace(/(.{5})(.{5})/, '$1-$2');

/**
 * Turn what somebody typed into a token the promo system already understands, or an error.
 *
 * Only two kinds are accepted here, because they are the two a giver can reasonably know: the
 * recipient's BC id, which is printed on their profile, and their e-mail. `discord:` and
 * `creator:` exist in the promo system and are deliberately NOT offered — a giver who knows a
 * Discord handle does not know it belongs to the account they mean.
 *
 * Returns `{ token, label }` or `{ error }`. Never throws: this runs inside a checkout.
 */
export function normaliseGiftTarget(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return { error: 'gift_target_missing' };

  if (v.includes('@')) {
    // Deliberately loose. A strict address grammar rejects real addresses, and the cost of
    // being wrong here is a mail that bounces — not a wrong account receiving a gift.
    const email = v.toLowerCase();
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email) || email.length > 200) return { error: 'gift_target_invalid' };
    return { token: `email:${email}`, label: email, kind: 'email' };
  }

  // A BC id, however it was pasted: with the prefix, without, spaced, lower case.
  const body = bcIdBody(v);
  if (!body) return { error: 'gift_target_invalid' };
  return { token: `bcid:${body}`, label: `BC-${body.slice(0, 4)}-${body.slice(4)}`, kind: 'bcid' };
}

/**
 * The code a paid gift produces.
 *
 * `free_hosting` and not `discount`: the giver has already paid, so the recipient must not be
 * asked for a card. It carries the same storage and duration the giver bought, so what arrives
 * is what was paid for rather than a percentage off something they then have to buy.
 *
 * `perUserLimit: 1` and `maxRedemptions: 1` both, which looks redundant and is not: the first
 * stops one account redeeming it twice, the second stops it being redeemed at all once it has
 * been used — a gift code that leaks is then already spent rather than free money.
 */
export async function mintGiftCode(p, { target, storageGB, uploadMbps, hostMonths, note = '' }) {
  let code = genGiftCode();
  for (let i = 0; i < 5 && (await p.promoCode.findUnique({ where: { code } })); i++) code = genGiftCode();
  return p.promoCode.create({
    data: {
      code,
      kind: 'free_hosting',
      storageGB: storageGB ?? null,
      uploadMbps: uploadMbps ?? null,
      hostMonths: hostMonths ?? null,
      maxRedemptions: 1,
      perUserLimit: 1,
      // A gift with no end date is a liability that sits on the books forever. A year is long
      // enough that nobody loses one they meant to use, and short enough to be a number.
      expiresAt: new Date(Date.now() + 365 * 864e5),
      assignedTokens: [target.token],
      stackable: false,
      note,
    },
  });
}
