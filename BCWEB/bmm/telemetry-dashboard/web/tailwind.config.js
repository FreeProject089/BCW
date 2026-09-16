/** @type {import('tailwindcss').Config} */
// Colours are RGB channel triplets in CSS variables (index.css) so the same utility names
// work in both themes AND keep Tailwind's opacity modifier (`bg-brand/20`): a plain
// `var(--x)` colour would silently render nothing with a slash-opacity.
const c = (v) => `rgb(var(${v}) / <alpha-value>)`;
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: c("--c-bg"),
        panel: c("--c-panel"),
        panel2: c("--c-panel2"),
        line: c("--c-line"),
        ink: c("--c-ink"),
        sub: c("--c-sub"),
        brand: c("--c-brand"),
        good: c("--c-good"),
        warn: c("--c-warn"),
        bad: c("--c-bad"),
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgb(0 0 0 / 0.25), 0 0 0 1px rgb(var(--c-line) / 0.6)",
      },
    },
  },
  plugins: [],
};
