// The label of a contact topic, in its own file so the contact modal and the project
// contact bar can both use it without importing each other.

/** The label of a topic, basic or the project's own, in the reader's language. */
export function topicLabel(tp, t, lang) {
  if (!tp) return '';
  if (tp.basic !== false && ['question', 'bug', 'translation', 'suggestion', 'other'].includes(tp.id)) {
    return {
      question: t('pct.t.question', 'A question'),
      bug: t('pct.t.bug', 'Something is broken'),
      translation: t('pct.t.translation', 'A translation problem'),
      suggestion: t('pct.t.suggestion', 'A suggestion'),
      other: t('pct.t.other', 'Something else'),
    }[tp.id];
  }
  return (lang === 'fr' && tp.labelFr) || tp.label || tp.id;
}
