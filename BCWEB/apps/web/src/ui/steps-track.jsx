// The landing's "Get going in minutes": three numbered steps, each one a whole card to click.
//
// landing2 (agent-landing): replaces the snake (ui/snake.jsx) on v1. The snake swung its stops
// left and right and joined them with one computed line; on a desktop that line crossed the
// 3D orb and brushed the cards, on a phone the stops sat outside the cards and the line showed
// as a stray orange bar in the gaps. The owner asked for clean steps that make people want to
// click, so the geometry is now plain CSS and cannot meet a card at any width:
//
//   · from lg up (1024px), a row: the badges sit in their own strip ABOVE the cards, and each connector
//     runs badge to badge inside that strip (it starts 8px after one badge and stops 8px before
//     the next, across the column gap);
//   · below that (phone and tablet), a timeline: the badges sit in a narrow rail beside the cards, and each
//     connector runs down the rail from one badge to the next.
//
// Nothing is measured and nothing is drawn by script, so there is no ResizeObserver to miss on
// a tab that is not painting, and no layout to "settle".
//
// The done state keeps its meaning: a step is ticked only when the page KNOWS it is done (the
// caller decides, from the session, a catalogue opened here, something published, a pool
// owned). A done step gets a green tick, a quiet card and its "done" CTA (e.g. "Seen, go back
// to the catalogue"); the connector after it is solid; the first step not done is the current
// one, with the accent ring and the only filled button, so the eye lands on what to do next.
//
// Accessible as a plain ordered list: the badges and connectors are decoration (`aria-hidden`),
// each card is one link whose text says the step number, the title and, when done, "done";
// the current step carries aria-current="step".
import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import './steps-track.css';

/**
 * @param steps  [{ key, icon, title, desc, to, cta, done }]
 */
export function StepsTrack({ steps, className = '' }) {
  const { t } = useI18n();
  const firstOpen = steps.findIndex((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <div className={className}>
      {doneCount > 0 && (
        <p className="st-progress" aria-live="polite">
          <span className="st-progress-bar" aria-hidden="true">
            {steps.map((s) => <span key={s.key} className={s.done ? 'is-done' : ''} />)}
          </span>
          {t('home.st.progress', '{n} of {total} done').replace('{n}', String(doneCount)).replace('{total}', String(steps.length))}
        </p>
      )}
      <ol className="st-list reveal-stagger">
        {steps.map((s, i) => {
          const I = s.icon;
          const state = s.done ? 'is-done' : i === firstOpen ? 'is-current' : '';
          // The connector after this step is "walked" when this step is done.
          return (
            <li key={s.key} className={`st-step ${state} ${s.done ? 'is-walked' : ''}`} aria-current={i === firstOpen ? 'step' : undefined}>
              <span className="st-badge" aria-hidden="true">
                {s.done ? <Check size={17} strokeWidth={3} /> : i + 1}
              </span>
              <Link to={s.to} className="st-card group">
                <span className="st-head">
                  <span className="st-ico" aria-hidden="true"><I size={18} /></span>
                  {s.done && <span className="st-chip is-done">{t('home.st.done', 'Done')}</span>}
                  {!s.done && i === firstOpen && <span className="st-chip is-next">{t('home.st.next', 'Next step')}</span>}
                </span>
                <h3 className="st-title">
                  <span className="sr-only">{t('home.step.n', 'Step {n}').replace('{n}', String(i + 1))}{'. '}</span>
                  {s.title}
                  {s.done && <span className="sr-only">{` (${t('home.snake.doneSr', 'done')})`}</span>}
                </h3>
                <span className="st-desc">{s.desc}</span>
                <span className="st-cta-row">
                  <span className={`st-cta ${i === firstOpen ? 'is-primary' : ''}`}>
                    {s.cta} <ArrowRight size={15} className="rtl-mirror st-arrow" aria-hidden="true" />
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
