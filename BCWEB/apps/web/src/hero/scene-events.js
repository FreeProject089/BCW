// Applying a per-event scene override on the client (B11).
//
// The override map lives in the base scene config (`base.events`, keyed by event id) and is
// applied only while that event is live. Kept in its own module — with no three.js import —
// so the merge rule is pure and unit-testable.
//
// Two hard rules:
//   • an event NEVER re-enables a scene the admin switched off. The gate is `base.enabled`,
//     checked here, and an override may carry no `enabled` of its own. This is the whole
//     safety property of the feature: turning the scene off is final.
//   • `reveal` stays page-wide (it is a CSS scroll choice applied on every page), never
//     something one event flips.
export function mergeEventScene(base, activeEvent) {
  if (!base || base.enabled === false) return base;
  const ov = activeEvent && base.events && base.events[activeEvent.id];
  if (!ov || typeof ov !== 'object') return base;
  const { enabled, reveal, ...safe } = ov; // eslint-disable-line no-unused-vars -- stripped on purpose
  return { ...base, ...safe };
}
