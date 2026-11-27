/**
 * Quiz session state: a pure reducer plus a small observable store persisted
 * to storage (localStorage in the app), shared by every tab of the quiz.
 *
 * Phase flow (strictly forward; any action that does not belong to the
 * current phase is ignored):
 *
 *   intro ──(start)──▶ preparation ──(5 min deadline)──▶ durationSelection ──(pick 5/10/15)──▶ quiz
 *   quiz ──(all questions run, or deadline)──▶ result ──(restart)──▶ intro
 *
 * `intro` is the landing page of a new session: nothing is timed yet, and
 * `start` is the only action it accepts. No other phase can return to it
 * except a restart of a finished quiz.
 *
 * Anti-cheat rules enforced here:
 * - Deadlines are absolute timestamps. Every action carries `now`, and passed
 *   deadlines are applied *before* the action, so a late tick, a throttled tab
 *   or a reload can never extend a phase or score a late run.
 * - The store's clock never runs backwards (a persisted high-water mark), so
 *   moving the system clock back doesn't add time.
 * - Storage is the source of truth: every dispatch re-reads it first, so tabs
 *   share one session and a stale tab can't overwrite a newer state.
 * - Persisted data is validated on load and every new state is validated
 *   before it is saved. Invalid or stale data starts a clean session.
 *
 * Each session is dealt a random question and option order when it is created
 * (see order.js); the order is saved with the session and never reshuffled.
 *
 * Answer lifecycle per question:  idle (option selectable) -> running -> done (locked)
 */
import { evaluateAnswer } from '../engine/validator.js';
import { createSessionOrder, identityOrder, isValidOrder, secureRandom } from './order.js';

const STORAGE_VERSION = 4;

export const PREPARATION_MS = 5 * 60_000;
export const QUIZ_DURATIONS = Object.freeze([5, 10, 15]); // minutes
export const PHASES = Object.freeze(['intro', 'preparation', 'durationSelection', 'quiz', 'result']);
export const END_REASONS = Object.freeze(['completed', 'timeout']);
/** A run still "running" after this long was interrupted (reload, closed tab) and is re-run. Above the 3 s execution timeout. */
export const RUN_STALE_MS = 5_000;
/** Sessions left untouched this long (outside an active quiz) are discarded. */
export const STALE_SESSION_MS = 24 * 60 * 60_000;

const newSessionId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function createInitialState(questions, now = Date.now(), random = secureRandom) {
  return {
    version: STORAGE_VERSION,
    sessionId: newSessionId(),
    questionIds: questions.map((q) => q.id),
    ...createSessionOrder(questions, random),
    phase: 'intro',
    startedAt: null, // set when the candidate starts the challenge
    updatedAt: now,
    preparationEndsAt: null,
    durationMinutes: null,
    quizStartedAt: null,
    quizEndsAt: null,
    endedAt: null,
    endReason: null, // 'completed' | 'timeout'
    currentIndex: 0,
    answers: {},
    tabSwitches: 0, // times the quiz tab was hidden during the quiz
    hiddenMs: 0, // total time hidden during the quiz
    hiddenSince: null,
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
  const hiddenMs = state.hiddenSince === null ? state.hiddenMs : state.hiddenMs + Math.max(0, at - state.hiddenSince);
  return { ...state, phase: 'result', answers, endedAt: at, endReason: reason, hiddenMs, hiddenSince: null };
}

/** Applies every deadline that has passed at `now`. */
export function applyDeadlines(state, now) {
  if (!Number.isFinite(now)) return state;
  if (state.phase === 'preparation' && now >= state.preparationEndsAt) {
    return { ...state, phase: 'durationSelection', updatedAt: now };
  }
  if (state.phase === 'quiz' && now >= state.quizEndsAt) {
    return { ...finishQuiz(state, 'timeout', state.quizEndsAt), updatedAt: now };
  }
  return state;
}

export function createReducer(questions, { random = secureRandom } = {}) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const lastIndex = questions.length - 1;
  const allDone = (answers) => questions.every((q) => answers[q.id]?.status === 'done');

  function handle(state, action) {
    const inQuiz = state.phase === 'quiz';
    // Actions tagged with a session (async run results) only apply to that session.
    if (action.sessionId !== undefined && action.sessionId !== state.sessionId) return state;

    switch (action.type) {
      case 'start': {
        if (state.phase !== 'intro') return state;
        return { ...state, phase: 'preparation', startedAt: action.now, preparationEndsAt: action.now + PREPARATION_MS };
      }

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
        if (current?.selectedOptionId === action.optionId) return state;
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
          answers: { ...state.answers, [action.questionId]: { ...current, status: 'running', runStartedAt: action.now } },
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

      case 'visibilityChange': {
        if (!inQuiz) return state;
        if (action.hidden) {
          if (state.hiddenSince !== null) return state;
          return { ...state, tabSwitches: state.tabSwitches + 1, hiddenSince: action.now };
        }
        if (state.hiddenSince === null) return state;
        return { ...state, hiddenSince: null, hiddenMs: state.hiddenMs + Math.max(0, action.now - state.hiddenSince) };
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
        return state.phase === 'result' ? createInitialState(questions, action.now, random) : state;

      default: // 'tick', 'sync': deadlines were already applied
        return state;
    }
  }

  return function reduce(state, action) {
    const now = Number.isFinite(action.now) ? action.now : Date.now();
    const current = applyDeadlines(state, now);
    const next = handle(current, { ...action, now });
    if (next === current) return current;
    return next.updatedAt === now ? next : { ...next, updatedAt: now };
  };
}

const isTimestamp = (value) => Number.isFinite(value) && value > 0;
const isCount = (value) => Number.isInteger(value) && value >= 0;

/** Structural and logical consistency of a session. Used on load and before every save. */
export function validateState(s, questions) {
  if (!s || typeof s !== 'object' || s.version !== STORAGE_VERSION) return false;
  const ids = questions.map((q) => q.id);
  if (JSON.stringify(s.questionIds) !== JSON.stringify(ids)) return false;
  if (typeof s.sessionId !== 'string' || !s.sessionId || !PHASES.includes(s.phase)) return false;
  if (!isTimestamp(s.updatedAt)) return false;
  if (s.phase === 'intro') {
    if (s.startedAt !== null || s.preparationEndsAt !== null) return false;
  } else {
    if (!isTimestamp(s.startedAt) || s.updatedAt < s.startedAt) return false;
    if (s.preparationEndsAt !== s.startedAt + PREPARATION_MS) return false;
  }
  if (!isValidOrder(s, questions)) return false;
  if (!Number.isInteger(s.currentIndex) || s.currentIndex < 0 || s.currentIndex >= ids.length) return false;
  if (!isCount(s.tabSwitches) || !Number.isFinite(s.hiddenMs) || s.hiddenMs < 0) return false;
  if (s.hiddenSince !== null && (s.phase !== 'quiz' || !isTimestamp(s.hiddenSince))) return false;

  const started = s.phase === 'quiz' || s.phase === 'result';
  if (started) {
    if (!QUIZ_DURATIONS.includes(s.durationMinutes)) return false;
    if (!isTimestamp(s.quizStartedAt) || s.quizStartedAt < s.preparationEndsAt) return false;
    if (s.quizEndsAt !== s.quizStartedAt + s.durationMinutes * 60_000) return false;
  } else if (s.durationMinutes !== null || s.quizStartedAt !== null || s.quizEndsAt !== null) {
    return false;
  }

  if (s.phase === 'result') {
    if (!END_REASONS.includes(s.endReason) || !isTimestamp(s.endedAt)) return false;
    if (s.endedAt < s.quizStartedAt || s.endedAt > s.quizEndsAt) return false;
    if (s.endReason === 'timeout' && s.endedAt !== s.quizEndsAt) return false;
  } else if (s.endReason !== null || s.endedAt !== null) {
    return false;
  }

  if (!s.answers || typeof s.answers !== 'object' || Array.isArray(s.answers)) return false;
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const [id, answer] of Object.entries(s.answers)) {
    const question = byId.get(id);
    if (!started || !question || !answer || typeof answer !== 'object') return false;
    if (!question.options.some((o) => o.id === answer.selectedOptionId)) return false;
    if (answer.status === 'running') {
      if (s.phase !== 'quiz' || !isTimestamp(answer.runStartedAt)) return false;
    } else if (answer.status === 'done') {
      if (!answer.result || typeof answer.result !== 'object' || !answer.evaluation) return false;
    } else if (answer.status !== 'idle') {
      return false;
    }
  }
  if (s.endReason === 'completed' && !questions.every((q) => s.answers[q.id]?.status === 'done')) return false;
  return true;
}

/** A session nobody has touched for a day (outside an active quiz) is discarded. */
function isStale(s, now) {
  if (s.phase === 'quiz') return false; // its own deadline ends it
  const lastActivity = s.phase === 'result' ? s.endedAt : s.updatedAt;
  return now - lastActivity > STALE_SESSION_MS;
}

/**
 * Restores a persisted session, or returns null when it is invalid, belongs to
 * another question set, or is stale. Scores are recomputed from the stored
 * execution results rather than trusted.
 */
export function hydrateState(stored, questions, now = Date.now()) {
  // Sessions saved before randomization (version 3) keep the authored order.
  const saved =
    stored?.version === 3 && stored.questionOrder === undefined
      ? { ...stored, version: STORAGE_VERSION, ...identityOrder(questions) }
      : stored;
  if (!validateState(saved, questions) || isStale(saved, now)) return null;
  const byId = new Map(questions.map((q) => [q.id, q]));
  const answers = {};
  for (const [id, answer] of Object.entries(saved.answers)) {
    answers[id] =
      answer.status === 'done'
        ? { ...answer, evaluation: evaluateAnswer(byId.get(id), answer.selectedOptionId, answer.result) }
        : answer;
  }
  return { ...saved, answers };
}

/**
 * @param {Array} questions
 * @param {{ storage?: Storage | null, storageKey?: string, now?: () => number, random?: () => number }} [options]
 */
export function createSessionStore(
  questions,
  { storage = null, storageKey = 'js-quiz:session', now = Date.now, random = secureRandom } = {},
) {
  const reduce = createReducer(questions, { random });
  const listeners = new Set();
  const clockKey = `${storageKey}:clock`;

  const read = (key) => {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const save = (key, value) => {
    try {
      storage?.setItem(key, value);
      return true;
    } catch {
      return false; // storage unavailable or full: the session still works in memory
    }
  };

  // Monotonic clock: the highest time ever seen (persisted, shared by tabs).
  // Setting the system clock back can't make a deadline further away.
  let highWater = Number(read(clockKey)) || 0;
  let clockSavedAt = 0;
  function clock() {
    highWater = Math.max(now(), highWater);
    if (Math.abs(highWater - clockSavedAt) >= 1000) {
      clockSavedAt = highWater;
      save(clockKey, String(highWater));
    }
    return highWater;
  }

  let state = null;
  let lastRaw = null; // the serialized form of `state` as last read or written

  /** Parses a raw stored value: the current state if unchanged, a hydrated state, or null if missing/invalid/stale. */
  function resolve(raw) {
    if (raw !== null && raw === lastRaw) return state;
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw);
      if (Number.isFinite(parsed?.updatedAt)) highWater = Math.max(highWater, parsed.updatedAt);
      return hydrateState(parsed, questions, clock());
    } catch {
      return null;
    }
  }

  function write(next) {
    const raw = JSON.stringify(next);
    lastRaw = save(storageKey, raw) ? raw : lastRaw;
  }

  {
    const raw = read(storageKey);
    const restored = resolve(raw);
    state = applyDeadlines(restored ?? createInitialState(questions, clock(), random), clock());
    // Re-save when loading changed anything (deadlines applied, older version migrated).
    if (restored && state === restored && raw === JSON.stringify(restored)) lastRaw = raw;
    else write(state);
  }

  function notify(action, previous) {
    for (const listener of listeners) listener(state, action, previous);
  }

  function dispatch(action) {
    const previous = state;
    for (let attempt = 0; ; attempt += 1) {
      // Storage is the source of truth: start from what another tab may have saved.
      const raw = read(storageKey);
      const stored = resolve(raw);
      const base = stored ?? state; // missing or invalid storage: keep (and re-save) the in-memory session
      let next = reduce(base, { ...action, now: clock() });
      if (next !== base && !validateState(next, questions)) next = base; // never persist an inconsistent state

      const needsWrite = next !== base || stored === null;
      // Another tab wrote between our read and our write: redo the action on top of its state.
      if (needsWrite && read(storageKey) !== raw && attempt < 2) continue;
      if (needsWrite) write(next);
      else lastRaw = raw;

      state = next;
      if (state !== previous) notify(action, previous);
      return state;
    }
  }

  return {
    getState: () => state,
    /** Current time from the monotonic clock. */
    now: clock,
    dispatch,
    /** Re-reads storage (another tab's changes) and applies passed deadlines. */
    sync: () => dispatch({ type: 'sync' }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
