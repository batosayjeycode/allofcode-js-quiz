import { describeError } from '../../engine/executor.js';
import { cx, escapeHtml } from '../dom.js';
import { renderMarkdown } from '../markdown.js';
import { icons } from './icons.js';

const STATUS_META = {
  success: { label: 'Executed successfully', tone: 'success', icon: () => icons.check(14) },
  error: { label: 'Runtime error', tone: 'danger', icon: () => icons.alert(14) },
  timeout: { label: 'Execution timeout', tone: 'warning', icon: () => icons.clock(14) },
};

export function renderConsole(answer) {
  if (answer?.status === 'running') {
    return `
      <section class="console" aria-live="polite" data-testid="console">
        <div class="panel-head"><span class="panel-title">${icons.terminal(14)} Console</span>
          <span class="status-pill status-pill--info">${icons.spinner(14)} Running in sandbox…</span></div>
        <div class="console__body"><span class="muted">Executing…</span></div>
      </section>`;
  }

  const result = answer?.result;
  if (!result) return '';
  const meta = STATUS_META[result.status] ?? STATUS_META.error;

  const logLines = result.logs
    .map((entry) => `<div class="${cx('log', `log--${entry.level}`)}">${escapeHtml(entry.text) || '&nbsp;'}</div>`)
    .join('');
  const errorLine = result.error
    ? `<div class="${cx('log', result.status === 'timeout' ? 'log--timeout' : 'log--error')}" data-testid="console-error">${
        result.status === 'timeout' ? icons.clock(13) : icons.alert(13)
      } ${escapeHtml(describeError(result.error))}</div>`
    : '';
  const empty = !logLines && !errorLine ? '<div class="log muted">(no output)</div>' : '';
  const truncated =
    result.truncated && result.status !== 'timeout' ? '<div class="log muted">… output truncated</div>' : '';

  return `
    <section class="console console--${meta.tone}" aria-live="polite" data-testid="console" data-status="${result.status}">
      <div class="panel-head">
        <span class="panel-title">${icons.terminal(14)} Console output</span>
        <span class="status-pill status-pill--${meta.tone}">${meta.icon()} ${meta.label}</span>
        <span class="muted duration">${result.durationMs < 1 ? '&lt;1' : Math.round(result.durationMs)} ms</span>
      </div>
      <div class="console__body">${logLines}${errorLine}${truncated}${empty}</div>
    </section>`;
}

export function renderVerdict({ question, answer }) {
  const evaluation = answer?.evaluation;
  if (!evaluation) return '';
  const { isCorrect, selectedOptionId, correctOptionId } = evaluation;
  const title = isCorrect ? 'Correct' : 'Incorrect';
  const detail = isCorrect
    ? `Option ${selectedOptionId} matches the actual execution result. +${evaluation.pointsEarned} ${evaluation.pointsEarned === 1 ? 'point' : 'points'}.`
    : correctOptionId
      ? `You chose option ${selectedOptionId}, but the code actually produced option ${correctOptionId}.`
      : `The actual execution result did not match any option.`;
  const warning = evaluation.consistentWithAnswerKey
    ? ''
    : `<p class="verdict__warn">${icons.alert(13)} The execution result differs from this question's answer key (${escapeHtml(question.answer)}). Please report this question.</p>`;

  return `
    <section class="${cx('verdict', isCorrect ? 'verdict--correct' : 'verdict--incorrect')}" data-testid="verdict" data-correct="${isCorrect}" role="status">
      <span class="verdict__icon">${isCorrect ? icons.check(20) : icons.cross(20)}</span>
      <div>
        <h2 class="verdict__title">${title}</h2>
        <p class="verdict__detail">${escapeHtml(detail)}</p>
        ${warning}
      </div>
    </section>`;
}

export function renderExplanation(question) {
  return `
    <section class="explanation" data-testid="explanation">
      <h2 class="section-title">${icons.book(14)} Explanation</h2>
      <div class="prose">${renderMarkdown(question.explanation)}</div>
    </section>`;
}
