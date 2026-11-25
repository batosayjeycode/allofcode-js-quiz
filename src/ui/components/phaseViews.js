/**
 * Views for the phases before the quiz: the read-only preparation review and
 * the one-time duration choice.
 */
import { cx, escapeHtml } from '../dom.js';
import { renderInline } from '../markdown.js';
import { renderCodeBlock } from './codeBlock.js';
import { icons } from './icons.js';

const DIFFICULTY_TONE = { Basic: 'easy', Intermediate: 'medium', Advanced: 'hard', Expert: 'expert' };

function renderPreviewQuestion(question, index, total) {
  const options = question.options
    .map((option) => {
      const lines = option.display.map((line) => `<span class="out-line">${escapeHtml(line)}</span>`).join('');
      return `
        <div class="option is-locked">
          <span class="option__key" aria-hidden="true">${option.id}</span>
          <span class="option__body"><span class="visually-hidden">Option ${option.id}: </span>${lines}</span>
        </div>`;
    })
    .join('');

  return `
    <article class="question preview-question" data-testid="preview-question" data-preview-index="${index}" aria-labelledby="preview-title-${index}">
      <header class="question__header">
        <div class="question__meta">
          <span class="q-number">Question ${index + 1} of ${total}</span>
          <span class="badge badge--mono">${escapeHtml(question.id)}</span>
          <span class="badge">${escapeHtml(question.category)}</span>
          <span class="${cx('badge', `badge--${DIFFICULTY_TONE[question.difficulty]}`)}">${escapeHtml(question.difficulty)}</span>
          <span class="badge badge--points">${question.points} ${question.points === 1 ? 'pt' : 'pts'}</span>
        </div>
        <h2 class="question__title" id="preview-title-${index}">${renderInline(question.title)}</h2>
        <p class="question__desc">${renderInline(question.description)}</p>
      </header>
      ${renderCodeBlock(question.code)}
      <div class="options">${options}</div>
    </article>`;
}

export function renderPreparationView({ questions }) {
  return `
    <section class="phase phase--preparation" data-testid="preparation">
      <header class="phase__intro">
        <p class="eyebrow">Step 1 of 3 · Preparation</p>
        <h1 class="phase__title">Review the questions</h1>
        <p class="phase__text">
          You have <strong>5 minutes</strong> to read all ${questions.length} questions. Answering and running code
          are disabled for now. When the countdown ends you'll choose how long you get for the quiz.
        </p>
        <p class="phase__countdown">${icons.clock(16)} Quiz setup opens in <strong data-timer-value>--:--</strong></p>
      </header>
      ${questions.map((q, i) => renderPreviewQuestion(q, i, questions.length)).join('')}
    </section>`;
}

export function renderDurationView({ durations }) {
  const buttons = durations
    .map(
      (minutes) => `
        <button class="duration-option" data-action="select-duration" data-minutes="${minutes}" data-testid="duration-option">
          <span class="duration-option__value">${minutes}</span>
          <span class="duration-option__unit">minutes</span>
        </button>`,
    )
    .join('');

  return `
    <section class="phase phase--duration" data-testid="duration-selection">
      <header class="phase__intro">
        <p class="eyebrow">Step 2 of 3 · Quiz duration</p>
        <h1 class="phase__title">How long do you want for the quiz?</h1>
        <p class="phase__text">
          The timer starts as soon as you choose and can't be changed afterwards. The quiz ends when every question has
          been run or the time runs out. Questions you haven't run by then count as unanswered.
        </p>
      </header>
      <div class="duration-options" role="group" aria-label="Quiz duration">${buttons}</div>
    </section>`;
}
