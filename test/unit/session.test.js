import { describe, expect, it, vi } from 'vitest';
import { output, throws } from '../../src/questions/helpers.js';
import { normalizeQuestion } from '../../src/questions/schema.js';
import { computeSummary, performanceFor } from '../../src/state/scoring.js';
import {
  createInitialState,
  createReducer,
  createSessionStore,
  hydrateState,
  PREPARATION_MS,
  QUIZ_DURATIONS,
  STALE_SESSION_MS,
  validateState,
} from '../../src/state/session.js';
import { createTicker, formatCountdown, remainingMs } from '../../src/state/timer.js';

const makeQuestion = (id, points = 1) =>
  normalizeQuestion({
    id,
    title: id,
    category: 'c',
    difficulty: 'Basic',
    description: 'd',
    code: 'console.log(1)',
    options: [output('1'), output('2'), throws('TypeError')],
    answer: 'A',
    explanation: 'e',
    points,
  });

const questions = [makeQuestion('Q1', 1), makeQuestion('Q2', 2), makeQuestion('Q3', 3)];
const result = { status: 'success', logs: [{ level: 'log', text: '1', args: [] }], error: null, errors: [], durationMs: 1, truncated: false };

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), data };
}

/** Manually advanced wall clock. */
function fakeClock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => (t += ms);
  return now;
}

const MINUTE = 60_000;

/** A store whose preparation has elapsed and whose quiz is running with `minutes` on the clock. */
function quizStore({ minutes = 15, storage, clock = fakeClock() } = {}) {
  const store = createSessionStore(questions, { storage, now: clock });
  clock.advance(PREPARATION_MS);
  store.dispatch({ type: 'selectDuration', minutes });
  return Object.assign(store, { clock });
}

function answer(store, id, optionId) {
  store.dispatch({ type: 'selectOption', questionId: id, optionId });
  store.dispatch({ type: 'runStarted', questionId: id });
  store.dispatch({ type: 'runCompleted', questionId: id, result });
}

describe('session reducer', () => {
  it('requires a selection before running', () => {
    const store = quizStore();
    store.dispatch({ type: 'runStarted', questionId: 'Q1' });
    expect(store.getState().answers.Q1).toBeUndefined();
  });

  it('locks the answer once the run starts', () => {
    const store = quizStore();
    store.dispatch({ type: 'selectOption', questionId: 'Q1', optionId: 'B' });
    store.dispatch({ type: 'selectOption', questionId: 'Q1', optionId: 'A' });
    expect(store.getState().answers.Q1.selectedOptionId).toBe('A');
    store.dispatch({ type: 'runStarted', questionId: 'Q1' });
    store.dispatch({ type: 'selectOption', questionId: 'Q1', optionId: 'B' });
    expect(store.getState().answers.Q1).toMatchObject({ status: 'running', selectedOptionId: 'A' });
    store.dispatch({ type: 'runCompleted', questionId: 'Q1', result });
    store.dispatch({ type: 'selectOption', questionId: 'Q1', optionId: 'B' });
    expect(store.getState().answers.Q1).toMatchObject({ status: 'done', selectedOptionId: 'A' });
    expect(store.getState().answers.Q1.evaluation.isCorrect).toBe(true);
  });

  it('ignores invalid option ids and stray completions', () => {
    const reduce = createReducer(questions);
    const store = quizStore();
    const state = store.getState();
    const now = store.clock();
    expect(reduce(state, { type: 'selectOption', questionId: 'Q1', optionId: 'Z', now })).toBe(state);
    expect(reduce(state, { type: 'runCompleted', questionId: 'Q1', result, now })).toBe(state);
  });

  it('navigates and clamps indexes without leaving the quiz', () => {
    const store = quizStore();
    store.dispatch({ type: 'previous' });
    expect(store.getState().currentIndex).toBe(0);
    store.dispatch({ type: 'next' });
    store.dispatch({ type: 'next' });
    expect(store.getState().currentIndex).toBe(2);
    store.dispatch({ type: 'next' });
    expect(store.getState()).toMatchObject({ currentIndex: 2, phase: 'quiz' });
    store.dispatch({ type: 'goTo', index: 0 });
    store.dispatch({ type: 'goTo', index: 99 });
    expect(store.getState()).toMatchObject({ currentIndex: 2, phase: 'quiz' });
  });

  it('only restarts a finished quiz, into a fresh preparation', () => {
    const store = quizStore({ minutes: 5 });
    answer(store, 'Q1', 'A');
    store.dispatch({ type: 'restart' });
    expect(store.getState()).toMatchObject({ phase: 'quiz', answers: { Q1: { status: 'done' } } });

    store.clock.advance(5 * MINUTE);
    store.dispatch({ type: 'tick' });
    store.dispatch({ type: 'restart' });
    expect(store.getState()).toMatchObject({
      phase: 'preparation',
      answers: {},
      durationMinutes: null,
      preparationEndsAt: store.clock() + PREPARATION_MS,
    });
  });

  it('persists and restores the session, keeping interrupted runs locked', () => {
    const storage = memoryStorage();
    const store = quizStore({ storage });
    answer(store, 'Q1', 'A');
    store.dispatch({ type: 'selectOption', questionId: 'Q2', optionId: 'B' });
    store.dispatch({ type: 'runStarted', questionId: 'Q2' });
    store.dispatch({ type: 'goTo', index: 1 });

    const restored = createSessionStore(questions, { storage, now: store.clock }).getState();
    expect(restored).toMatchObject({ phase: 'quiz', durationMinutes: 15, quizEndsAt: store.getState().quizEndsAt });
    expect(restored.currentIndex).toBe(1);
    expect(restored.answers.Q1.status).toBe('done');
    expect(restored.answers.Q2).toMatchObject({ status: 'running', selectedOptionId: 'B' });
  });

  it('discards persisted state from a different question set', () => {
    const saved = quizStore().getState();
    expect(hydrateState(saved, questions.slice(0, 2))).toBeNull();
    expect(hydrateState({ ...saved, version: 0 }, questions)).toBeNull();
    expect(hydrateState({ ...saved, phase: 'bogus' }, questions)).toBeNull();
    expect(hydrateState({ ...saved, durationMinutes: 60 }, questions)).toBeNull();
    expect(hydrateState({ ...saved, quizEndsAt: null }, questions)).toBeNull();
  });
});

describe('phase flow', () => {
  it('starts in a 5-minute preparation that ignores every quiz action', () => {
    const clock = fakeClock();
    const store = createSessionStore(questions, { now: clock });
    expect(store.getState()).toMatchObject({ phase: 'preparation', preparationEndsAt: clock() + 5 * MINUTE });

    const before = store.getState();
    for (const action of [
      { type: 'selectDuration', minutes: 5 },
      { type: 'selectOption', questionId: 'Q1', optionId: 'A' },
      { type: 'runStarted', questionId: 'Q1' },
      { type: 'goTo', index: 1 },
      { type: 'next' },
      { type: 'restart' },
    ]) {
      store.dispatch(action);
    }
    expect(store.getState()).toBe(before);

    clock.advance(PREPARATION_MS - 1);
    store.dispatch({ type: 'tick' });
    expect(store.getState().phase).toBe('preparation');
    clock.advance(1);
    store.dispatch({ type: 'tick' });
    expect(store.getState().phase).toBe('durationSelection');
  });

  it('applies a passed deadline before the action, even without a tick', () => {
    const clock = fakeClock();
    const store = createSessionStore(questions, { now: clock });
    clock.advance(PREPARATION_MS + 30 * MINUTE); // e.g. a long-throttled background tab
    store.dispatch({ type: 'selectDuration', minutes: 10 });
    expect(store.getState()).toMatchObject({ phase: 'quiz', durationMinutes: 10, quizEndsAt: clock() + 10 * MINUTE });
  });

  it('accepts only 5, 10 or 15 minutes, chosen once', () => {
    expect(QUIZ_DURATIONS).toEqual([5, 10, 15]);
    const clock = fakeClock();
    const store = createSessionStore(questions, { now: clock });
    clock.advance(PREPARATION_MS);
    for (const minutes of [0, 1, 7, 20, '5', -5, Number.NaN]) {
      store.dispatch({ type: 'selectDuration', minutes });
      expect(store.getState().phase).toBe('durationSelection');
    }
    store.dispatch({ type: 'selectDuration', minutes: 5 });
    const { quizEndsAt } = store.getState();
    store.dispatch({ type: 'selectDuration', minutes: 15 });
    expect(store.getState()).toMatchObject({ durationMinutes: 5, quizEndsAt });
  });

  it('ends with "completed" as soon as every question has been run', () => {
    const store = quizStore();
    answer(store, 'Q1', 'A');
    answer(store, 'Q2', 'B');
    expect(store.getState().phase).toBe('quiz');
    store.clock.advance(1234);
    answer(store, 'Q3', 'A');
    expect(store.getState()).toMatchObject({ phase: 'result', endReason: 'completed', endedAt: store.clock() });
  });

  it('ends with "timeout" at the deadline, leaving unfinished questions unanswered', () => {
    const store = quizStore({ minutes: 5 });
    answer(store, 'Q1', 'A');
    store.dispatch({ type: 'selectOption', questionId: 'Q2', optionId: 'A' });
    store.dispatch({ type: 'selectOption', questionId: 'Q3', optionId: 'A' });
    store.dispatch({ type: 'runStarted', questionId: 'Q3' });
    const { quizEndsAt } = store.getState();

    store.clock.advance(5 * MINUTE - 1);
    store.dispatch({ type: 'tick' });
    expect(store.getState().phase).toBe('quiz');
    store.clock.advance(1);
    store.dispatch({ type: 'tick' });

    const state = store.getState();
    expect(state).toMatchObject({ phase: 'result', endReason: 'timeout', endedAt: quizEndsAt });
    expect(state.answers.Q2).toEqual({ status: 'idle', selectedOptionId: 'A' });
    expect(state.answers.Q3).toEqual({ status: 'idle', selectedOptionId: 'A' }); // in-flight run discarded
    expect(computeSummary(questions, state.answers)).toMatchObject({ completed: 1, correct: 1, unanswered: 2 });
  });

  it('discards a run that completes after the deadline, even if no tick fired', () => {
    const store = quizStore({ minutes: 5 });
    store.dispatch({ type: 'selectOption', questionId: 'Q1', optionId: 'A' });
    store.dispatch({ type: 'runStarted', questionId: 'Q1' });
    store.clock.advance(5 * MINUTE + 10);
    store.dispatch({ type: 'runCompleted', questionId: 'Q1', result });
    expect(store.getState()).toMatchObject({ phase: 'result', endReason: 'timeout' });
    expect(store.getState().answers.Q1.status).toBe('idle');
  });

  it('completes only once and freezes every answer afterwards', () => {
    const store = quizStore({ minutes: 5 });
    const listener = [];
    store.subscribe((state, _action, previous) => {
      if (state.phase !== previous.phase) listener.push(state.phase);
    });
    store.clock.advance(5 * MINUTE);
    store.dispatch({ type: 'tick' });
    store.dispatch({ type: 'tick' });
    const frozen = store.getState();
    for (const action of [
      { type: 'selectOption', questionId: 'Q1', optionId: 'A' },
      { type: 'runStarted', questionId: 'Q1' },
      { type: 'runCompleted', questionId: 'Q1', result },
      { type: 'goTo', index: 1 },
      { type: 'previous' },
      { type: 'selectDuration', minutes: 15 },
    ]) {
      store.dispatch(action);
    }
    expect(store.getState()).toBe(frozen);
    expect(listener).toEqual(['result']);
  });

  it('keeps deadlines across a reload and catches up on time that passed while closed', () => {
    const storage = memoryStorage();
    const clock = fakeClock();
    createSessionStore(questions, { storage, now: clock });
    clock.advance(2 * MINUTE);
    const reloaded = createSessionStore(questions, { storage, now: clock });
    expect(reloaded.getState()).toMatchObject({ phase: 'preparation', preparationEndsAt: clock() + 3 * MINUTE });

    const quiz = quizStore({ minutes: 10, storage, clock: fakeClock(5_000_000) });
    quiz.clock.advance(11 * MINUTE);
    expect(createSessionStore(questions, { storage, now: quiz.clock }).getState()).toMatchObject({
      phase: 'result',
      endReason: 'timeout',
    });
  });
});

describe('timer helpers', () => {
  it('formats the remaining time from a deadline, rounding up', () => {
    expect(remainingMs(10_000, 4_000)).toBe(6_000);
    expect(remainingMs(10_000, 12_000)).toBe(0);
    expect(formatCountdown(5 * MINUTE)).toBe('05:00');
    expect(formatCountdown(59_001)).toBe('01:00');
    expect(formatCountdown(1)).toBe('00:01');
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-50)).toBe('00:00');
  });

  it('runs a single interval, wakes on visibility changes, and cleans up', () => {
    vi.useFakeTimers();
    try {
      const listeners = { window: new Map(), document: new Map() };
      const target = (name) => ({
        addEventListener: (type, fn) => listeners[name].set(type, fn),
        removeEventListener: (type, fn) => listeners[name].get(type) === fn && listeners[name].delete(type),
      });
      let ticks = 0;
      const ticker = createTicker({ onTick: () => (ticks += 1), intervalMs: 250, win: target('window'), doc: target('document') });

      ticker.start();
      ticker.start(); // idempotent: no second interval
      vi.advanceTimersByTime(1000);
      expect(ticks).toBe(4);
      listeners.document.get('visibilitychange')();
      expect(ticks).toBe(5);
      expect([...listeners.window.keys()].sort()).toEqual(['focus', 'pageshow']);

      ticker.stop();
      vi.advanceTimersByTime(1000);
      expect(ticks).toBe(5);
      expect(listeners.window.size + listeners.document.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('scoring', () => {
  it('scores only completed questions, weighting points', () => {
    const store = quizStore();
    answer(store, 'Q1', 'A'); // correct, 1pt
    answer(store, 'Q2', 'B'); // wrong
    store.dispatch({ type: 'selectOption', questionId: 'Q3', optionId: 'A' }); // selected but not run

    const summary = computeSummary(questions, store.getState().answers);
    expect(summary).toMatchObject({
      totalQuestions: 3,
      completed: 2,
      correct: 1,
      incorrect: 1,
      unanswered: 1,
      earnedPoints: 1,
      totalPoints: 6,
      percentage: 16.7,
    });
    expect(summary.performance.label).toBe('Needs Improvement');
  });

  it('reports a perfect score', () => {
    const store = quizStore();
    for (const q of questions) answer(store, q.id, 'A');
    const summary = computeSummary(questions, store.getState().answers);
    expect(summary).toMatchObject({ correct: 3, incorrect: 0, percentage: 100 });
    expect(summary.performance.label).toBe('Excellent');
  });

  it.each([
    [95, 'Excellent'],
    [70, 'Good'],
    [50, 'Fair'],
    [49.9, 'Needs Improvement'],
  ])('performance for %s%% is %s', (pct, label) => {
    expect(performanceFor(pct).label).toBe(label);
  });
});

describe('anti-cheat: persistence and tabs', () => {
  const KEY = 'js-quiz:session';

  it('reloading never resets the preparation or quiz deadline', () => {
    const storage = memoryStorage();
    const clock = fakeClock();
    const first = createSessionStore(questions, { storage, now: clock });
    const { sessionId, preparationEndsAt } = first.getState();
    for (let i = 0; i < 3; i += 1) {
      clock.advance(MINUTE);
      expect(createSessionStore(questions, { storage, now: clock }).getState()).toMatchObject({ sessionId, preparationEndsAt });
    }

    clock.advance(2 * MINUTE);
    const store = createSessionStore(questions, { storage, now: clock });
    store.dispatch({ type: 'selectDuration', minutes: 5 });
    const { quizEndsAt } = store.getState();
    clock.advance(MINUTE);
    const reloaded = createSessionStore(questions, { storage, now: clock });
    expect(reloaded.getState()).toMatchObject({ phase: 'quiz', sessionId, quizEndsAt });
    // An active quiz can't be restarted, from any tab.
    reloaded.dispatch({ type: 'restart' });
    expect(reloaded.getState()).toMatchObject({ phase: 'quiz', sessionId });
  });

  it('never lets the clock run backwards, so moving the system clock back adds no time', () => {
    const storage = memoryStorage();
    const clock = fakeClock(10 * MINUTE);
    const store = quizStore({ minutes: 5, storage, clock });
    clock.advance(4 * MINUTE);
    store.dispatch({ type: 'tick' });
    const before = store.now();

    clock.advance(-60 * MINUTE); // user moves the system clock back an hour
    expect(store.now()).toBe(before);
    // Also after a reload, which reads the persisted high-water mark.
    const reloaded = createSessionStore(questions, { storage, now: clock });
    expect(reloaded.now()).toBeGreaterThanOrEqual(before - 1000);
    clock.advance(61 * MINUTE + 1000);
    reloaded.dispatch({ type: 'tick' });
    expect(reloaded.getState()).toMatchObject({ phase: 'result', endReason: 'timeout' });
  });

  it('shares one session between tabs, and a stale tab cannot overwrite a finished quiz', () => {
    const storage = memoryStorage();
    const clock = fakeClock();
    const tabA = createSessionStore(questions, { storage, now: clock });
    const tabB = createSessionStore(questions, { storage, now: clock });
    expect(tabB.getState().sessionId).toBe(tabA.getState().sessionId);

    clock.advance(PREPARATION_MS);
    tabA.dispatch({ type: 'selectDuration', minutes: 10 });
    tabB.dispatch({ type: 'selectDuration', minutes: 15 }); // too late: tab A already chose
    expect(tabB.getState()).toMatchObject({ phase: 'quiz', durationMinutes: 10 });

    answer(tabA, 'Q1', 'A');
    answer(tabA, 'Q2', 'A');
    // Tab B still holds the older in-memory state, but acts on the stored one.
    tabB.dispatch({ type: 'selectOption', questionId: 'Q3', optionId: 'B' });
    expect(tabB.getState().answers.Q1.status).toBe('done');

    answer(tabA, 'Q3', 'A'); // completes the quiz
    expect(tabA.getState()).toMatchObject({ phase: 'result', endReason: 'completed' });
    for (const action of [
      { type: 'selectOption', questionId: 'Q3', optionId: 'C' },
      { type: 'runStarted', questionId: 'Q3' },
      { type: 'runCompleted', questionId: 'Q3', result },
      { type: 'goTo', index: 0 },
    ]) {
      tabB.dispatch(action);
    }
    expect(tabB.getState()).toMatchObject({ phase: 'result', endReason: 'completed' });
    expect(JSON.parse(storage.data.get(KEY))).toMatchObject({ phase: 'result', endReason: 'completed' });
  });

  it('runs a duplicate completion only once across tabs', () => {
    const storage = memoryStorage();
    const tabA = quizStore({ storage });
    const tabB = createSessionStore(questions, { storage, now: tabA.clock });
    tabA.dispatch({ type: 'selectOption', questionId: 'Q1', optionId: 'A' });
    tabA.dispatch({ type: 'runStarted', questionId: 'Q1' });
    tabB.dispatch({ type: 'runStarted', questionId: 'Q1' }); // already locked
    tabA.dispatch({ type: 'runCompleted', questionId: 'Q1', result });
    const completedAt = tabA.getState().answers.Q1.completedAt;
    tabA.clock.advance(500);
    tabB.dispatch({ type: 'runCompleted', questionId: 'Q1', result: { ...result, status: 'error' } });
    expect(tabB.getState().answers.Q1).toMatchObject({ status: 'done', completedAt });
  });

  it('ignores run results from another session (e.g. after a restart)', () => {
    const store = quizStore({ minutes: 5 });
    const { sessionId } = store.getState();
    store.dispatch({ type: 'selectOption', questionId: 'Q1', optionId: 'A' });
    store.dispatch({ type: 'runStarted', questionId: 'Q1' });
    store.dispatch({ type: 'runCompleted', questionId: 'Q1', result, sessionId: 'someone-else' });
    expect(store.getState().answers.Q1.status).toBe('running');
    store.dispatch({ type: 'runCompleted', questionId: 'Q1', result, sessionId });
    expect(store.getState().answers.Q1.status).toBe('done');
  });

  it('rewrites cleared or corrupted storage from memory instead of starting over', () => {
    const storage = memoryStorage();
    const store = quizStore({ storage });
    answer(store, 'Q1', 'A');
    const { sessionId } = store.getState();

    storage.data.delete(KEY);
    store.sync();
    expect(JSON.parse(storage.data.get(KEY))).toMatchObject({ sessionId, phase: 'quiz' });

    storage.data.set(KEY, '{not json');
    store.dispatch({ type: 'next' });
    expect(JSON.parse(storage.data.get(KEY))).toMatchObject({ sessionId, currentIndex: 1 });
  });

  it('starts a clean session from invalid, inconsistent or stale data', () => {
    const clock = fakeClock(100 * STALE_SESSION_MS);
    const valid = quizStore({ clock }).getState();
    const cases = {
      garbage: '{oops',
      array: '[]',
      wrongVersion: { ...valid, version: 2 },
      shiftedDeadline: { ...valid, quizEndsAt: valid.quizEndsAt + 10 * MINUTE },
      shortPreparation: { ...valid, preparationEndsAt: valid.preparationEndsAt - MINUTE },
      quizBeforePreparationEnded: { ...valid, quizStartedAt: valid.preparationEndsAt - 1, quizEndsAt: valid.preparationEndsAt - 1 + 15 * MINUTE },
      answersBeforeQuiz: { ...createInitialState(questions, clock()), answers: { Q1: { status: 'idle', selectedOptionId: 'A' } } },
      unknownOption: { ...valid, answers: { Q1: { status: 'idle', selectedOptionId: 'Z' } } },
      completedWithoutAnswers: { ...valid, phase: 'result', endReason: 'completed', endedAt: valid.quizStartedAt + 1 },
      negativeTabSwitches: { ...valid, tabSwitches: -1 },
    };
    for (const [name, value] of Object.entries(cases)) {
      const storage = memoryStorage();
      storage.setItem(KEY, typeof value === 'string' ? value : JSON.stringify(value));
      const state = createSessionStore(questions, { storage, now: clock }).getState();
      expect(state.phase, name).toBe('preparation');
      expect(state.sessionId, name).not.toBe(valid.sessionId);
    }

    // Stale: a result untouched for over a day.
    const storage = memoryStorage();
    const old = quizStore({ minutes: 5, storage, clock: fakeClock(100 * STALE_SESSION_MS) });
    old.clock.advance(5 * MINUTE);
    old.dispatch({ type: 'tick' });
    expect(createSessionStore(questions, { storage, now: old.clock }).getState().phase).toBe('result');
    old.clock.advance(STALE_SESSION_MS + 1);
    expect(createSessionStore(questions, { storage, now: old.clock }).getState().phase).toBe('preparation');
  });

  it('recomputes scores from the stored results instead of trusting them', () => {
    const store = quizStore();
    answer(store, 'Q1', 'B'); // wrong
    const saved = store.getState();
    const tampered = {
      ...saved,
      answers: { Q1: { ...saved.answers.Q1, evaluation: { ...saved.answers.Q1.evaluation, isCorrect: true, pointsEarned: 99 } } },
    };
    expect(validateState(tampered, questions)).toBe(true);
    const restored = hydrateState(tampered, questions, store.clock());
    expect(restored.answers.Q1.evaluation).toMatchObject({ isCorrect: false, pointsEarned: 0 });
  });
});

describe('anti-cheat: tab visibility', () => {
  it('counts tab switches and time away during the quiz only, without pausing the timer', () => {
    const clock = fakeClock();
    const store = createSessionStore(questions, { now: clock });
    store.dispatch({ type: 'visibilityChange', hidden: true }); // preparation: not counted
    clock.advance(PREPARATION_MS);
    store.dispatch({ type: 'selectDuration', minutes: 5 });
    const { quizEndsAt } = store.getState();

    store.dispatch({ type: 'visibilityChange', hidden: true });
    store.dispatch({ type: 'visibilityChange', hidden: true }); // duplicate event
    clock.advance(30_000);
    store.dispatch({ type: 'visibilityChange', hidden: false });
    store.dispatch({ type: 'visibilityChange', hidden: true });
    clock.advance(10_000);
    store.dispatch({ type: 'visibilityChange', hidden: false });
    expect(store.getState()).toMatchObject({ tabSwitches: 2, hiddenMs: 40_000, hiddenSince: null, quizEndsAt });

    // Hidden when time runs out: the open period is closed at the deadline.
    store.dispatch({ type: 'visibilityChange', hidden: true });
    clock.advance(10 * MINUTE);
    store.dispatch({ type: 'visibilityChange', hidden: false });
    expect(store.getState()).toMatchObject({
      phase: 'result',
      endReason: 'timeout',
      tabSwitches: 3,
      hiddenMs: 40_000 + (quizEndsAt - (quizEndsAt - 5 * MINUTE + 40_000)),
      hiddenSince: null,
    });
  });
});

describe('randomized order in the session', () => {
  const KEY = 'js-quiz:session';
  const seeded = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const many = Array.from({ length: 8 }, (_, i) => makeQuestion(`M${i + 1}`));

  it('deals an order once and keeps it across reloads and tabs', () => {
    const storage = memoryStorage();
    const clock = fakeClock();
    const first = createSessionStore(many, { storage, now: clock, random: seeded(7) });
    const { questionOrder, optionOrder } = first.getState();
    expect(questionOrder).not.toEqual(many.map((q) => q.id));

    // A reload or another tab uses a different random source, but must keep the saved order.
    for (const seed of [1, 2, 3]) {
      clock.advance(MINUTE);
      const state = createSessionStore(many, { storage, now: clock, random: seeded(seed) }).getState();
      expect(state.questionOrder).toEqual(questionOrder);
      expect(state.optionOrder).toEqual(optionOrder);
    }
  });

  it('deals a new order only when a finished quiz is restarted', () => {
    const clock = fakeClock();
    const store = createSessionStore(many, { now: clock, random: seeded(11) });
    const { questionOrder } = store.getState();
    clock.advance(PREPARATION_MS);
    store.dispatch({ type: 'selectDuration', minutes: 5 });
    expect(store.getState().questionOrder).toEqual(questionOrder);
    clock.advance(5 * MINUTE);
    store.dispatch({ type: 'restart' });
    expect(store.getState().phase).toBe('preparation');
    expect(store.getState().questionOrder).not.toEqual(questionOrder);
  });

  it('rejects a saved session whose order was tampered with', () => {
    const storage = memoryStorage();
    const clock = fakeClock();
    const saved = createSessionStore(many, { storage, now: clock }).getState();
    storage.setItem(KEY, JSON.stringify({ ...saved, questionOrder: saved.questionOrder.slice(1) }));
    expect(createSessionStore(many, { storage, now: clock }).getState().sessionId).not.toBe(saved.sessionId);
  });

  it('carries over a session saved before randomization, in the authored order', () => {
    const storage = memoryStorage();
    const store = quizStore({ storage });
    answer(store, 'Q1', 'A');
    const v3 = { ...store.getState(), version: 3 };
    delete v3.questionOrder;
    delete v3.optionOrder;
    storage.setItem(KEY, JSON.stringify(v3));

    const restored = createSessionStore(questions, { storage, now: store.clock }).getState();
    expect(restored).toMatchObject({ version: 4, phase: 'quiz', sessionId: v3.sessionId, quizEndsAt: v3.quizEndsAt });
    expect(restored.questionOrder).toEqual(['Q1', 'Q2', 'Q3']);
    expect(restored.optionOrder.Q1).toEqual(['A', 'B', 'C']);
    expect(restored.answers.Q1.status).toBe('done');
    expect(JSON.parse(storage.data.get(KEY)).version).toBe(4); // re-saved in the new format
  });
});
