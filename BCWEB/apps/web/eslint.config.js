import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';

// Minimal, targeted ESLint config (see guides/audits/TECH_AUDIT §4, P2). It exists for ONE
// class of bug: an identifier used but never imported, which builds green and then throws
// `X is not defined` at render.
//
// It takes TWO rules to cover that, and for a long time only the first was here:
//   • no-undef          — plain JS references.
//   • react/jsx-no-undef — JSX component names. no-undef does NOT see these: `<Foo />` is a
//                          JSXIdentifier, and core ESLint's scope analysis doesn't resolve it
//                          as a variable reference. So `<AppLogo />` with no import linted
//                          clean and crashed the page. That is exactly the bug this config
//                          claimed to prevent, and it shipped four of them (IconGlyph,
//                          AppLogo, OwnerCatalogs, MyReports) with CI green.
// Verify with a probe if you ever doubt it: a file containing both `const x = Nope;` and
// `<Nope2 />` must report TWO errors, not one.
//
// Everything else is intentionally left off so this can gate CI without a big style cleanup
// first; tighten later as desired.
//
// The react-hooks plugin is registered (not enabled) only so the existing inline
// `// eslint-disable ... react-hooks/exhaustive-deps` comments reference a KNOWN rule
// instead of erroring as "rule not found". Unused-disable reporting is off for the same
// reason — turning it on is a future cleanup, not a blocker.
// One local rule, for one bug that shipped: a hook dependency array naming a `const` that is
// declared FURTHER DOWN the component.
//
//     const fnPos = useMemo(() => { … }, [detail, fnByFile, pos]);
//     const { boxes, pos } = useMemo(() => layout(…), […]);
//
// This builds green. It throws `can't access lexical declaration 'pos' before initialization`
// the first time the component renders, because a dependency array is EVALUATED on every
// render — an early `return` inside the callback does not save it, and neither does the
// dependency never changing. The whole code-map tool rendered as that error and nothing else.
//
// ESLint's own `no-use-before-define` covers this, but it also flags 37 places here where a
// `const` arrow is referenced from a click handler that cannot possibly run during render.
// Those are fine, and a rule that is 90% noise gets turned off. This one looks only where the
// evaluation is immediate and unconditional.
const HOOKS = new Set(['useMemo', 'useEffect', 'useCallback', 'useLayoutEffect', 'useImperativeHandle']);

const localPlugin = {
  rules: {
    'no-tdz-in-deps': {
      meta: { type: 'problem', schema: [] },
      create(context) {
        const source = context.sourceCode || context.getSourceCode();
        return {
          CallExpression(node) {
            const name = node.callee.type === 'Identifier' ? node.callee.name
              : node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier'
                ? node.callee.property.name : null;
            if (!name || !HOOKS.has(name)) return;
            const deps = node.arguments[node.arguments.length - 1];
            if (!deps || deps.type !== 'ArrayExpression') return;
            for (const el of deps.elements) {
              // Only bare identifiers: `a.b` reads `a`, which the same check catches.
              const id = el && el.type === 'Identifier' ? el
                : el && el.type === 'MemberExpression' && el.object.type === 'Identifier' ? el.object
                  : null;
              if (!id) continue;
              const scope = source.getScope ? source.getScope(id) : context.getScope();
              const variable = findVariable(scope, id.name);
              if (!variable || !variable.defs.length) continue;
              const def = variable.defs[0];
              // `var` and function declarations hoist; `const`/`let` do not.
              if (def.type !== 'Variable' || def.parent.kind === 'var') continue;
              if (def.node.range[0] > id.range[0]) {
                context.report({
                  node: id,
                  message: `'${id.name}' is declared below this dependency array — it throws `
                    + 'a temporal-dead-zone error on the first render.',
                });
              }
            }
          },
        };
      },
    },
  },
};

function findVariable(scope, name) {
  for (let s = scope; s; s = s.upper) {
    const hit = s.variables.find((v) => v.name === name);
    if (hit) return hit;
  }
  return null;
}

export default [
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks, react, local: localPlugin },
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      'no-undef': 'error',
      'react/jsx-no-undef': 'error',
      // Same class, one step later. See the `hooks` plugin below.
      'local/no-tdz-in-deps': 'error',
    },
  },
];
