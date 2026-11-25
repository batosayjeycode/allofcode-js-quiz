import { describe, expect, it } from 'vitest';
import { output, throws } from '../../src/questions/helpers.js';
import { normalizeQuestion } from '../../src/questions/schema.js';
import { buildInterviewerSummary, formatDuration } from '../../src/state/assessment.js';
import { createOrderedQuestions, createSessionOrder, identityOrder, isValidOrder, optionKey, shuffle } from '../../src/state/order.js';
import { computeSummary } from '../../src/state/scoring.js';

/** Deterministic PRNG (mulberry32) for repeatable shuffles in tests. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const make = (id, difficulty, category, answer = 'A') =>
  normalizeQuestion({
    id,
    title: `Title ${id}`,
    category,
    difficulty,
    description: 'd',
    code: 'console.log(1)',
    options: [output('1'), output('2'), output('3'), throws('TypeError')],
    answer,
    explanation: 'e',
  });

const bank = [
  make('Q1', 'Easy', 'Scope & Hoisting'),
  make('Q2', 'Medium', 'Event Loop'),
  make('Q3', 'Medium', 'Scope & Hoisting'),
  make('Q4', 'Hard', 'Event Loop'),
  make('Q5', 'Hard', 'Functions'),
];

const done = (isCorrect, points, selectedOptionId = 'A') => ({
  status: 'done',
  selectedOptionId,
  evaluation: { isCorrect, pointsEarned: isCorrect ? points : 0, selectedOptionId, correctOptionId: 'A' },
});

describe('randomization', () => {
  it('shuffles into a permutation without mutating the input', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const result = shuffle(items, seeded(1));
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...result].sort()).toEqual(items);
    expect(result).not.toEqual(items);
  });

  it('deals a valid order of questions and options, different per session', () => {
    const a = createSessionOrder(bank, seeded(1));
    const b = createSessionOrder(bank, seeded(2));
    expect(isValidOrder(a, bank)).toBe(true);
    expect(isValidOrder(b, bank)).toBe(true);
    expect(a).not.toEqual(b);
    expect(createSessionOrder(bank, seeded(1))).toEqual(a);
  });

  it('rejects orders that drop, repeat or invent ids', () => {
    const order = identityOrder(bank);
    expect(isValidOrder(order, bank)).toBe(true);
    expect(isValidOrder({ ...order, questionOrder: ['Q1', 'Q1', 'Q2', 'Q3', 'Q4'] }, bank)).toBe(false);
    expect(isValidOrder({ ...order, questionOrder: order.questionOrder.slice(1) }, bank)).toBe(false);
    expect(isValidOrder({ ...order, optionOrder: { ...order.optionOrder, Q1: ['A', 'B', 'C', 'Z'] } }, bank)).toBe(false);
    expect(isValidOrder({ ...order, optionOrder: null }, bank)).toBe(false);
  });

  it('relabels shuffled options by position while keeping their ids and the answer key', () => {
    const state = { sessionId: 's', ...identityOrder(bank) };
    state.questionOrder = ['Q3', 'Q1', 'Q2', 'Q4', 'Q5'];
    state.optionOrder = { ...state.optionOrder, Q3: ['C', 'A', 'D', 'B'] };
    const ordered = createOrderedQuestions(bank)(state);
    expect(ordered.map((q) => q.id)).toEqual(['Q3', 'Q1', 'Q2', 'Q4', 'Q5']);
    const q3 = ordered[0];
    expect(q3.options.map((o) => [o.key, o.id])).toEqual([
      ['A', 'C'],
      ['B', 'A'],
      ['C', 'D'],
      ['D', 'B'],
    ]);
    expect(q3.answer).toBe('A'); // still the authored id
    expect(optionKey(q3, q3.answer)).toBe('B'); // shown to the candidate as B
    expect(q3.options.find((o) => o.id === 'A').display).toEqual(['1']);
  });

  it('reuses the ordered questions for the same session', () => {
    const order = createOrderedQuestions(bank);
    const state = { sessionId: 's', ...createSessionOrder(bank, seeded(3)) };
    expect(order(state)).toBe(order({ ...state }));
    expect(order({ ...state, sessionId: 't' })).not.toBe(order(state));
  });
});

describe('scoring by difficulty', () => {
  it('scores points by difficulty and keeps unanswered out of accuracy', () => {
    const answers = {
      Q1: done(true, 1),
      Q2: done(false, 2, 'B'),
      Q4: done(true, 3),
      Q5: { status: 'idle', selectedOptionId: 'A' }, // selected, never run
    };
    const summary = computeSummary(bank, answers);
    expect(summary).toMatchObject({
      totalQuestions: 5,
      completed: 3,
      correct: 2,
      incorrect: 1,
      unanswered: 2,
      earnedPoints: 4,
      totalPoints: 11,
      percentage: 36.4,
      accuracy: 66.7,
    });
    expect(summary.byDifficulty).toEqual({
      Easy: { total: 1, correct: 1, incorrect: 0, unanswered: 0, earnedPoints: 1, totalPoints: 1, accuracy: 100 },
      Medium: { total: 2, correct: 0, incorrect: 1, unanswered: 1, earnedPoints: 0, totalPoints: 4, accuracy: 0 },
      Hard: { total: 2, correct: 1, incorrect: 0, unanswered: 1, earnedPoints: 3, totalPoints: 6, accuracy: 100 },
    });
  });

  it('reports zero accuracy when nothing was answered', () => {
    expect(computeSummary(bank, {})).toMatchObject({ completed: 0, accuracy: 0, percentage: 0, unanswered: 5 });
  });
});

describe('interviewer summary', () => {
  const state = (answers, extra = {}) => ({
    answers,
    endReason: 'timeout',
    durationMinutes: 10,
    quizStartedAt: 1_000,
    endedAt: 1_000 + 10 * 60_000,
    tabSwitches: 0,
    hiddenMs: 0,
    ...extra,
  });

  it('derives strengths, improvements, follow-ups and notes from the answers', () => {
    const answers = { Q1: done(true, 1), Q3: done(true, 2), Q2: done(false, 2, 'B'), Q4: done(true, 3) };
    const s = state(answers, { tabSwitches: 2, hiddenMs: 75_000 });
    const report = buildInterviewerSummary(bank, s, computeSummary(bank, answers));

    expect(report.overall.label).toBe('Fair');
    expect(report.overall.headline).toBe(
      '6 of 11 points (54.5%). 3 of 4 answered questions correct (75% accuracy); 4 of 5 questions answered.',
    );
    expect(report.strengths.map((t) => t.category)).toEqual(['Scope & Hoisting']);
    // Most incorrect first, then most unanswered.
    expect(report.improvements.map((t) => [t.category, t.incorrect, t.unanswered])).toEqual([
      ['Event Loop', 1, 0],
      ['Functions', 0, 1],
    ]);
    expect(report.byDifficulty.map((d) => d.difficulty)).toEqual(['Easy', 'Medium', 'Hard']);
    expect(report.followUps.map((f) => f.topic)).toEqual(['Event Loop', 'Functions']);
    expect(report.followUps[0].prompt).toMatch(/Microtasks vs macrotasks/);
    expect(report.followUps[0].questions.map((q) => [q.id, q.status])).toEqual([['Q2', 'incorrect']]);
    expect(report.notes).toEqual([
      'Time expired after 10 minutes with 1 question unanswered.',
      'Left the quiz tab 2 times (1m 15s away). Worth asking about.',
      'Strong on Hard questions: 1 of 1 answered correctly.',
    ]);
  });

  it('is identical whatever order the session showed the questions in', () => {
    const answers = { Q1: done(false, 1, 'B'), Q4: done(true, 3), Q5: done(false, 3, 'C') };
    const reports = [1, 2, 3].map((seed) => {
      const ordered = createOrderedQuestions(bank)({ sessionId: String(seed), ...createSessionOrder(bank, seeded(seed)) });
      return buildInterviewerSummary(ordered, state(answers), computeSummary(ordered, answers));
    });
    expect(reports[1]).toEqual(reports[0]);
    expect(reports[2]).toEqual(reports[0]);
    expect(reports[0].notes).toContain('Missed 1 Easy question: check the fundamentals.');
  });

  it('suggests a depth check on Hard questions after a perfect score', () => {
    const answers = Object.fromEntries(bank.map((q) => [q.id, done(true, q.points)]));
    const report = buildInterviewerSummary(
      bank,
      state(answers, { endReason: 'completed', endedAt: 1_000 + 4 * 60_000 + 5_000 }),
      computeSummary(bank, answers),
    );
    expect(report.overall.label).toBe('Excellent');
    expect(report.improvements).toEqual([]);
    expect(report.followUps).toHaveLength(1);
    expect(report.followUps[0]).toMatchObject({ topic: 'Depth check' });
    expect(report.followUps[0].questions.map((q) => q.id)).toEqual(['Q4', 'Q5']);
    expect(report.notes[0]).toBe('Completed all questions in 4m 05s of the 10-minute limit.');
  });

  it('falls back to a generic prompt for unknown categories, and handles no answers', () => {
    const odd = [make('Z1', 'Medium', 'Regex')];
    const report = buildInterviewerSummary(odd, state({}), computeSummary(odd, {}));
    expect(report.followUps[0].prompt).toBe('Ask the candidate to explain the core rules behind Regex.');
    expect(report.overall.headline).toBe('No questions answered: 0 of 2 points.');
    expect(formatDuration(59_400)).toBe('59s');
  });
});
