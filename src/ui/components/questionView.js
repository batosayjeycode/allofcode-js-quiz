import { cx, escapeHtml } from '../dom.js';
import { renderInline } from '../markdown.js';
import { renderCodeBlock } from './codeBlock.js';
import { icons } from './icons.js';
import { renderOptions } from './options.js';
import { renderConsole, renderExplanation, renderVerdict } from './resultPanel.js';

const DIFFICULTY_TONE = { Basic: 'easy', Intermediate: 'medium', Advanced: 'hard', Expert: 'expert' };

function renderRunBar(answer) {
  const status = answer?.status;
  const canRun = Boolean(answer?.selectedOptionId) && (!status || status === 'idle');
  let label = `${icons.play(14)} Run Code`;
  if (status === 'running') label = `${icons.spinner(14)} Running…`;
  if (status === 'done') label = `${icons.lock(14)} Executed`;
  const hint = status === 'done'
    ? 'Code executed in an isolated sandbox.'
    : canRun
      ? 'Running locks your answer · <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd>'
      : 'Select an answer to enable Run Code';
  return `
    <div class="run-bar">
      <button class="btn btn--primary btn--run" data-action="run" data-testid="run-button" ${canRun ? '' : 'disabled'}>${label}</button>
      <span class="hint">${hint}</span>
    </div>`;
}

export function renderQuestionView({ question, index, total, answer }) {
  const isLast = index === total - 1;
  const done = answer?.status === 'done';
  return `
    <article class="question" data-testid="question" data-question-id="${escapeHtml(question.id)}">
      <header class="question__header">
        <div class="question__meta">
          <span class="q-number" data-testid="question-number">Question ${index + 1} of ${total}</span>
          <span class="badge badge--mono">${escapeHtml(question.id)}</span>
          <span class="badge">${escapeHtml(question.category)}</span>
          <span class="${cx('badge', `badge--${DIFFICULTY_TONE[question.difficulty]}`)}">${escapeHtml(question.difficulty)}</span>
          <span class="badge badge--points">${question.points} ${question.points === 1 ? 'pt' : 'pts'}</span>
        </div>
        <h1 class="question__title" data-testid="question-title">${renderInline(question.title)}</h1>
        <p class="question__desc">${renderInline(question.description)}</p>
      </header>

      ${renderCodeBlock(question.code)}
      ${renderOptions({ question, answer })}
      ${renderRunBar(answer)}
      ${renderConsole(answer)}
      ${done ? renderVerdict({ question, answer }) : ''}
      ${done ? renderExplanation(question) : ''}

      <nav class="pager" aria-label="Question navigation">
        <button class="btn btn--ghost" data-action="previous" data-testid="prev-button" ${index === 0 ? 'disabled' : ''}>${icons.left()} Previous</button>
        <button class="${cx('btn', done ? 'btn--primary' : 'btn--secondary')}" data-action="next" data-testid="next-button">
          ${isLast ? `Finish ${icons.flag()}` : `Next question ${icons.right()}`}
        </button>
      </nav>
    </article>`;
}
