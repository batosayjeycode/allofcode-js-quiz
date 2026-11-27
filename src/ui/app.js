/**
 * Application shell: wires the session store, the execution engine, the
 * deadline ticker and the view components together. Rendering is a full
 * re-render of three regions (header, navigator, main) on state changes —
 * the DOM is small, so this stays simple and fast. Countdown text is the one
 * exception: it is updated in place every tick so focus and scroll survive.
 */
import { computeSummary } from '../state/scoring.js';
import { createOrderedQuestions } from '../state/order.js';
import { PREPARATION_MS, QUIZ_DURATIONS, RUN_STALE_MS } from '../state/session.js';
import { createTicker, formatCountdown, remainingMs } from '../state/timer.js';
import { renderHeader } from './components/header.js';
import { renderLandingView } from './components/landingView.js';
import { renderNavigator } from './components/navigator.js';
import { renderDurationView, renderPreparationView } from './components/phaseViews.js';
import { renderQuestionView } from './components/questionView.js';
import { renderSummaryView } from './components/summaryView.js';

const RESTART_CONFIRM_MS = 4000;
const LOW_TIME_MS = 60_000;
const TIMED_PHASES = new Set(['preparation', 'quiz']);
const HISTORY_GUARD = 'jsQuizGuard';
/** Length of the landing page's exit animation before the preparation phase opens. */
const START_TRANSITION_MS = 450;

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * @param {HTMLElement} root
 * @param {{
 *   questions: Array,
 *   store: ReturnType<import('../state/session.js').createSessionStore>,
 *   execute: (code: string) => Promise<any>,
 * }} deps
 * @returns {() => void} unmount: removes every listener and timer
 */
export function mountApp(root, { questions, store, execute }) {
  const now = store.now; // monotonic clock shared with the session
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

  const ui = { confirmRestart: false, confirmTimer: null, starting: false, startTimer: null, revealObserver: null };
  const ownRuns = new Set(); // question ids this tab is executing right now

  // The session's randomized order (stable for the whole session, across reloads and tabs).
  const orderedQuestions = createOrderedQuestions(questions);
  const sessionQuestions = () => orderedQuestions(store.getState());
  const currentQuestion = () => sessionQuestions()[store.getState().currentIndex];

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
      resumeInterruptedRuns();
    },
  });

  function syncTicker(phase) {
    if (TIMED_PHASES.has(phase)) ticker.start();
    else ticker.stop();
  }

  /**
   * Keeps the current question visible inside the navigator by scrolling only the
   * navigator itself. On narrow screens it is a static strip above the question,
   * where scrollIntoView would also scroll the page and make it jump on every answer.
   */
  function revealInNav(item) {
    if (!item) return;
    const nav = regions.nav;
    const box = nav.getBoundingClientRect();
    const rect = item.getBoundingClientRect();
    if (rect.left < box.left) nav.scrollLeft -= box.left - rect.left;
    else if (rect.right > box.right) nav.scrollLeft += rect.right - box.right;
    if (rect.top < box.top) nav.scrollTop -= box.top - rect.top;
    else if (rect.bottom > box.bottom) nav.scrollTop += rect.bottom - box.bottom;
  }

  function render({ scrollTop = false } = {}) {
    const state = store.getState();
    const questions = sessionQuestions();
    const summary = computeSummary(questions, state.answers);
    const focusedOption = document.activeElement?.matches?.('input[name="answer"]');

    regions.header.innerHTML = renderHeader({ summary, phase: state.phase, confirmRestart: ui.confirmRestart });
    // The landing page lists no question content: reading starts with the timed preparation.
    regions.nav.innerHTML = state.phase === 'intro' ? '' : renderNavigator({ questions, state });
    ui.revealObserver?.disconnect();
    ui.revealObserver = null;

    if (state.phase === 'intro') {
      regions.main.innerHTML = renderLandingView({
        questions,
        durations: QUIZ_DURATIONS,
        preparationMinutes: PREPARATION_MS / 60_000,
        starting: ui.starting,
      });
      observeReveals();
    } else if (state.phase === 'preparation') {
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
      if (focusedOption) regions.main.querySelector('input[name="answer"]:checked')?.focus({ preventScroll: true });
    }

    root.dataset.phase = state.phase;
    updateCountdown();
    syncTicker(state.phase);
    syncHistoryGuard(state.phase);

    if (state.phase === 'quiz') {
      revealInNav(regions.nav.querySelector('.is-current'));
    }
    if (scrollTop) {
      regions.main.scrollTop = 0;
      window.scrollTo?.({ top: 0 });
    }
  }

  /**
   * Executes a question whose answer is already locked ("running"). The result is
   * tagged with its session, and the reducer re-checks the deadline with the
   * completion time, so a run that finishes after time is up, after a restart,
   * or after another tab completed it, is discarded rather than scored.
   */
  async function executeRun(question, sessionId) {
    if (ownRuns.has(question.id)) return;
    ownRuns.add(question.id);
    try {
      const result = await execute(question.code);
      store.dispatch({ type: 'runCompleted', questionId: question.id, result, sessionId });
    } finally {
      ownRuns.delete(question.id);
    }
  }

  async function runCurrent() {
    const state = store.getState();
    if (state.phase !== 'quiz') return;
    const question = currentQuestion();
    const answer = state.answers[question.id];
    if (!answer?.selectedOptionId || answer.status !== 'idle') return;

    const next = store.dispatch({ type: 'runStarted', questionId: question.id });
    if (next.answers[question.id]?.status !== 'running') return; // the quiz ended or another tab ran it first
    await executeRun(question, next.sessionId);
  }

  /**
   * A run interrupted by a reload or a closed tab stays locked ("running") in the
   * saved session. Once it is clearly abandoned, run it again so the locked
   * answer gets its result; the answer itself can't be changed in between.
   */
  function resumeInterruptedRuns() {
    const state = store.getState();
    if (state.phase !== 'quiz') return;
    const t = now();
    for (const question of questions) {
      const answer = state.answers[question.id];
      if (answer?.status === 'running' && t - answer.runStartedAt >= RUN_STALE_MS) executeRun(question, state.sessionId);
    }
  }

  /**
   * Back/forward can't leave an active quiz: a guard history entry is kept on top,
   * and popping it pushes it straight back. The view always follows the session
   * state, so any navigation into the app lands on the current phase (the result,
   * once the quiz is over).
   */
  function syncHistoryGuard(phase) {
    if (phase !== 'quiz' || window.history?.state?.[HISTORY_GUARD]) return;
    try {
      window.history.pushState({ ...(window.history.state ?? {}), [HISTORY_GUARD]: true }, '');
    } catch {
      /* history unavailable (sandboxed iframe) */
    }
  }

  /** Fades landing sections in as they scroll into view (progressive enhancement: visible without it). */
  function observeReveals() {
    const targets = regions.main.querySelectorAll('[data-reveal]');
    if (!targets.length || prefersReducedMotion() || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    for (const el of targets) {
      el.classList.add('reveal');
      observer.observe(el);
    }
    ui.revealObserver = observer;
  }

  /**
   * Landing CTA: plays a short exit animation, then starts the session. The reducer
   * only accepts `start` from the intro phase, so this can never reset or skip an
   * active or finished session (e.g. one another tab already started).
   */
  function startChallenge() {
    if (store.getState().phase !== 'intro' || ui.starting) return;
    if (prefersReducedMotion()) {
      store.dispatch({ type: 'start' });
      return;
    }
    ui.starting = true;
    render();
    ui.startTimer = setTimeout(() => {
      ui.startTimer = null;
      ui.starting = false;
      store.dispatch({ type: 'start' });
      if (store.getState().phase === 'intro') render(); // start was refused: show the landing again
    }, START_TRANSITION_MS);
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
    start: startChallenge,
    'select-duration': (el) => store.dispatch({ type: 'selectDuration', minutes: Number(el.dataset.minutes) }),
    restart: requestRestart,
    'export-pdf': exportPdf,
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
    // Letter keys follow the displayed (shuffled) letters.
    const key = event.key.length === 1 ? event.key.toUpperCase() : '';
    const option = currentQuestion().options.find((o) => o.key === key);
    if (option) store.dispatch({ type: 'selectOption', questionId: currentQuestion().id, optionId: option.id });
  }

  // Leaving mid-quiz doesn't pause or reset anything (the session is saved), but
  // ask first so it isn't done by accident.
  function onBeforeUnload(event) {
    if (store.getState().phase !== 'quiz') return;
    event.preventDefault();
    event.returnValue = '';
  }

  function onPopState() {
    if (store.getState().phase === 'quiz') syncHistoryGuard('quiz');
    store.sync();
  }

  // Hidden tabs (switching tabs, minimizing) are recorded; the countdown keeps running.
  function onVisibilityChange() {
    store.dispatch({ type: 'visibilityChange', hidden: document.visibilityState === 'hidden' });
  }

  // Another tab changed the session (or the page came back from the back/forward cache).
  const onExternalChange = () => store.sync();
  // Any interaction re-checks the deadlines first.
  const onInteraction = () => store.dispatch({ type: 'tick' });

  /**
   * PDF export uses the browser's print dialog ("Save as PDF"): a real, text-based
   * PDF with no extra dependency. The print stylesheet turns the result page into a
   * report; here every review item is expanded and the document title becomes the
   * suggested file name. The same happens for Ctrl/Cmd+P on the result page.
   */
  const printState = { title: null, closed: [] };

  function exportFileName(state) {
    const at = new Date(state.endedAt ?? now());
    const pad = (n) => String(n).padStart(2, '0');
    const summary = computeSummary(sessionQuestions(), state.answers);
    return `js-quiz-result-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}-${summary.earnedPoints}of${summary.totalPoints}`;
  }

  function onBeforePrint() {
    const state = store.getState();
    if (state.phase !== 'result' || printState.title !== null) return;
    printState.title = document.title;
    printState.closed = [...regions.main.querySelectorAll('details:not([open])')];
    for (const details of printState.closed) details.open = true;
    document.title = exportFileName(state);
  }

  function onAfterPrint() {
    if (printState.title === null) return;
    document.title = printState.title;
    for (const details of printState.closed) if (details.isConnected) details.open = false;
    printState.title = null;
    printState.closed = [];
  }

  function exportPdf() {
    if (store.getState().phase !== 'result') return;
    onBeforePrint(); // some browsers fire beforeprint late or not at all for window.print()
    try {
      window.print();
    } finally {
      // print() blocks until the dialog closes in most browsers; afterprint restores too.
      if (!('onafterprint' in window)) onAfterPrint();
    }
  }

  const listeners = [
    [root, 'click', onClick],
    [root, 'change', onChange],
    [document, 'keydown', onKeydown],
    [document, 'pointerdown', onInteraction, true],
    [document, 'visibilitychange', onVisibilityChange],
    [window, 'beforeunload', onBeforeUnload],
    [window, 'popstate', onPopState],
    [window, 'storage', onExternalChange],
    [window, 'pageshow', onExternalChange],
    [window, 'focus', onExternalChange],
    [window, 'beforeprint', onBeforePrint],
    [window, 'afterprint', onAfterPrint],
  ];
  for (const [target, type, fn, capture] of listeners) target.addEventListener(type, fn, capture);

  const unsubscribe = store.subscribe((state, action, previous) => {
    const phaseChanged = state.phase !== previous.phase || state.sessionId !== previous.sessionId;
    if (phaseChanged) {
      clearTimeout(ui.confirmTimer);
      ui.confirmRestart = false;
      clearTimeout(ui.startTimer);
      ui.startTimer = null;
      ui.starting = false;
    }
    const navigated = phaseChanged || ['goTo', 'next', 'previous'].includes(action.type);
    render({ scrollTop: navigated });
    if (phaseChanged && previous.phase === 'intro' && state.phase === 'preparation') {
      regions.main.querySelector('.phase')?.classList.add('phase--enter');
    }
    if (phaseChanged) regions.main.focus?.({ preventScroll: true });
  });

  render();
  onVisibilityChange(); // closes a hidden period left open by a reload, or opens one for a background tab
  resumeInterruptedRuns();

  return function unmount() {
    ticker.stop();
    clearTimeout(ui.confirmTimer);
    clearTimeout(ui.startTimer);
    ui.revealObserver?.disconnect();
    unsubscribe();
    for (const [target, type, fn, capture] of listeners) target.removeEventListener(type, fn, capture);
  };
}
