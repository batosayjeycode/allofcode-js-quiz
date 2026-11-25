import { cx, escapeHtml } from '../dom.js';
import { icons } from './icons.js';

function optionState(option, answer) {
  const evaluation = answer?.evaluation;
  const selected = answer?.selectedOptionId === option.id;
  if (!evaluation) return { selected, tone: selected ? 'selected' : null, badge: '' };
  const isActual = evaluation.correctOptionId === option.id;
  if (isActual && selected) return { selected, tone: 'correct', badge: `${icons.check(12)} Your answer · Correct` };
  if (isActual) return { selected, tone: 'actual', badge: `${icons.check(12)} Actual result` };
  if (selected) return { selected, tone: 'wrong', badge: `${icons.cross(12)} Your answer` };
  return { selected, tone: 'muted', badge: '' };
}

export function renderOptions({ question, answer }) {
  const locked = answer?.status === 'running' || answer?.status === 'done';
  const items = question.options
    .map((option) => {
      const state = optionState(option, answer);
      const key = option.key ?? option.id; // display letter for the session's shuffled order
      const lines = option.display.map((line) => `<span class="out-line">${escapeHtml(line)}</span>`).join('');
      return `
        <label class="${cx('option', state.tone && `option--${state.tone}`, locked && 'is-locked')}" data-testid="option" data-option-id="${option.id}" data-option-key="${key}">
          <input type="radio" name="answer" value="${option.id}" ${state.selected ? 'checked' : ''} ${locked ? 'disabled' : ''}
            aria-label="Option ${key}: ${escapeHtml(option.display.join(', '))}" />
          <span class="option__key" aria-hidden="true">${key}</span>
          <span class="option__body">${lines}</span>
          ${state.badge ? `<span class="option__badge">${state.badge}</span>` : ''}
        </label>`;
    })
    .join('');

  return `
    <section class="options-section" aria-labelledby="options-heading">
      <div class="section-head">
        <h2 id="options-heading" class="section-title">Your prediction</h2>
        ${
          locked
            ? `<span class="hint">${icons.lock(12)} Answer locked</span>`
            : `<span class="hint">Choose an answer — it locks when the code runs</span>`
        }
      </div>
      <div class="options" role="radiogroup" aria-labelledby="options-heading">${items}</div>
    </section>`;
}
