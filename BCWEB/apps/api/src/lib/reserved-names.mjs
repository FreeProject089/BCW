// Names a community submission may not take, because they claim an endorsement.
//
// BMM already refuses to let a catalogue promote itself: trust is assigned from WHERE a
// catalogue was fetched, never from what the document says, so a community list cannot wear
// the Official or Partner badge. That defence is solid and it is not the attack.
//
// The attack is the NAME. Nothing stopped a community catalogue calling itself
// "BetterCommunity Official Repo" or "BMM Verified Mods". The badge would correctly read
// *community* — and people read names, not badges. The badge is four small words next to a
// title someone chose specifically to be believed.
//
// So the endorsement vocabulary is reserved. A community submission has no honest need for
// any of it: a real partner is promoted by staff through the admin route, which does not go
// through this check.
//
// Deliberately NOT reserved: "community", "unofficial", "fan", "fanmade", "inspired by" —
// those describe the truth and blocking them would push people toward vaguer names, which is
// the opposite of what this is for.

/** Fold a display name to the form an impersonator cannot vary their way out of. */
export function fold(name) {
    return String(name || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')   // é → e
        .toLowerCase()
        // Leet, because "0ffic1al" reads as "official" to every human eye.
        .replace(/[0]/g, 'o').replace(/[1|!]/g, 'i').replace(/[3]/g, 'e')
        .replace(/[4@]/g, 'a').replace(/[5$]/g, 's').replace(/[7]/g, 't')
        // Every separator, so "o.f.f.i.c.i.a.l" and "o f f i c i a l" collapse too.
        .replace(/[^a-z]/g, '');
}

/**
 * Terms that claim an endorsement, in the languages this platform actually serves.
 * Stored folded, because that is what they are compared against.
 */
export const RESERVED = [
    'official', 'officiel', 'officielle',
    'partner', 'partenaire',
    'verified', 'verifie', 'verifiee',
    'certified', 'certifie', 'certifiee',
    'endorsed', 'approuve', 'approuvee',
    'bmmteam', 'bmmstaff', 'bmmofficial',
    'bettercommunityofficial', 'bettercommunitystaff',
    'staffpick', 'adminpick',
].map(fold);

/**
 * The reserved term a name claims, or null.
 *
 * Substring matching on the FOLDED name, which is the point: folding has already removed the
 * spacing and substitutions somebody would use to slip past a word-boundary check. It costs
 * a false positive on a word that happens to contain one — "unofficial" contains "official"
 * — so that case is excluded explicitly rather than by making the matcher cleverer.
 */
export function reservedTermIn(name) {
    const folded = fold(name);
    if (!folded) return null;
    // "unofficial" / "non officiel" are honest and must survive.
    const honest = folded.replace(/un(official)/g, '$1_ok').replace(/non(officiel)/g, '$1_ok');
    for (const term of RESERVED) {
        // Skip the occurrences we just marked as honest.
        const idx = honest.indexOf(term);
        if (idx === -1) continue;
        if (honest.slice(idx, idx + term.length + 3).endsWith('_ok')) continue;
        return term;
    }
    return null;
}

/** One refusal shape, matching the blocked-URL one next to it. */
export function replyReservedName(reply, term) {
    return reply.code(409).send({ error: 'reserved_name', term });
}
