/**
 * Landing page for a new session (the `intro` phase): what the challenge is,
 * how it is scored and timed, and its rules. Nothing is timed here and no
 * question content is shown, so reading it gives no head start. The single
 * call to action dispatches `start`, which opens the preparation phase.
 */
import { assessmentConfig } from '../../assessment.config.js';
import { cx, escapeHtml } from '../dom.js';
import { highlightLines } from '../highlight.js';
import { icons } from './icons.js';

// Teaser snippet for the hero. Deliberately not taken from the question bank.
const HERO_CODE = `const scores = [10, 9, 1];
scores.sort();

const tags = [...'js']
  .map((c, i) => c + i);

console.log(scores, tags);`;
const HERO_OUTPUT = "[ 1, 10, 9 ] [ 'j0', 's1' ]";

const TOPICS = [
  { glyph: 'typeof', title: 'JavaScript fundamentals', text: 'Values, operators, references and the rules everything else builds on.' },
  { glyph: '() =>', title: 'Scope & closures', text: 'Hoisting, the temporal dead zone, and what a function really captures.' },
  { glyph: '.map()', title: 'Array & object methods', text: 'Copies vs references, mutation, and what the built-ins return.' },
  { glyph: '==', title: 'Type coercion', text: 'When JavaScript converts values for you, and what it turns them into.' },
  { glyph: 'await', title: 'Async & the event loop', text: 'Promises, microtasks, timers, and the order output actually appears.' },
  { glyph: 'throw', title: 'Code behavior', text: '`this` binding, errors, and `finally` — reading code the way the engine runs it.' },
];

const DIFFICULTY_TONE = { Easy: 'easy', Medium: 'medium', Hard: 'hard' };
const DIFFICULTY_TEXT = {
  Easy: 'Core behavior every JavaScript developer meets daily.',
  Medium: 'Subtle rules that trip up experienced developers.',
  Hard: 'Engine-level details: ordering, binding and edge cases.',
};

const RESULT_METRICS = [
  ['Score', 'Points earned out of the total available.'],
  ['Accuracy', 'The share of questions you answered correctly.'],
  ['Correct · incorrect · unanswered', 'Exactly where every question landed.'],
  ['Difficulty breakdown', 'How you did on Easy, Medium and Hard questions.'],
  ['Answer explanations', 'Your answer, the real output, and why it happens.'],
];

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function renderHeroCode() {
  const lines = highlightLines(HERO_CODE)
    .map(
      (html, i) =>
        `<span class="code-line" style="--i:${i}"><span class="code-ln" aria-hidden="true">${i + 1}</span><span class="code-src">${html || ' '}</span></span>`,
    )
    .join('');
  return `
    <figure class="code-panel landing-code" aria-label="Example: predict what this code logs">
      <figcaption class="panel-head">
        <span class="window-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="panel-title">predict-the-output.js</span>
      </figcaption>
      <pre class="code"><code>${lines}</code></pre>
      <div class="landing-code__output">
        <span class="landing-code__prompt" aria-hidden="true">${icons.terminal(14)}</span>
        <span class="landing-code__question">What does it log?</span>
        <span class="landing-code__answer mono">${escapeHtml(HERO_OUTPUT)}</span>
      </div>
    </figure>`;
}

function section({ id, eyebrow, title, intro = '', body }) {
  return `
    <section class="landing-section" aria-labelledby="${id}" data-reveal>
      <header class="landing-section__head">
        <p class="eyebrow">${eyebrow}</p>
        <h2 class="landing-section__title" id="${id}">${title}</h2>
        ${intro ? `<p class="landing-section__intro">${intro}</p>` : ''}
      </header>
      ${body}
    </section>`;
}

/**
 * @param {{ questions: Array, durations: readonly number[], preparationMinutes: number, starting?: boolean }} props
 */
export function renderLandingView({ questions, durations, preparationMinutes, starting = false }) {
  const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);
  const counts = questions.reduce((acc, q) => ({ ...acc, [q.difficulty]: (acc[q.difficulty] ?? 0) + 1 }), {});
  const durationText = durations.join(' / ');

  // Deterministic spread (no Math.random, so renders are stable).
  const particles = Array.from(
    { length: 14 },
    (_, i) =>
      `<i style="left:${(i * 37) % 100}%;top:${(i * 53 + 7) % 60}%;animation-duration:${9 + (i % 5) * 1.6}s;animation-delay:${(-1.3 * i).toFixed(1)}s"></i>`,
  ).join('');

  const hero = `
    <section class="landing-hero" aria-labelledby="landing-title">
      <div class="landing-hero__copy">
        <p class="landing-kicker"><span class="landing-kicker__dot" aria-hidden="true"></span>JavaScript interview challenge</p>
        <h1 class="landing-title" id="landing-title">Predict the output.<br /><span class="landing-title__accent">Prove you know JavaScript.</span></h1>
        <p class="landing-lead">
          ${plural(questions.length, 'real-world snippet')}. Read the code, pick what it prints, then run it in a sandbox and
          see if you were right — against the clock.
        </p>
        <div class="landing-cta">
          <button class="btn btn--primary landing-cta__button" data-action="start" data-testid="start-challenge" ${starting ? 'disabled aria-busy="true"' : ''}>
            ${starting ? icons.spinner(18) : icons.play(16)} Start JavaScript Challenge
          </button>
          <p class="landing-cta__note">Starts your ${preparationMinutes}-minute preparation timer.</p>
        </div>
        <ul class="landing-facts" aria-label="Challenge at a glance">
          <li><strong>${questions.length}</strong> questions</li>
          <li><strong>${totalPoints}</strong> points</li>
          <li><strong>${preparationMinutes}</strong> min preparation</li>
          <li><strong>${durationText}</strong> min quiz</li>
        </ul>
      </div>
      <div class="landing-hero__visual">${renderHeroCode()}</div>
    </section>`;

  const about = section({
    id: 'landing-about',
    eyebrow: 'What is JS Quiz',
    title: 'A hands-on check of how well you read JavaScript',
    intro:
      'Most bugs come from code that does something slightly different than it looks. JS Quiz measures whether you can predict real behavior — not recite definitions — and shows you exactly where your mental model and the engine disagree.',
    body: `
      <div class="landing-grid landing-grid--3">
        <article class="landing-card">
          <span class="landing-card__icon" aria-hidden="true">${icons.book(18)}</span>
          <h3 class="landing-card__title">Read the code</h3>
          <p class="landing-card__text">Every question is a short, self-contained snippet with a few possible outputs.</p>
        </article>
        <article class="landing-card">
          <span class="landing-card__icon" aria-hidden="true">${icons.terminal(18)}</span>
          <h3 class="landing-card__title">Run it for real</h3>
          <p class="landing-card__text">Lock in an answer and execute the code in an isolated sandbox — no trick grading.</p>
        </article>
        <article class="landing-card">
          <span class="landing-card__icon" aria-hidden="true">${icons.check(18)}</span>
          <h3 class="landing-card__title">Learn from the result</h3>
          <p class="landing-card__text">Compare your prediction with the actual output and read why it behaves that way.</p>
        </article>
      </div>`,
  });

  const topics = section({
    id: 'landing-topics',
    eyebrow: 'Assessment topics',
    title: 'What you will be tested on',
    body: `
      <ul class="landing-grid landing-grid--3 landing-topics">
        ${TOPICS.map(
          (t) => `
          <li class="landing-card landing-topic">
            <code class="landing-topic__glyph" aria-hidden="true">${escapeHtml(t.glyph)}</code>
            <h3 class="landing-card__title">${escapeHtml(t.title)}</h3>
            <p class="landing-card__text">${escapeHtml(t.text).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>
          </li>`,
        ).join('')}
      </ul>`,
  });

  const scoring = section({
    id: 'landing-scoring',
    eyebrow: 'Scoring',
    title: 'Harder questions are worth more',
    intro: `Only a correct prediction earns points. This set has ${plural(questions.length, 'question')} worth <strong>${totalPoints} points</strong> in total.`,
    body: `
      <div class="landing-grid landing-grid--3">
        ${Object.entries(assessmentConfig.difficultyPoints)
          .map(
            ([difficulty, points]) => `
          <article class="${cx('landing-card', 'landing-score', `landing-score--${DIFFICULTY_TONE[difficulty]}`)}" data-testid="landing-score">
            <div class="landing-score__top">
              <span class="${cx('badge', `badge--${DIFFICULTY_TONE[difficulty]}`)}">${difficulty}</span>
              <span class="landing-score__count muted small">${plural(counts[difficulty] ?? 0, 'question')}</span>
            </div>
            <p class="landing-score__points"><strong>${points}</strong> ${points === 1 ? 'point' : 'points'}</p>
            <p class="landing-card__text">${DIFFICULTY_TEXT[difficulty] ?? ''}</p>
          </article>`,
          )
          .join('')}
      </div>`,
  });

  const flow = section({
    id: 'landing-flow',
    eyebrow: 'Assessment flow',
    title: 'Four steps, one sitting',
    body: `
      <ol class="landing-flow">
        <li class="landing-step">
          <span class="landing-step__num">1</span>
          <h3 class="landing-card__title">Preparation <span class="landing-step__time">${preparationMinutes} min</span></h3>
          <p class="landing-card__text">Read every question at your own pace. Answering and running code are disabled.</p>
        </li>
        <li class="landing-step">
          <span class="landing-step__num">2</span>
          <h3 class="landing-card__title">Choose duration <span class="landing-step__time">${durationText} min</span></h3>
          <p class="landing-card__text">Pick how long you want for the quiz. The choice is final.</p>
        </li>
        <li class="landing-step">
          <span class="landing-step__num">3</span>
          <h3 class="landing-card__title">Quiz</h3>
          <p class="landing-card__text">Select an answer and run the code. Each run locks that answer in.</p>
        </li>
        <li class="landing-step">
          <span class="landing-step__num">4</span>
          <h3 class="landing-card__title">Results</h3>
          <p class="landing-card__text">Shown once every question is run or the time runs out.</p>
        </li>
      </ol>`,
  });

  const rules = section({
    id: 'landing-rules',
    eyebrow: 'Rules',
    title: 'Before you start',
    intro: 'The timers are absolute, so the challenge is the same for everyone.',
    body: `
      <ul class="landing-rules">
        <li>${icons.clock(18)}<span><strong>The timer can't be paused or reset.</strong> Once it starts, it runs to the end.</span></li>
        <li>${icons.flag(18)}<span><strong>Switching tabs doesn't stop the timer.</strong> Each time you leave the quiz tab is shown on your result.</span></li>
        <li>${icons.restart(18)}<span><strong>Refreshing doesn't reset the session.</strong> You come back exactly where you left off.</span></li>
        <li>${icons.lock(18)}<span><strong>Answers lock after completion.</strong> A run locks its answer, and nothing changes once the quiz ends.</span></li>
      </ul>`,
  });

  const results = section({
    id: 'landing-results',
    eyebrow: 'Your results',
    title: 'A clear picture of what you know',
    body: `
      <dl class="landing-metrics">
        ${RESULT_METRICS.map(([term, text]) => `<div class="landing-metric"><dt>${term}</dt><dd>${text}</dd></div>`).join('')}
      </dl>`,
  });

  return `
    <div class="${cx('landing', starting && 'is-leaving')}" data-testid="landing">
      <div class="landing-bg" aria-hidden="true"><div class="landing-bg__grid"></div><div class="landing-bg__particles">${particles}</div></div>
      ${hero}
      ${about}
      ${topics}
      ${scoring}
      ${flow}
      ${rules}
      ${results}
    </div>`;
}
