// What an account must have LINKED before its work can be listed publicly for a project.
//
// The schema already draws the line this enforces: an item that is not PUBLISHED stays
// reachable through its own private link but is never in the public list or feed. So
// "online" and "public" are already two different things, and buying storage buys the first.
//
// This adds the second condition. Appearing in an OFFICIAL catalogue is BMM (or BSM, or the
// installer) vouching for a listing to every one of its users, and an account that has never
// proved it belongs to that product has not earned that. Hosting is a service you pay for;
// a place in the official catalogue is not for sale.
//
// WHY PER PROJECT, AND NOT ONE GLOBAL "VERIFIED" FLAG
//
// A creator known to BMM has proved nothing about BSM. One flag would let a BMM link carry a
// listing into a catalogue the person has never touched, which is precisely the confusion
// the reserved-name rules exist to prevent — and it would be a worse version of it, because
// this one would be true.
//
// WHAT COUNTS AS A LINK, TODAY
//
// Only BMM has one: CreatorLink ties an account to a BMM creator id, reported by BMM itself
// and held for 14 days before it can be moved. BSM and the installer have no equivalent yet,
// so they are declared here as NOT REQUIRED rather than left out — the difference between "we
// decided this needs nothing" and "nobody thought about it" is the whole reason this file
// lists every project instead of the one it currently gates.

/**
 * Per-project publication requirement.
 *
 *   link:  which link the owner must hold, or null when the project asks for none
 *   why:   shown to the owner, so a refusal explains itself instead of reading as a bug
 */
export const PROJECT_LINK = {
    // Listing under BMM means BMM vouches for it. The creator id is what BMM knows.
    bmm: { link: 'creator', why: 'a linked BMM creator id' },

    // No BSM- or installer-side identity exists to link yet. Declared so that adding one is
    // an edit here rather than a discovery, and so nobody reads the absence as an oversight.
    bsm: { link: null, why: null },
    installer: { link: null, why: null },

    // Community is the un-vouched space by definition — requiring a link would empty it of
    // the thing it is for. The developer blog carries no catalogue items at all.
    community: { link: null, why: null },
    developers: { link: null, why: null },
};

/** The requirement for a project key, defaulting to "none" for a key added later. */
export function requirementFor(projectKey) {
    return PROJECT_LINK[projectKey] || { link: null, why: null };
}

/**
 * Does this owner hold what `projectKey` asks for?
 *
 * Returns `{ ok, link, why }`. `ok` is true when the project asks for nothing, which keeps
 * every caller a single check rather than a check plus a special case.
 */
export async function hasProjectLink(p, userId, projectKey) {
    const req = requirementFor(projectKey);
    if (!req.link) return { ok: true, link: null, why: null };

    if (req.link === 'creator') {
        const n = await p.creatorLink.count({ where: { userId } });
        return { ok: n > 0, link: 'creator', why: req.why };
    }

    // An unknown requirement is a bug in this file, and it must not read as "allowed".
    // Failing closed here costs a support message; failing open puts an unvouched listing in
    // an official catalogue, which is the exact thing this exists to stop.
    return { ok: false, link: req.link, why: req.why };
}

/** One refusal shape, matching the others in the catalogue routes. */
export function replyNeedsLink(reply, need) {
    return reply.code(409).send({ error: 'project_link_required', link: need.link, why: need.why });
}
