import { describe, expect, it, vi } from 'vitest';
import { output, throws } from '../../src/questions/helpers.js';
import { normalizeQuestion } from '../../src/questions/schema.js';
import { computeSummary, performanceFor } from '../../src/state/scoring.js';
import { createReducer, createSessionStore, hydrateState, PREPARATION_MS, QUIZ_DURATIONS } from '../../src/state/session.js';
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

  it('persists and restores the session, unlocking interrupted runs', () => {
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
    expect(restored.answers.Q2).toEqual({ status: 'idle', selectedOptionId: 'B' });
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
