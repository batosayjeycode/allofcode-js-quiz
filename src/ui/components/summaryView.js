import { cx, escapeHtml } from '../dom.js';
import { renderInline } from '../markdown.js';
import { icons } from './icons.js';
import { questionStatus, STATUS_LABELS } from './status.js';

const END_REASONS = {
  completed: `${icons.check(14)} All questions answered`,
  timeout: `${icons.clock(14)} Time's up`,
};

function stat(label, value, testId, tone) {
  return `<div class="${cx('stat', tone && `stat--${tone}`)}"><span class="stat__value" data-testid="${testId}">${value}</span><span class="stat__label">${label}</span></div>`;
}

export function renderSummaryView({ questions, state, summary, confirmRestart }) {
  const rows = questions
    .map((question, index) => {
      const answer = state.answers[question.id];
      const status = questionStatus(answer);
      const evaluation = answer?.status === 'done' ? answer.evaluation : null;
      return `
        <tr data-testid="summary-row" data-status="${status}">
          <td class="mono">${index + 1}</td>
          <td><span class="summary-title">${renderInline(question.title)}</span><span class="muted small">${escapeHtml(question.category)} · ${escapeHtml(question.difficulty)}</span></td>
          <td class="mono center">${evaluation ? escapeHtml(evaluation.selectedOptionId) : '—'}</td>
          <td class="mono center">${evaluation ? escapeHtml(evaluation.correctOptionId ?? '?') : '—'}</td>
          <td><span class="${cx('status-tag', `status-tag--${status}`)}">${STATUS_LABELS[status]}</span></td>
          <td class="mono right">${evaluation ? evaluation.pointsEarned : 0} / ${question.points}</td>
        </tr>`;
    })
    .join('');

  const { performance } = summary;
  const unansweredNote = summary.unanswered
    ? `<p class="summary-note">${icons.alert(14)} ${summary.unanswered} question${summary.unanswered === 1 ? ' was' : 's were'} not completed and earned no points.</p>`
    : '';

  return `
    <article class="summary" data-testid="summary">
      <header class="summary__hero">
        <div>
          <p class="eyebrow">Interview result</p>
          <p class="${cx('end-reason', state.endReason === 'timeout' && 'end-reason--timeout')}" data-testid="end-reason" data-reason="${escapeHtml(state.endReason ?? '')}">${END_REASONS[state.endReason] ?? ''}${state.durationMinutes ? ` · ${state.durationMinutes}-minute quiz` : ''}</p>
          <h1 class="summary__score"><span data-testid="summary-percentage">${summary.percentage}%</span></h1>
          <p class="${cx('performance', `performance--${performance.tone}`)}">Performance: <strong data-testid="summary-performance">${performance.label}</strong></p>
        </div>
        <div class="score-bar" aria-hidden="true"><div class="score-bar__fill score-bar__fill--${performance.tone}" style="width:${summary.percentage}%"></div></div>
      </header>

      <div class="stats">
        ${stat('Total questions', summary.totalQuestions, 'summary-total')}
        ${stat('Correct', summary.correct, 'summary-correct', 'success')}
        ${stat('Incorrect', summary.incorrect, 'summary-incorrect', 'danger')}
        ${stat('Unanswered', summary.unanswered, 'summary-unanswered')}
        ${stat('Score', `${summary.earnedPoints} / ${summary.totalPoints}`, 'summary-points')}
      </div>
      ${unansweredNote}

      <div class="table-wrap">
        <table class="summary-table">
          <thead><tr><th>#</th><th>Question</th><th class="center">Answer</th><th class="center">Actual</th><th>Status</th><th class="right">Points</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <div class="summary__actions">
        <button class="${cx('btn', confirmRestart ? 'btn--danger' : 'btn--secondary')}" data-action="restart">${icons.restart()} ${confirmRestart ? 'Confirm: discard answers' : 'Start a new interview'}</button>
      </div>
    </article>`;
}
