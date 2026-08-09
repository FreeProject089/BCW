export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0b0d12', panel: '#11141c', line: '#232838', accent: '#fbbf24',

        // ── Semantic colours, backed by the theme tokens ──────────────────────────────
        //
        // These exist so a component can say what a colour MEANS instead of naming a
        // shade. `text-red-400` is a decision frozen at write time: it does not follow the
        // site theme, it does not flip between light and dark, and a superadmin changing
        // the palette cannot reach it. 674 such classes were spread across the components,
        // which is why changing the theme left so much of the page looking untouched.
        //
        // index.css already defines every one of these as a triplet — `--error`,
        // `--error-bg`, `--error-border` — with separate light and dark values. Nothing was
        // wired to Tailwind, so nothing could use them.
        //
        // NOTE on opacity: `bg-error/10` cannot work here. Tailwind's `/n` modifier needs a
        // bare channel list (`59 130 246`), not a finished colour, and these variables hold
        // finished colours so that plain CSS can use them too. That is what the `-bg` and
        // `-border` variants are for: they bake the alpha in, are themeable in their own
        // right, and read better at the call site — `bg-error-bg` says "an error surface",
        // `bg-error/10` says "red, ten percent".
        info: { DEFAULT: 'var(--info)', bg: 'var(--info-bg)', border: 'var(--info-border)' },
        success: { DEFAULT: 'var(--success)', bg: 'var(--success-bg)', border: 'var(--success-border)' },
        warning: { DEFAULT: 'var(--warning)', bg: 'var(--warning-bg)', border: 'var(--warning-border)' },
        error: { DEFAULT: 'var(--error)', bg: 'var(--error-bg)', border: 'var(--error-border)' },

        // The brand pair. Distinct from the four above on purpose: `from-orange-500
        // to-amber-500` is the site's gradient, not a warning — mapping it to `warning`
        // would have made every hero and primary button turn amber the moment someone
        // themed their warnings.
        brand: { DEFAULT: 'var(--primary)', 2: 'var(--primary-2)' },
      },
    },
  },
  plugins: [],
};
