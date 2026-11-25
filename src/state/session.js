/**
 * Interview session state: a pure reducer plus a tiny observable store with
 * optional sessionStorage persistence (survives an accidental page refresh).
 *
 * Answer lifecycle per question:  idle (option selectable) -> running -> done (locked)
 */
import { evaluateAnswer } from '../engine/validator.js';

const STORAGE_VERSION = 1;

export function createInitialState(questions) {
  return {
    version: STORAGE_VERSION,
    questionIds: questions.map((q) => q.id),
    currentIndex: 0,
    view: 'question', // 'question' | 'summary'
    answers: {},
    startedAt: Date.now(),
  };
}

const isLocked = (answer) => answer?.status === 'running' || answer?.status === 'done';

export function createReducer(questions) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const lastIndex = questions.length - 1;

  return function reduce(state, action) {
    switch (action.type) {
      case 'selectOption': {
        const question = byId.get(action.questionId);
        const current = state.answers[action.questionId];
        if (!question || isLocked(current)) return state;
        if (!question.options.some((o) => o.id === action.optionId)) return state;
        return {
          ...state,
          answers: { ...state.answers, [action.questionId]: { status: 'idle', selectedOptionId: action.optionId } },
        };
      }

      case 'runStarted': {
        const current = state.answers[action.questionId];
        if (!current?.selectedOptionId || isLocked(current)) return state;
        return {
          ...state,
          answers: { ...state.answers, [action.questionId]: { ...current, status: 'running' } },
        };
      }

      case 'runCompleted': {
        const question = byId.get(action.questionId);
        const current = state.answers[action.questionId];
        if (!question || current?.status !== 'running') return state;
        return {
          ...state,
          answers: {
            ...state.answers,
            [action.questionId]: {
              ...current,
              status: 'done',
              result: action.result,
              evaluation: evaluateAnswer(question, current.selectedOptionId, action.result),
              completedAt: Date.now(),
            },
          },
        };
      }

      case 'goTo': {
        const index = Math.max(0, Math.min(lastIndex, action.index));
        return { ...state, currentIndex: index, view: 'question' };
      }

      case 'next':
        return state.currentIndex >= lastIndex
          ? { ...state, view: 'summary' }
          : { ...state, currentIndex: state.currentIndex + 1, view: 'question' };

      case 'previous':
        return { ...state, currentIndex: Math.max(0, state.currentIndex - 1), view: 'question' };

      case 'showSummary':
        return { ...state, view: 'summary' };

      case 'restart':
        return createInitialState(questions);

      default:
        return state;
    }
  };
}

/** Restores a persisted state if it belongs to the same question set. */
export function hydrateState(saved, questions) {
  if (!saved || saved.version !== STORAGE_VERSION) return null;
  const ids = questions.map((q) => q.id);
  if (JSON.stringify(saved.questionIds) !== JSON.stringify(ids)) return null;

  const answers = {};
  for (const [id, answer] of Object.entries(saved.answers ?? {})) {
    if (!ids.includes(id) || !answer) continue;
    // A run interrupted by a reload is not trusted: unlock it so it can be re-run.
    answers[id] = answer.status === 'running' ? { status: 'idle', selectedOptionId: answer.selectedOptionId } : answer;
  }
  return {
    ...createInitialState(questions),
    ...saved,
    currentIndex: Math.max(0, Math.min(ids.length - 1, Number(saved.currentIndex) || 0)),
    view: saved.view === 'summary' ? 'summary' : 'question',
    answers,
  };
}

/**
 * @param {Array} questions
 * @param {{ storage?: Storage | null, storageKey?: string }} [options]
 */
export function createSessionStore(questions, { storage = null, storageKey = 'js-interview-challenge:session' } = {}) {
  const reduce = createReducer(questions);
  const listeners = new Set();

  let state = null;
  try {
    const raw = storage?.getItem(storageKey);
    state = raw ? hydrateState(JSON.parse(raw), questions) : null;
  } catch {
    state = null;
  }
  state ??= createInitialState(questions);

  const persist = () => {
    try {
      storage?.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* storage unavailable or full — the session still works in memory */
    }
  };

  return {
    getState: () => state,
    dispatch(action) {
      const next = reduce(state, action);
      if (next === state) return state;
      state = next;
      persist();
      for (const listener of listeners) listener(state, action);
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
