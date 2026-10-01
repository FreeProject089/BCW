// The feedback triage vocabulary, web side (agent-laya-triage).
//
// The API owns it (apps/api/src/lib/feedback-triage.mjs: TRIAGE_TAGS, TRIAGE_CATEGORIES,
// TRIAGE_SEVERITIES, MAX_TAGS); this is a copy so the admin screen can offer filters and the
// staff editor without a round trip. apps/api/test/feedback-triage.test.mjs reads this file and
// fails if the two lists ever differ, so a tag added on one side cannot silently go missing on
// the other.
//
// Labels go through literal translation calls (one per label), not template keys, so i18n-check sees
// every one of them and the French cannot run out unnoticed.
export const TRIAGE_TAGS = Object.freeze([
  'crash', 'startup', 'performance', 'install', 'update', 'ui', 'mods', 'profiles', 'download',
  'archive', 'conflicts', 'settings', 'ai', 'i18n', 'docs', 'security', 'feature-request', 'other',
]);
export const TRIAGE_CATEGORIES = Object.freeze(['bug', 'crash', 'suggestion', 'question', 'other']);
export const TRIAGE_SEVERITIES = Object.freeze(['low', 'medium', 'high', 'critical']);
export const MAX_TAGS = 6;

/** Badge tones, the same scale as the kind badges on the row. */
export const SEVERITY_TONE = Object.freeze({ critical: 'red', high: 'warning', medium: 'amber', low: '' });

/** Every label of the vocabulary, translated. */
export function triageLabels(t) {
  return {
    tag: {
      crash: t('fbt.tag.crash', 'crash'), startup: t('fbt.tag.startup', 'startup'), performance: t('fbt.tag.performance', 'performance'),
      install: t('fbt.tag.install', 'install'), update: t('fbt.tag.update', 'update'), ui: t('fbt.tag.ui', 'interface'),
      mods: t('fbt.tag.mods', 'mods'), profiles: t('fbt.tag.profiles', 'profiles'), download: t('fbt.tag.download', 'download'),
      archive: t('fbt.tag.archive', 'archives'), conflicts: t('fbt.tag.conflicts', 'conflicts'), settings: t('fbt.tag.settings', 'settings'),
      ai: t('fbt.tag.ai', 'AI'), i18n: t('fbt.tag.i18n', 'translation'), docs: t('fbt.tag.docs', 'docs'),
      security: t('fbt.tag.security', 'security'), 'feature-request': t('fbt.tag.feature', 'feature request'), other: t('fbt.tag.other', 'other'),
    },
    category: {
      bug: t('fbt.cat.bug', 'bug'), crash: t('fbt.cat.crash', 'crash'), suggestion: t('fbt.cat.suggestion', 'suggestion'),
      question: t('fbt.cat.question', 'question'), other: t('fbt.cat.other', 'other'),
    },
    severity: {
      low: t('fbt.sev.low', 'low'), medium: t('fbt.sev.medium', 'medium'), high: t('fbt.sev.high', 'high'), critical: t('fbt.sev.critical', 'critical'),
    },
    source: {
      rules: t('fbt.src.rules', 'rules'), laya: t('fbt.src.laya', 'Laya'), staff: t('fbt.src.staff', 'staff'),
    },
  };
}

/** The category a kind implies: the row only shows the category when it says something new. */
export const KIND_CATEGORY = Object.freeze({ feedback: 'suggestion', bug: 'bug', crash: 'crash' });
