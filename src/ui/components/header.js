import { escapeHtml } from '../dom.js';
import { icons } from './icons.js';

export function renderHeader({ summary, view, confirmRestart }) {
  const progress = summary.totalQuestions ? (summary.completed / summary.totalQuestions) * 100 : 0;
  return `
    <div class="topbar__brand">
      <span class="brand-mark" aria-hidden="true">{&nbsp;}</span>
      <span class="brand-name">JS Quiz</span>
    </div>
    <div class="topbar__progress" aria-label="Progress">
      <div class="progress-text">
        <span><strong data-testid="progress-count">${summary.completed}</strong> / ${summary.totalQuestions} completed</span>
        <span class="muted" data-testid="header-score">${summary.earnedPoints} / ${summary.totalPoints} pts</span>
      </div>
      <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="${summary.totalQuestions}" aria-valuenow="${summary.completed}">
        <div class="progress-fill" style="width:${progress.toFixed(1)}%"></div>
      </div>
    </div>
    <div class="topbar__actions">
      ${
        view === 'summary'
          ? `<button class="btn btn--ghost" data-action="back-to-questions">${icons.left()} Questions</button>`
          : `<button class="btn btn--ghost" data-action="show-summary">${icons.flag()} ${escapeHtml(summary.unanswered ? 'Finish' : 'Results')}</button>`
      }
      ${
        confirmRestart
          ? `<button class="btn btn--danger" data-action="restart" data-testid="confirm-restart">${icons.restart()} Confirm restart</button>`
          : `<button class="btn btn--ghost btn--icon" data-action="restart" data-testid="restart" title="Restart interview" aria-label="Restart interview">${icons.restart()}</button>`
      }
    </div>`;
}
