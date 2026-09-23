// Kept drafts: the storage half, with no React in it so a test can drive it.
//
// The mechanism was born in ui/product-wizard.jsx, where it solved one problem: a mis-click
// outside the modal closed the "New product" form and everything typed into it was gone.
// Every keystroke landed in sessionStorage under the product's id, and the next open put it
// back. This file is that, generalised, so the contact form, the report dialog, the blog and
// docs editors and the charity editor share ONE copy instead of each growing their own.
//
// Three decisions are baked in here rather than left to each caller, because they are the
// ones that go wrong when every caller answers them for itself:
//
//   sessionStorage, never localStorage. A draft belongs to the tab it was typed in. The
//   wizard's "fixed key" field and the external generator's shared secret are secrets, the
//   report dialog carries whatever somebody pasted into it, and none of that should outlive
//   the tab or be readable by a later visitor to a shared machine. It also settles the
//   two-tabs question for free: sessionStorage is per tab, so two tabs editing the same row
//   keep two independent drafts and neither can overwrite the other's. localStorage would
//   make the last keystroke in either tab win, silently.
//
//   An age. sessionStorage survives as long as the tab does, and a tab left open over a
//   weekend would otherwise offer a draft older than the thing it is a draft OF. Past
//   `maxAgeMs` the entry is not offered and is dropped on the spot — `readDraft` prunes it
//   rather than leaving a stale key behind for a checker to trip over later.
//
//   Off means nothing is written. The Settings switch (lib/prefs.js, `bcw_drafts_off`) does
//   not gate the RESTORE while the writes carry on: `writeDraft` with `enabled: false` calls
//   no setter at all. "Written and ignored" is the version of this that people are right to
//   distrust, and it is the one a test here refuses.
//
// The React half is ui/drafts.jsx (`useDraft` + `<DraftBanner>`).

/** One key per thing being edited. `scope` names the form, `id` the row (or nothing, for a
 *  new one) — so "edit product 7", "edit product 8" and "new product" are three drafts and
 *  the contact form's draft can never be handed to the blog editor. */
export function draftKey(scope, id) {
  const s = String(scope || 'form').replace(/[^a-z0-9._-]/gi, '-');
  const i = id == null || id === '' ? 'new' : String(id).replace(/[^a-z0-9._-]/gi, '-').slice(0, 80);
  return `bcw.draft.${s}.${i}`;
}

/** Every key this module owns, in a store. Used to clear the lot when drafts are turned off. */
export function draftKeys(store) {
  const out = [];
  try {
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i);
      if (typeof k === 'string' && k.startsWith('bcw.draft.')) out.push(k);
    }
  } catch { /* storage refused, there is nothing to list */ }
  return out;
}

/** A day. Long enough that "I came back after lunch" works, short enough that a tab left
 *  open all week does not offer last Tuesday's text as if it were current. */
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Read a kept draft.
 *
 * @returns `{ value, savedAt, meta }`, or null when there is none, when it is unreadable,
 *          when it is older than `maxAgeMs` (in which case it is also removed), or when
 *          `enabled` is false. Never throws: a private window refusing storage, a truncated
 *          JSON and a key written by an older version all read as "no draft".
 */
export function readDraft(store, key, { enabled = true, maxAgeMs = DRAFT_MAX_AGE_MS, now = Date.now() } = {}) {
  if (!enabled || !store) return null;
  let parsed = null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || !('value' in parsed)) return null;
  const savedAt = Number(parsed.savedAt);
  if (!Number.isFinite(savedAt)) return null;
  // A clock that moved backwards (a corrected system time) gives a negative age. Treat it as
  // fresh rather than as expired: throwing somebody's work away over a clock change is the
  // worse of the two mistakes.
  if (now - savedAt > maxAgeMs) { clearDraft(store, key); return null; }
  return { value: parsed.value, savedAt, meta: parsed.meta ?? null };
}

/**
 * Keep a draft. Returns true when something was actually written.
 *
 * `enabled: false` is the Settings switch, and it returns false having touched nothing —
 * that is the guarantee, and `draft-store.test.mjs` asserts it against a store that counts
 * its setItem calls.
 */
export function writeDraft(store, key, value, { enabled = true, meta = null, now = Date.now() } = {}) {
  if (!enabled || !store) return false;
  try {
    store.setItem(key, JSON.stringify({ savedAt: now, meta, value }));
    return true;
  } catch { return false; }  // quota, or a private window that refuses to store anything
}

/** Forget a draft. Silent when there is nothing to forget. */
export function clearDraft(store, key) {
  try { store?.removeItem(key); } catch { /* nothing to clear */ }
}

/** Drop every draft in the store. What the Settings switch does on the way OFF, so that
 *  "drafts are off" means the browser is holding none, not that it holds some it will not
 *  offer. */
export function clearAllDrafts(store) {
  const keys = draftKeys(store);
  for (const k of keys) clearDraft(store, k);
  return keys.length;
}

/** "il y a 3 minutes", as the pieces a translated string can assemble. Bucketed, because a
 *  draft's age is read as "recent / earlier / yesterday" and a live-ticking second counter
 *  in a restore banner is movement nobody asked for. */
export function draftAge(savedAt, now = Date.now()) {
  const ms = Math.max(0, now - Number(savedAt || 0));
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return { unit: 'now', n: 0 };
  if (mins < 60) return { unit: 'min', n: mins };
  const hours = Math.floor(mins / 60);
  if (hours < 24) return { unit: 'hour', n: hours };
  return { unit: 'day', n: Math.floor(hours / 24) };
}

/** Is this draft worth offering back? A value equal to what the form already shows is not a
 *  draft, it is the same thing, and offering it is a banner that does nothing. Compared by
 *  serialisation, which is what the wizard did and what the studio does. */
export function draftDiffers(value, current) {
  try { return JSON.stringify(value) !== JSON.stringify(current); } catch { return true; }
}
