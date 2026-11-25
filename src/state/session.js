/**
 * Quiz session state: a pure reducer plus a tiny observable store with
 * optional sessionStorage persistence (survives an accidental page refresh).
 *
 * Phase flow (strictly forward; any action that does not belong to the
 * current phase is ignored):
 *
 *   preparation ──(5 min deadline)──▶ durationSelection ──(pick 5/10/15)──▶ quiz
 *   quiz ──(all questions run, or deadline)──▶ result ──(restart)──▶ preparation
 *
 * Deadlines are absolute timestamps. Every action carries `now`, and the
 * reducer applies any deadline that has passed *before* handling the action,
 * so a late tick, a throttled tab or a reload can never extend a phase.
 *
 * Answer lifecycle per question:  idle (option selectable) -> running -> done (locked)
 */
import { evaluateAnswer } from '../engine/validator.js';

const STORAGE_VERSION = 2;

export const PREPARATION_MS = 5 * 60_000;
export const QUIZ_DURATIONS = Object.freeze([5, 10, 15]); // minutes
export const PHASES = Object.freeze(['preparation', 'durationSelection', 'quiz', 'result']);

export function createInitialState(questions, now = Date.now()) {
  return {
    version: STORAGE_VERSION,
    questionIds: questions.map((q) => q.id),
    phase: 'preparation',
    preparationEndsAt: now + PREPARATION_MS,
    durationMinutes: null,
    quizStartedAt: null,
    quizEndsAt: null,
    endedAt: null,
    endReason: null, // 'completed' | 'timeout'
    currentIndex: 0,
    answers: {},
    startedAt: now,
  };
}

const isLocked = (answer) => answer?.status === 'running' || answer?.status === 'done';

/** Ends the quiz exactly once. Runs still in flight are discarded: those questions stay unanswered. */
function finishQuiz(state, reason, at) {
  if (state.phase !== 'quiz') return state;
  const answers = {};
  for (const [id, answer] of Object.entries(state.answers)) {
    answers[id] = answer.status === 'running' ? { status: 'idle', selectedOptionId: answer.selectedOptionId } : answer;
  }
  return { ...state, phase: 'result', answers, endedAt: at, endReason: reason };
}

/** Applies every deadline that has passed at `now`. */
export function applyDeadlines(state, now) {
  if (!Number.isFinite(now)) return state;
  if (state.phase === 'preparation' && now >= state.preparationEndsAt) {
    return { ...state, phase: 'durationSelection' };
  }
  if (state.phase === 'quiz' && now >= state.quizEndsAt) {
    return finishQuiz(state, 'timeout', state.quizEndsAt);
  }
  return state;
}

export function createReducer(questions) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const lastIndex = questions.length - 1;
  const allDone = (answers) => questions.every((q) => answers[q.id]?.status === 'done');

  function handle(state, action) {
    const inQuiz = state.phase === 'quiz';

    switch (action.type) {
      case 'tick':
        return state; // deadlines were already applied

      case 'selectDuration': {
        if (state.phase !== 'durationSelection' || !QUIZ_DURATIONS.includes(action.minutes)) return state;
        return {
          ...state,
          phase: 'quiz',
          durationMinutes: action.minutes,
          quizStartedAt: action.now,
          quizEndsAt: action.now + action.minutes * 60_000,
          currentIndex: 0,
        };
      }

      case 'selectOption': {
        const question = byId.get(action.questionId);
        const current = state.answers[action.questionId];
        if (!inQuiz || !question || isLocked(current)) return state;
        if (!question.options.some((o) => o.id === action.optionId)) return state;
        return {
          ...state,
          answers: { ...state.answers, [action.questionId]: { status: 'idle', selectedOptionId: action.optionId } },
        };
      }

      case 'runStarted': {
        const current = state.answers[action.questionId];
        if (!inQuiz || !current?.selectedOptionId || isLocked(current)) return state;
        return {
          ...state,
          answers: { ...state.answers, [action.questionId]: { ...current, status: 'running' } },
        };
      }

      case 'runCompleted': {
        const question = byId.get(action.questionId);
        const current = state.answers[action.questionId];
        if (!inQuiz || !question || current?.status !== 'running') return state;
        const answers = {
          ...state.answers,
          [action.questionId]: {
            ...current,
            status: 'done',
            result: action.result,
            evaluation: evaluateAnswer(question, current.selectedOptionId, action.result),
            completedAt: action.now,
          },
        };
        const next = { ...state, answers };
        return allDone(answers) ? finishQuiz(next, 'completed', action.now) : next;
      }

      case 'goTo': {
        if (!inQuiz) return state;
        const index = Math.max(0, Math.min(lastIndex, Number(action.index) || 0));
        return index === state.currentIndex ? state : { ...state, currentIndex: index };
      }

      case 'next':
        if (!inQuiz || state.currentIndex >= lastIndex) return state;
        return { ...state, currentIndex: state.currentIndex + 1 };

      case 'previous':
        if (!inQuiz || state.currentIndex === 0) return state;
        return { ...state, currentIndex: state.currentIndex - 1 };

      case 'restart':
        // Only a finished quiz can be restarted; otherwise a restart would reset the timers.
        return state.phase === 'result' ? createInitialState(questions, action.now) : state;

      default:
        return state;
    }
  }

  return function reduce(state, action) {
    const now = Number.isFinite(action.now) ? action.now : Date.now();
    const current = applyDeadlines(state, now);
    return handle(current, { ...action, now });
  };
}

const isTimestamp = (value) => Number.isFinite(value) && value > 0;

/** Restores a persisted state if it belongs to the same question set and is internally consistent. */
export function hydrateState(saved, questions) {
  if (!saved || saved.version !== STORAGE_VERSION) return null;
  const ids = questions.map((q) => q.id);
  if (JSON.stringify(saved.questionIds) !== JSON.stringify(ids)) return null;
  if (!PHASES.includes(saved.phase) || !isTimestamp(saved.preparationEndsAt)) return null;
  if (saved.phase === 'quiz' || saved.phase === 'result') {
    if (!QUIZ_DURATIONS.includes(saved.durationMinutes) || !isTimestamp(saved.quizEndsAt)) return null;
  }

  const answers = {};
  for (const [id, answer] of Object.entries(saved.answers ?? {})) {
    if (!ids.includes(id) || !answer) continue;
    // A run interrupted by a reload is not trusted: unlock it so it can be re-run.
    answers[id] = answer.status === 'running' ? { status: 'idle', selectedOptionId: answer.selectedOptionId } : answer;
  }
  return {
    ...saved,
    currentIndex: Math.max(0, Math.min(ids.length - 1, Number(saved.currentIndex) || 0)),
    answers,
  };
}

/**
 * @param {Array} questions
 * @param {{ storage?: Storage | null, storageKey?: string, now?: () => number }} [options]
 */
export function createSessionStore(questions, { storage = null, storageKey = 'js-interview-challenge:session', now = Date.now } = {}) {
  const reduce = createReducer(questions);
  const listeners = new Set();

  let state = null;
  try {
    const raw = storage?.getItem(storageKey);
    state = raw ? hydrateState(JSON.parse(raw), questions) : null;
  } catch {
    state = null;
  }
  state ??= createInitialState(questions, now());
  // Catch up on deadlines that passed while the page was closed or reloading.
  state = applyDeadlines(state, now());

  const persist = () => {
    try {
      storage?.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* storage unavailable or full — the session still works in memory */
    }
  };
  persist();

  return {
    getState: () => state,
    /** Every action is stamped with the current time so the reducer stays pure. */
    dispatch(action) {
      const previous = state;
      const next = reduce(state, { ...action, now: now() });
      if (next === state) return state;
      state = next;
      persist();
      for (const listener of listeners) listener(state, action, previous);
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
