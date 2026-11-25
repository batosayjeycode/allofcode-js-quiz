import { cx, escapeHtml } from '../dom.js';
import { renderInline } from '../markdown.js';
import { icons } from './icons.js';
import { questionStatus, STATUS_LABELS } from './status.js';

const STATUS_ICON = {
  correct: () => icons.check(12),
  incorrect: () => icons.cross(12),
  running: () => icons.spinner(12),
};

const NAV_ACTIONS = { preparation: 'preview', quiz: 'go-to' };

export function renderNavigator({ questions, state }) {
  const items = questions
    .map((question, index) => {
      const status = questionStatus(state.answers[question.id]);
      const current = state.phase === 'quiz' && index === state.currentIndex;
      // Preparation: jump to the question in the review list. Quiz: open it. Otherwise read-only.
      const action = NAV_ACTIONS[state.phase];
      return `
        <li>
          <button
            class="${cx('nav-item', `nav-item--${status}`, current && 'is-current', !action && 'is-static')}"
            ${action ? `data-action="${action}"` : 'disabled'} data-index="${index}"
            data-testid="nav-item" data-status="${status}"
            ${current ? 'aria-current="step"' : ''}
            aria-label="Question ${index + 1}: ${escapeHtml(question.title)} — ${STATUS_LABELS[status]}">
            <span class="nav-item__num">${STATUS_ICON[status]?.() ?? index + 1}</span>
            <span class="nav-item__text">
              <span class="nav-item__title">${renderInline(question.title)}</span>
              <span class="nav-item__meta">${escapeHtml(question.category)}</span>
            </span>
          </button>
        </li>`;
    })
    .join('');

  return `
    <div class="sidebar__heading">Questions</div>
    <ol class="nav-list">${items}</ol>
    <div class="legend" aria-hidden="true">
      <span><i class="dot dot--correct"></i>Correct</span>
      <span><i class="dot dot--incorrect"></i>Incorrect</span>
      <span><i class="dot dot--selected"></i>Selected</span>
    </div>`;
}
