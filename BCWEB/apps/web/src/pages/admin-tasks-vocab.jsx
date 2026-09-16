// The task board's vocabulary, in one place.
//
// States and priorities are strings the API owns (TASK_STATES / TASK_PRIORITIES in
// apps/api/src/lib/tasks.mjs). What they are CALLED, what colour they wear and what icon
// they carry is the screen's business, and it is written once here because the same
// `in_progress` badge is drawn on a card, in a filter row, in a dropdown and in the history
// timeline. Four copies of a label map is four places to forget a French entry.
//
// Every label goes through `t(key, english)`; the French lives in i18n.jsx. The keys are
// literal rather than built from the value, because a key assembled as `atask.state.${s}` is
// invisible to i18n-check and that is exactly how seven rows once shipped in English.
import { CircleDashed, CircleDotDashed, CircleSlash, CheckCircle2, XCircle, ArrowDown, Minus, ArrowUp, Flame } from 'lucide-react';

/** tone is a `badge-*` class suffix; index.css defines amber / blue / green / red / primary. */
export const STATE_META = {
  todo: { tone: '', icon: CircleDashed },
  in_progress: { tone: 'blue', icon: CircleDotDashed },
  blocked: { tone: 'amber', icon: CircleSlash },
  done: { tone: 'green', icon: CheckCircle2 },
  cancelled: { tone: 'red', icon: XCircle },
};

export const PRIORITY_META = {
  low: { tone: '', icon: ArrowDown },
  normal: { tone: 'blue', icon: Minus },
  high: { tone: 'amber', icon: ArrowUp },
  urgent: { tone: 'red', icon: Flame },
};

export const TERMINAL = ['done', 'cancelled'];

/** English labels, and therefore the `t()` fallbacks. `t` is passed in so this stays a
 *  plain module rather than a hook, and so the keys below are literal. */
export const stateLabel = (t, s) => ({
  todo: t('atask.state.todo', 'To do'),
  in_progress: t('atask.state.progress', 'In progress'),
  blocked: t('atask.state.blocked', 'Blocked'),
  done: t('atask.state.done', 'Done'),
  cancelled: t('atask.state.cancelled', 'Cancelled'),
}[s] || s);

export const priorityLabel = (t, p) => ({
  low: t('atask.prio.low', 'Low'),
  normal: t('atask.prio.normal', 'Normal'),
  high: t('atask.prio.high', 'High'),
  urgent: t('atask.prio.urgent', 'Urgent'),
}[p] || p);

/** What a history row says, in a sentence rather than a column of raw fields. */
export const eventLabel = (t, e, nameOf) => {
  const who = (id) => nameOf(id);
  switch (e.kind) {
    case 'created': return t('atask.ev.created', 'created the task');
    case 'assigned': return e.to ? t('atask.ev.assigned', 'handed it to {n}').replace('{n}', who(e.to)) : t('atask.ev.unassigned', 'took it off the assignee');
    case 'released': return e.note ? `${t('atask.ev.released', 'sent it back to the pool')} (${e.note})` : t('atask.ev.released', 'sent it back to the pool');
    case 'state': return t('atask.ev.state', 'moved it to {n}').replace('{n}', stateLabel(t, e.to));
    case 'reopened': return t('atask.ev.reopened', 'reopened it');
    case 'priority': return t('atask.ev.priority', 'set the priority to {n}').replace('{n}', priorityLabel(t, e.to));
    case 'due': return e.to ? t('atask.ev.due', 'set the due date').concat(` (${new Date(e.to).toLocaleDateString()})`) : t('atask.ev.nodue', 'removed the due date');
    case 'team': return e.to ? t('atask.ev.team', 'moved it to another team') : t('atask.ev.noteam', 'took it out of its team');
    case 'note': return t('atask.ev.note', 'wrote a note');
    default: return e.kind;
  }
};

/** A date a human reads, or an empty string. Never the raw ISO string on a card. */
export const shortDate = (v) => (v ? new Date(v).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '');
export const shortDateTime = (v) => (v ? new Date(v).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/** `<input type="datetime-local">` speaks local time with no zone; the API speaks ISO. */
export const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
