// Is Community Charity switched on? One probe, shared.
//
// The answer is GET /charity/current: 200 with the pot when the programme runs, 404
// `charity_disabled` when an admin turned it off. The page and the landing widget already
// fetch it; the command palette needs the same answer to hide its /charity entry, and the
// palette is in the entry chunk while charity.jsx is lazy — so the probe lives here, in a
// file with no page behind it, and is asked once per load rather than once per caller.
import { useEffect, useState } from 'react';
import { api } from './api.js';

let probe = null;
export function charityEnabled() {
  if (!probe) probe = api.get('/charity/current').then((d) => !!d && d.enabled !== false).catch(() => false);
  return probe;
}

/** null while unknown, then true / false. */
export function useCharityEnabled() {
  const [on, setOn] = useState(null);
  useEffect(() => { let live = true; charityEnabled().then((v) => { if (live) setOn(v); }); return () => { live = false; }; }, []);
  return on;
}
