import { icons } from './icons.js';

const TIMER_LABELS = { preparation: 'Preparation', quiz: 'Time left' };

/** Countdown pill. Its text is refreshed in place every tick (see app.js) without a full re-render. */
export function renderTimer(phase) {
  const label = TIMER_LABELS[phase];
  if (!label) return '';
  return `
    <div class="timer timer--${phase}" role="timer" data-testid="timer" data-phase="${phase}">
      <span class="timer__label">${label}</span>
      <span class="timer__value" data-timer-value>--:--</span>
    </div>`;
}

export function renderHeader({ summary, phase, confirmRestart }) {
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
      ${renderTimer(phase)}
      ${
        phase !== 'result'
          ? ''
          : confirmRestart
            ? `<button class="btn btn--danger" data-action="restart" data-testid="confirm-restart">${icons.restart()} Confirm restart</button>`
            : `<button class="btn btn--ghost btn--icon" data-action="restart" data-testid="restart" title="Restart interview" aria-label="Restart interview">${icons.restart()}</button>`
      }
    </div>`;
}
