import { createContext, useContext, useRef, useState } from 'react';

// Shared "is the intro still playing" flag — Hero3D drives the actual GSAP/Three.js
// choreography and reads/writes this; App.jsx just uses `active` to keep the real
// nav/content invisible (but already mounted) until the intro hands off to the
// steady-state background, so the reveal is a fade, not a layout jump.
//
// Deliberately NOT session-gated: this is a full-page-load intro (it plays once
// per real refresh/navigation, since React Router link clicks never remount
// App/IntroProvider at all — there's nothing to gate there). The ONLY persistent
// opt-out is the toggle below, which the user controls explicitly (the intro
// overlay's own checkbox, or the same setting in Profile).
export const SKIP_KEY = 'bcweb_skip_intro';

export function shouldSkipIntro() {
  if (typeof window === 'undefined') return true;
  // Deliberately NOT gated on prefers-reduced-motion: Windows exposes that
  // setting in ways users rarely know they have on ("show animations in
  // Windows" off, battery saver…), and it silently killed the intro for the
  // site owner themself. The explicit toggle below is the only opt-out.
  return localStorage.getItem(SKIP_KEY) === '1';
}

const Ctx = createContext(null);

export function IntroProvider({ children }) {
  const [active, setActiveState] = useState(() => !shouldSkipIntro());
  const finishedRef = useRef(false);
  const finish = () => { if (finishedRef.current) return; finishedRef.current = true; setActiveState(false); };
  return <Ctx.Provider value={{ active, finish }}>{children}</Ctx.Provider>;
}

export const useIntro = () => useContext(Ctx) || { active: false, finish: () => {} };
