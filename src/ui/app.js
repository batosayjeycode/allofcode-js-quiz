/**
 * Application shell: wires the session store, the execution engine, the
 * deadline ticker and the view components together. Rendering is a full
 * re-render of three regions (header, navigator, main) on state changes —
 * the DOM is small, so this stays simple and fast. Countdown text is the one
 * exception: it is updated in place every tick so focus and scroll survive.
 */
import { computeSummary } from '../state/scoring.js';
import { QUIZ_DURATIONS } from '../state/session.js';
import { createTicker, formatCountdown, remainingMs } from '../state/timer.js';
import { renderHeader } from './components/header.js';
import { renderNavigator } from './components/navigator.js';
import { renderDurationView, renderPreparationView } from './components/phaseViews.js';
import { renderQuestionView } from './components/questionView.js';
import { renderSummaryView } from './components/summaryView.js';

const RESTART_CONFIRM_MS = 4000;
const LOW_TIME_MS = 60_000;
const TIMED_PHASES = new Set(['preparation', 'quiz']);

/**
 * @param {HTMLElement} root
 * @param {{
 *   questions: Array,
 *   store: ReturnType<import('../state/session.js').createSessionStore>,
 *   execute: (code: string) => Promise<any>,
 *   now?: () => number,
 * }} deps
 * @returns {() => void} unmount: removes every listener and timer
 */
export function mountApp(root, { questions, store, execute, now = Date.now }) {
  root.innerHTML = `
    <header class="topbar" data-region="header"></header>
    <div class="layout">
      <aside class="sidebar" data-region="nav" aria-label="Question list"></aside>
      <main class="content" data-region="main" tabindex="-1"></main>
    </div>`;

  const regions = {
    header: root.querySelector('[data-region="header"]'),
    nav: root.querySelector('[data-region="nav"]'),
    main: root.querySelector('[data-region="main"]'),
  };

  const ui = { confirmRestart: false, confirmTimer: null };
  let sessionToken = 0; // invalidates in-flight runs once the quiz they belong to has ended

  const currentQuestion = () => questions[store.getState().currentIndex];

  function deadlineFor(state) {
    if (state.phase === 'preparation') return state.preparationEndsAt;
    if (state.phase === 'quiz') return state.quizEndsAt;
    return null;
  }

  /** Refreshes countdown text in place, from the deadline (never from a decremented counter). */
  function updateCountdown() {
    const state = store.getState();
    const deadline = deadlineFor(state);
    if (deadline === null) return;
    const left = remainingMs(deadline, now());
    const text = formatCountdown(left);
    for (const el of root.querySelectorAll('[data-timer-value]')) el.textContent = text;
    root
      .querySelector('[data-testid="timer"]')
      ?.classList.toggle('timer--low', state.phase === 'quiz' && left <= LOW_TIME_MS);
  }

  // One ticker for the whole app. A tick only asks the store to apply passed
  // deadlines; the store re-renders through the subscription when a phase ends.
  const ticker = createTicker({
    onTick() {
      store.dispatch({ type: 'tick' });
      updateCountdown();
    },
  });

  function syncTicker(phase) {
    if (TIMED_PHASES.has(phase)) ticker.start();
    else ticker.stop();
  }

  function render({ scrollTop = false } = {}) {
    const state = store.getState();
    const summary = computeSummary(questions, state.answers);
    const focusedOption = document.activeElement?.matches?.('input[name="answer"]');

    regions.header.innerHTML = renderHeader({ summary, phase: state.phase, confirmRestart: ui.confirmRestart });
    regions.nav.innerHTML = renderNavigator({ questions, state });

    if (state.phase === 'preparation') {
      regions.main.innerHTML = renderPreparationView({ questions });
    } else if (state.phase === 'durationSelection') {
      regions.main.innerHTML = renderDurationView({ durations: QUIZ_DURATIONS });
    } else if (state.phase === 'result') {
      regions.main.innerHTML = renderSummaryView({ questions, state, summary, confirmRestart: ui.confirmRestart });
    } else {
      const question = currentQuestion();
      regions.main.innerHTML = renderQuestionView({
        question,
        index: state.currentIndex,
        total: questions.length,
        answer: state.answers[question.id],
      });
      if (focusedOption) regions.main.querySelector('input[name="answer"]:checked')?.focus();
    }

    root.dataset.phase = state.phase;
    updateCountdown();
    syncTicker(state.phase);

    if (state.phase === 'quiz') {
      regions.nav.querySelector('.is-current')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    if (scrollTop) {
      regions.main.scrollTop = 0;
      window.scrollTo?.({ top: 0 });
    }
  }

  async function runCurrent() {
    const state = store.getState();
    if (state.phase !== 'quiz') return;
    const question = currentQuestion();
    const answer = state.answers[question.id];
    if (!answer?.selectedOptionId || answer.status !== 'idle') return;

    const token = sessionToken;
    store.dispatch({ type: 'runStarted', questionId: question.id });
    if (store.getState().answers[question.id]?.status !== 'running') return; // the quiz ended first
    const result = await execute(question.code);
    if (token !== sessionToken) return;
    // The reducer re-checks the deadline with the completion time, so a run that
    // finishes after time is up is discarded rather than scored.
    store.dispatch({ type: 'runCompleted', questionId: question.id, result });
  }

  function requestRestart() {
    if (store.getState().phase !== 'result') return;
    if (!ui.confirmRestart) {
      ui.confirmRestart = true;
      clearTimeout(ui.confirmTimer);
      ui.confirmTimer = setTimeout(() => {
        ui.confirmRestart = false;
        render();
      }, RESTART_CONFIRM_MS);
      render();
      return;
    }
    clearTimeout(ui.confirmTimer);
    ui.confirmRestart = false;
    store.dispatch({ type: 'restart' });
  }

  function previewQuestion(el) {
    regions.main
      .querySelector(`[data-preview-index="${Number(el.dataset.index)}"]`)
      ?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }

  const actions = {
    run: runCurrent,
    next: () => store.dispatch({ type: 'next' }),
    previous: () => store.dispatch({ type: 'previous' }),
    'go-to': (el) => store.dispatch({ type: 'goTo', index: Number(el.dataset.index) }),
    preview: previewQuestion,
    'select-duration': (el) => store.dispatch({ type: 'selectDuration', minutes: Number(el.dataset.minutes) }),
    restart: requestRestart,
  };

  function onClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target || target.disabled || !root.contains(target)) return;
    actions[target.dataset.action]?.(target);
  }

  function onChange(event) {
    if (store.getState().phase !== 'quiz') return;
    if (event.target.matches('input[name="answer"]')) {
      store.dispatch({ type: 'selectOption', questionId: currentQuestion().id, optionId: event.target.value });
    }
  }

  function onKeydown(event) {
    if (store.getState().phase !== 'quiz') return;
    if (event.target.closest?.('input[type="text"], textarea, [contenteditable="true"]')) return;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      runCurrent();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const optionId = event.key.length === 1 ? event.key.toUpperCase() : '';
    const question = currentQuestion();
    if (question.options.some((option) => option.id === optionId)) {
      store.dispatch({ type: 'selectOption', questionId: question.id, optionId });
    }
  }

  // Leaving mid-quiz doesn't pause the timer (the deadline is saved), but closing
  // the tab would lose the session, so ask first.
  function onBeforeUnload(event) {
    if (store.getState().phase !== 'quiz') return;
    event.preventDefault();
    event.returnValue = '';
  }

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('beforeunload', onBeforeUnload);

  const unsubscribe = store.subscribe((state, action, previous) => {
    const phaseChanged = state.phase !== previous.phase;
    if (phaseChanged && previous.phase === 'quiz') sessionToken += 1;
    if (phaseChanged) {
      clearTimeout(ui.confirmTimer);
      ui.confirmRestart = false;
    }
    const navigated = phaseChanged || ['goTo', 'next', 'previous'].includes(action.type);
    render({ scrollTop: navigated });
    if (phaseChanged) regions.main.focus?.({ preventScroll: true });
  });

  render();

  return function unmount() {
    ticker.stop();
    clearTimeout(ui.confirmTimer);
    unsubscribe();
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    document.removeEventListener('keydown', onKeydown);
    window.removeEventListener('beforeunload', onBeforeUnload);
  };
}
