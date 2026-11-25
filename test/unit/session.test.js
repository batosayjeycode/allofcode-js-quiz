import { describe, expect, it } from 'vitest';
import { output, throws } from '../../src/questions/helpers.js';
import { normalizeQuestion } from '../../src/questions/schema.js';
import { computeSummary, performanceFor } from '../../src/state/scoring.js';
import { createReducer, createSessionStore, hydrateState } from '../../src/state/session.js';

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

function answer(store, id, optionId) {
  store.dispatch({ type: 'selectOption', questionId: id, optionId });
  store.dispatch({ type: 'runStarted', questionId: id });
  store.dispatch({ type: 'runCompleted', questionId: id, result });
}

describe('session reducer', () => {
  it('requires a selection before running', () => {
    const store = createSessionStore(questions);
    store.dispatch({ type: 'runStarted', questionId: 'Q1' });
    expect(store.getState().answers.Q1).toBeUndefined();
  });

  it('locks the answer once the run starts', () => {
    const store = createSessionStore(questions);
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
    const state = createSessionStore(questions).getState();
    expect(reduce(state, { type: 'selectOption', questionId: 'Q1', optionId: 'Z' })).toBe(state);
    expect(reduce(state, { type: 'runCompleted', questionId: 'Q1', result })).toBe(state);
  });

  it('navigates and clamps indexes, and shows the summary after the last question', () => {
    const store = createSessionStore(questions);
    store.dispatch({ type: 'previous' });
    expect(store.getState().currentIndex).toBe(0);
    store.dispatch({ type: 'next' });
    store.dispatch({ type: 'next' });
    expect(store.getState().currentIndex).toBe(2);
    store.dispatch({ type: 'next' });
    expect(store.getState().view).toBe('summary');
    store.dispatch({ type: 'goTo', index: 99 });
    expect(store.getState()).toMatchObject({ currentIndex: 2, view: 'question' });
  });

  it('restarts with a clean state', () => {
    const store = createSessionStore(questions);
    answer(store, 'Q1', 'A');
    store.dispatch({ type: 'restart' });
    expect(store.getState().answers).toEqual({});
  });

  it('persists and restores the session, unlocking interrupted runs', () => {
    const storage = memoryStorage();
    const store = createSessionStore(questions, { storage });
    answer(store, 'Q1', 'A');
    store.dispatch({ type: 'selectOption', questionId: 'Q2', optionId: 'B' });
    store.dispatch({ type: 'runStarted', questionId: 'Q2' });
    store.dispatch({ type: 'goTo', index: 1 });

    const restored = createSessionStore(questions, { storage }).getState();
    expect(restored.currentIndex).toBe(1);
    expect(restored.answers.Q1.status).toBe('done');
    expect(restored.answers.Q2).toEqual({ status: 'idle', selectedOptionId: 'B' });
  });

  it('discards persisted state from a different question set', () => {
    const saved = createSessionStore(questions).getState();
    expect(hydrateState(saved, questions.slice(0, 2))).toBeNull();
    expect(hydrateState({ ...saved, version: 0 }, questions)).toBeNull();
  });
});

describe('scoring', () => {
  it('scores only completed questions, weighting points', () => {
    const store = createSessionStore(questions);
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
    const store = createSessionStore(questions);
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
