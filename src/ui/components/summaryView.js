import { buildInterviewerSummary, formatDuration, timeSpentMs } from '../../state/assessment.js';
import { cx, escapeHtml } from '../dom.js';
import { renderInline, renderMarkdown } from '../markdown.js';
import { renderCodeBlock } from './codeBlock.js';
import { icons } from './icons.js';
import { questionStatus, STATUS_LABELS } from './status.js';

const END_REASONS = {
  completed: { label: 'Completed', icon: () => icons.check(14) },
  timeout: { label: 'Time expired', icon: () => icons.clock(14) },
};

const DIFFICULTY_TONE = { Easy: 'easy', Medium: 'medium', Hard: 'hard' };

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function renderTabSwitches(state) {
  const count = state.tabSwitches ?? 0;
  const text = count
    ? `${icons.alert(14)} Left the quiz tab ${plural(count, 'time')} · ${formatDuration(state.hiddenMs ?? 0)} away`
    : `${icons.check(14)} Stayed on the quiz tab the whole time`;
  return `<p class="${cx('summary-note', !count && 'summary-note--ok')}" data-testid="tab-switches" data-count="${count}">${text}</p>`;
}

function stat(label, value, testId, tone) {
  return `<div class="${cx('stat', tone && `stat--${tone}`)}"><span class="stat__value" data-testid="${testId}">${value}</span><span class="stat__label">${label}</span></div>`;
}

const difficultyBadge = (difficulty) =>
  `<span class="${cx('badge', `badge--${DIFFICULTY_TONE[difficulty]}`)}">${escapeHtml(difficulty)}</span>`;

/** An option as shown to the candidate: its display letter and its lines. */
function renderOptionValue(question, optionId) {
  const option = question.options.find((o) => o.id === optionId);
  if (!option) return '<span class="muted">No matching option</span>';
  const lines = option.display.map((line) => `<span class="out-line">${escapeHtml(line)}</span>`).join('');
  return `<span class="review-answer"><span class="option__key">${escapeHtml(option.key ?? option.id)}</span><span class="option__body">${lines}</span></span>`;
}

function renderList(items, empty) {
  return items.length ? `<ul class="assessment__list">${items.join('')}</ul>` : `<p class="muted small">${empty}</p>`;
}

function renderInterviewerSummary(report) {
  const strengths = report.strengths.map(
    (t) => `<li data-testid="strength"><strong>${escapeHtml(t.category)}</strong> <span class="muted">· ${t.correct} of ${t.total} correct</span></li>`,
  );
  const improvements = report.improvements.map((t) => {
    const parts = [t.incorrect && `${t.incorrect} incorrect`, t.unanswered && `${t.unanswered} unanswered`].filter(Boolean).join(', ');
    return `<li data-testid="improvement"><strong>${escapeHtml(t.category)}</strong> <span class="muted">· ${parts} of ${t.total}</span></li>`;
  });
  const difficultyRows = report.byDifficulty
    .map(
      (d) => `
        <tr data-testid="difficulty-row" data-difficulty="${d.difficulty}">
          <td>${difficultyBadge(d.difficulty)}</td>
          <td class="mono center">${d.correct}</td>
          <td class="mono center">${d.incorrect}</td>
          <td class="mono center">${d.unanswered}</td>
          <td class="mono right">${d.correct + d.incorrect ? `${d.accuracy}%` : '—'}</td>
          <td class="mono right">${d.earnedPoints} / ${d.totalPoints}</td>
        </tr>`,
    )
    .join('');
  const followUps = report.followUps.map(
    (f) => `
      <li data-testid="follow-up">
        <strong>${escapeHtml(f.topic)}</strong>: ${renderInline(f.prompt)}
        ${f.questions.length ? `<span class="muted small assessment__refs">${f.questions.map((q) => `${renderInline(q.title)} (${STATUS_LABELS[q.status]})`).join(' · ')}</span>` : ''}
      </li>`,
  );
  const notes = report.notes.map((note) => `<li>${escapeHtml(note)}</li>`);

  return `
    <section class="assessment" data-testid="interviewer-summary" aria-labelledby="assessment-title">
      <header class="assessment__head">
        <h2 id="assessment-title" class="section-title">${icons.book(14)} Interviewer summary</h2>
        <p><span class="${cx('performance', `performance--${report.overall.tone}`)}">Overall: <strong data-testid="overall-performance">${escapeHtml(report.overall.label)}</strong></span></p>
        <p class="muted" data-testid="overall-headline">${escapeHtml(report.overall.headline)}</p>
      </header>

      <div class="assessment__grid">
        <div>
          <h3 class="assessment__subtitle">Strengths</h3>
          ${renderList(strengths, 'No topic was answered fully correctly.')}
        </div>
        <div>
          <h3 class="assessment__subtitle">Areas for improvement</h3>
          ${renderList(improvements, 'None: every topic was answered correctly.')}
        </div>
      </div>

      <h3 class="assessment__subtitle">By difficulty</h3>
      <div class="table-wrap">
        <table class="summary-table">
          <thead><tr><th>Difficulty</th><th class="center">Correct</th><th class="center">Incorrect</th><th class="center">Unanswered</th><th class="right">Accuracy</th><th class="right">Points</th></tr></thead>
          <tbody>${difficultyRows}</tbody>
        </table>
      </div>

      <h3 class="assessment__subtitle">Suggested follow-up topics</h3>
      <ul class="assessment__list assessment__list--spaced">${followUps.join('')}</ul>

      <h3 class="assessment__subtitle">Notes</h3>
      <ul class="assessment__list">${notes.join('')}</ul>
    </section>`;
}

function renderReviewItem(question, index, answer) {
  const status = questionStatus(answer);
  const evaluation = answer?.status === 'done' ? answer.evaluation : null;
  // The correct option is the one the real execution matched; for questions that were never run, the answer key.
  const correctId = evaluation?.correctOptionId ?? question.answer;
  const candidate = evaluation
    ? renderOptionValue(question, evaluation.selectedOptionId)
    : answer?.selectedOptionId
      ? `<span class="muted">Not answered (option ${escapeHtml(question.options.find((o) => o.id === answer.selectedOptionId)?.key ?? '?')} was selected but not run)</span>`
      : '<span class="muted">Not answered</span>';

  return `
    <details class="${cx('review-item', `review-item--${status}`)}" data-testid="review-item" data-question-id="${escapeHtml(question.id)}" data-status="${status}">
      <summary class="review-item__summary">
        <span class="mono muted">${index + 1}</span>
        <span class="review-item__title">${renderInline(question.title)}</span>
        ${difficultyBadge(question.difficulty)}
        <span class="${cx('status-tag', `status-tag--${status}`)}">${STATUS_LABELS[status]}</span>
        <span class="mono review-item__points" data-testid="review-points">${evaluation ? evaluation.pointsEarned : 0} / ${question.points} pts</span>
      </summary>
      <div class="review-item__body">
        <p class="muted small">${escapeHtml(question.category)} · ${escapeHtml(question.id)}</p>
        <p>${renderInline(question.description)}</p>
        ${renderCodeBlock(question.code)}
        <dl class="review-answers">
          <div><dt>Candidate's answer</dt><dd data-testid="review-candidate">${candidate}</dd></div>
          <div><dt>Correct answer</dt><dd data-testid="review-correct">${renderOptionValue(question, correctId)}</dd></div>
        </dl>
        <div class="explanation">
          <h3 class="section-title">${icons.book(14)} Explanation</h3>
          <div class="prose">${renderMarkdown(question.explanation)}</div>
        </div>
      </div>
    </details>`;
}

export function renderSummaryView({ questions, state, summary, confirmRestart }) {
  const keyOf = (question, optionId) => question.options.find((o) => o.id === optionId)?.key ?? optionId;
  const rows = questions
    .map((question, index) => {
      const answer = state.answers[question.id];
      const status = questionStatus(answer);
      const evaluation = answer?.status === 'done' ? answer.evaluation : null;
      return `
        <tr data-testid="summary-row" data-status="${status}" data-question-id="${escapeHtml(question.id)}">
          <td class="mono">${index + 1}</td>
          <td><span class="summary-title">${renderInline(question.title)}</span><span class="muted small">${escapeHtml(question.category)} · ${escapeHtml(question.difficulty)}</span></td>
          <td class="mono center">${evaluation ? escapeHtml(keyOf(question, evaluation.selectedOptionId)) : '—'}</td>
          <td class="mono center">${evaluation ? escapeHtml(evaluation.correctOptionId ? keyOf(question, evaluation.correctOptionId) : '?') : '—'}</td>
          <td><span class="${cx('status-tag', `status-tag--${status}`)}">${STATUS_LABELS[status]}</span></td>
          <td class="mono right">${evaluation ? evaluation.pointsEarned : 0} / ${question.points}</td>
        </tr>`;
    })
    .join('');

  const { performance } = summary;
  const reason = END_REASONS[state.endReason];
  const unansweredNote = summary.unanswered
    ? `<p class="summary-note">${icons.alert(14)} ${summary.unanswered} question${summary.unanswered === 1 ? ' was' : 's were'} not completed and earned no points. They don't count against accuracy.</p>`
    : '';
  const report = buildInterviewerSummary(questions, state, summary);

  return `
    <article class="summary" data-testid="summary">
      <header class="summary__hero">
        <div>
          <p class="eyebrow">Assessment result</p>
          <p class="${cx('end-reason', state.endReason === 'timeout' && 'end-reason--timeout')}" data-testid="end-reason" data-reason="${escapeHtml(state.endReason ?? '')}">${reason ? reason.icon() : ''}<span>${reason ? `<span data-testid="completion-status">${reason.label}</span>` : ''}${state.durationMinutes ? ` · ${state.durationMinutes}-minute quiz` : ''} · <span data-testid="summary-total">${summary.totalQuestions}</span> questions</span></p>
          <h1 class="summary__score"><span data-testid="summary-percentage">${summary.percentage}%</span></h1>
          <p class="${cx('performance', `performance--${performance.tone}`)}">Performance: <strong data-testid="summary-performance">${performance.label}</strong> <span class="muted small">· based on points scored</span></p>
        </div>
        <div class="score-bar" aria-hidden="true"><div class="score-bar__fill score-bar__fill--${performance.tone}" style="width:${summary.percentage}%"></div></div>
      </header>

      <div class="stats">
        ${stat('Score', `${summary.earnedPoints} / ${summary.totalPoints}`, 'summary-points')}
        ${stat('Accuracy', `${summary.accuracy}%`, 'summary-accuracy')}
        ${stat('Correct', summary.correct, 'summary-correct', 'success')}
        ${stat('Incorrect', summary.incorrect, 'summary-incorrect', 'danger')}
        ${stat('Unanswered', summary.unanswered, 'summary-unanswered')}
        ${stat('Time spent', formatDuration(timeSpentMs(state)), 'summary-time')}
      </div>
      ${unansweredNote}
      ${renderTabSwitches(state)}

      ${renderInterviewerSummary(report)}

      <div class="table-wrap">
        <table class="summary-table">
          <thead><tr><th>#</th><th>Question</th><th class="center">Answer</th><th class="center">Correct</th><th>Status</th><th class="right">Points</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <section class="review" aria-labelledby="review-title">
        <h2 id="review-title" class="section-title">Answer review</h2>
        ${questions.map((question, index) => renderReviewItem(question, index, state.answers[question.id])).join('')}
      </section>

      <div class="summary__actions">
        <button class="${cx('btn', confirmRestart ? 'btn--danger' : 'btn--secondary')}" data-action="restart">${icons.restart()} ${confirmRestart ? 'Confirm: discard answers' : 'Start a new interview'}</button>
      </div>
    </article>`;
}
