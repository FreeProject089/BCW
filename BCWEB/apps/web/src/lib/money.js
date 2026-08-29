// Money, formatted the same way everywhere.
//
// It lived in `pages/myo.jsx` and was imported from there by the admin screen — which was
// fine until a component the HOME page renders needed it too. The home page is eager, so an
// import reaching into myo.jsx would have pulled the whole commission page (its intake modal,
// its conversation thread, its quote builder) into the entry chunk to borrow one formatter.
//
// A leaf, then. Nothing here imports anything.
export const fmtMoney = (cents, cur = 'usd') => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: (cur || 'usd').toUpperCase() }).format((cents || 0) / 100); }
  catch { return `$${((cents || 0) / 100).toFixed(2)}`; }
};
