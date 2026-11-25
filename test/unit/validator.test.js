import { describe, expect, it } from 'vitest';
import { deepEqual, evaluateAnswer, matchesExpectation } from '../../src/engine/validator.js';
import { output, throws, timesOut, values } from '../../src/questions/helpers.js';
import { normalizeQuestion } from '../../src/questions/schema.js';

const log = (text, ...vals) => ({
  level: 'log',
  text,
  args: vals.length ? vals.map((v) => ({ text: String(v), cloneable: true, value: v })) : [{ text, cloneable: true, value: text }],
});
const success = (...logs) => ({ status: 'success', logs, error: null, errors: [], durationMs: 1, truncated: false });
const failure = (name, message = '', logs = [], phase = 'sync') => ({
  status: 'error',
  logs,
  error: { name, message, phase },
  errors: [],
  durationMs: 1,
  truncated: false,
});
const timeout = { status: 'timeout', logs: [], error: { name: 'TimeoutError', message: '' }, durationMs: 3000, truncated: true };

describe('deepEqual', () => {
  it('uses SameValue semantics for primitives', () => {
    expect(deepEqual(NaN, NaN)).toBe(true);
    expect(deepEqual(0, -0)).toBe(false);
    expect(deepEqual(undefined, null)).toBe(false);
    expect(deepEqual('1', 1)).toBe(false);
  });
  it('compares nested structures', () => {
    expect(deepEqual({ a: [1, { b: new Set([1]) }] }, { a: [1, { b: new Set([1]) }] })).toBe(true);
    expect(deepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(deepEqual(new Map([[1, { x: 1 }]]), new Map([[1, { x: 1 }]]))).toBe(true);
    expect(deepEqual([1, undefined], [1])).toBe(false);
    expect(deepEqual(new Date(1), new Date(1))).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });
  it('handles cycles', () => {
    const a = { v: 1 };
    a.self = a;
    const b = { v: 1 };
    b.self = b;
    expect(deepEqual(a, b)).toBe(true);
  });
});

describe('matchesExpectation', () => {
  it('matches console output line by line with whitespace normalisation', () => {
    expect(matchesExpectation(output('1', '2'), success(log('1'), log(' 2 ')))).toBe(true);
    expect(matchesExpectation(output('1', '2'), success(log('2'), log('1')))).toBe(false);
    expect(matchesExpectation(output('1'), success(log('1'), log('2')))).toBe(false);
  });

  it('distinguishes "undefined" output from an error', () => {
    expect(matchesExpectation(output('undefined'), success(log('undefined', undefined)))).toBe(true);
    expect(matchesExpectation(output('undefined'), failure('ReferenceError'))).toBe(false);
  });

  it('compares logged values structurally', () => {
    const result = success(log('[3, 3, 3]', [3, 3, 3]));
    expect(matchesExpectation(values([3, 3, 3]), result)).toBe(true);
    expect(matchesExpectation(values(['3', '3', '3']), result)).toBe(false);
    expect(matchesExpectation(values(NaN), success(log('NaN', NaN)))).toBe(true);
  });

  it('matches errors by name, message fragment and preceding output', () => {
    const result = failure('Error', 'boom', [log('got object')], 'promise');
    expect(matchesExpectation(throws('Error'), result)).toBe(true);
    expect(matchesExpectation(throws('Error', { messageIncludes: 'boom', logs: ['got object'] }), result)).toBe(true);
    expect(matchesExpectation(throws('Error', { logs: [] }), result)).toBe(false);
    expect(matchesExpectation(throws('TypeError'), result)).toBe(false);
    expect(matchesExpectation(throws('Error', { messageIncludes: 'other' }), result)).toBe(false);
  });

  it('matches timeouts only to timeout expectations', () => {
    expect(matchesExpectation(timesOut(), timeout)).toBe(true);
    expect(matchesExpectation(output(), timeout)).toBe(false);
    expect(matchesExpectation(throws('TimeoutError'), timeout)).toBe(false);
  });
});

describe('evaluateAnswer', () => {
  const question = normalizeQuestion({
    id: 'T-1',
    title: 't',
    category: 'c',
    difficulty: 'Basic',
    description: 'd',
    code: 'console.log(a); var a = 1;',
    options: [output('1'), output('undefined'), throws('ReferenceError')],
    answer: 'B',
    explanation: 'e',
    points: 2,
  });

  it('marks a matching answer correct and awards points', () => {
    const evaluation = evaluateAnswer(question, 'B', success(log('undefined', undefined)));
    expect(evaluation).toMatchObject({ isCorrect: true, correctOptionId: 'B', pointsEarned: 2, consistentWithAnswerKey: true });
  });

  it('marks a wrong answer incorrect', () => {
    const evaluation = evaluateAnswer(question, 'C', success(log('undefined', undefined)));
    expect(evaluation).toMatchObject({ isCorrect: false, correctOptionId: 'B', pointsEarned: 0 });
  });

  it('accepts a runtime error as the right answer when it actually happens', () => {
    const evaluation = evaluateAnswer(question, 'C', failure('ReferenceError', 'a is not defined'));
    expect(evaluation).toMatchObject({ isCorrect: true, correctOptionId: 'C', consistentWithAnswerKey: false });
  });

  it('never awards points when no option matches (e.g. timeout)', () => {
    const evaluation = evaluateAnswer(question, 'A', timeout);
    expect(evaluation).toMatchObject({ isCorrect: false, correctOptionId: null, matchedOptionIds: [] });
  });
});
