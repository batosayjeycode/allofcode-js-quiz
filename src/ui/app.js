/**
 * Application shell: wires the session store, the execution engine and the
 * view components together. Rendering is a full re-render of three regions
 * (header, navigator, main) — the DOM is small, so this stays simple and fast.
 */
import { computeSummary } from '../state/scoring.js';
import { renderHeader } from './components/header.js';
import { renderNavigator } from './components/navigator.js';
import { renderQuestionView } from './components/questionView.js';
import { renderSummaryView } from './components/summaryView.js';

const RESTART_CONFIRM_MS = 4000;

/**
 * @param {HTMLElement} root
 * @param {{ questions: Array, store: ReturnType<import('../state/session.js').createSessionStore>, execute: (code: string) => Promise<any> }} deps
 */
export function mountApp(root, { questions, store, execute }) {
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
  let sessionToken = 0; // invalidates in-flight runs after a restart

  const currentQuestion = () => questions[store.getState().currentIndex];

  function render({ scrollTop = false } = {}) {
    const state = store.getState();
    const summary = computeSummary(questions, state.answers);
    const focusedOption = document.activeElement?.matches?.('input[name="answer"]');

    regions.header.innerHTML = renderHeader({ summary, view: state.view, confirmRestart: ui.confirmRestart });
    regions.nav.innerHTML = renderNavigator({ questions, state });

    if (state.view === 'summary') {
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

    regions.nav.querySelector('.is-current')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (scrollTop) {
      regions.main.scrollTop = 0;
      window.scrollTo?.({ top: 0 });
    }
  }

  async function runCurrent() {
    const state = store.getState();
    if (state.view !== 'question') return;
    const question = currentQuestion();
    const answer = state.answers[question.id];
    if (!answer?.selectedOptionId || answer.status !== 'idle') return;

    const token = sessionToken;
    store.dispatch({ type: 'runStarted', questionId: question.id });
    const result = await execute(question.code);
    if (token !== sessionToken) return;
    store.dispatch({ type: 'runCompleted', questionId: question.id, result });
  }

  function requestRestart() {
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
    sessionToken += 1;
    store.dispatch({ type: 'restart' });
  }

  const actions = {
    run: runCurrent,
    next: () => store.dispatch({ type: 'next' }),
    previous: () => store.dispatch({ type: 'previous' }),
    'go-to': (el) => store.dispatch({ type: 'goTo', index: Number(el.dataset.index) }),
    'show-summary': () => store.dispatch({ type: 'showSummary' }),
    'back-to-questions': () => store.dispatch({ type: 'goTo', index: store.getState().currentIndex }),
    restart: requestRestart,
  };

  root.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || target.disabled || !root.contains(target)) return;
    actions[target.dataset.action]?.(target);
  });

  root.addEventListener('change', (event) => {
    if (event.target.matches('input[name="answer"]')) {
      store.dispatch({ type: 'selectOption', questionId: currentQuestion().id, optionId: event.target.value });
    }
  });

  document.addEventListener('keydown', (event) => {
    if (store.getState().view !== 'question') return;
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
  });

  store.subscribe((_state, action) => {
    const navigated = ['goTo', 'next', 'previous', 'showSummary', 'restart'].includes(action.type);
    render({ scrollTop: navigated });
  });

  render();
}
