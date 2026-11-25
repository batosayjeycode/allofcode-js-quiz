/**
 * Answer validation: compares a normalised ExecutionResult with the
 * expectation attached to each answer option.
 *
 * Expectation kinds:
 *  - { kind: 'output',  lines: string[] }               console output text, line by line
 *  - { kind: 'values',  values: unknown[] }             one logged value per line, compared structurally
 *  - { kind: 'error',   name, messageIncludes?, logs? } a runtime/compile error (optionally after some output)
 *  - { kind: 'timeout' }                                execution never finished
 */

/** Normalises a console line for comparison (trim + collapse whitespace). */
export function normalizeLine(line) {
  return String(line).trim().replace(/\s+/g, ' ');
}

export function linesEqual(actual, expected) {
  if (actual.length !== expected.length) return false;
  return actual.every((line, i) => normalizeLine(line) === normalizeLine(expected[i]));
}

/**
 * Structural equality that understands NaN, -0, undefined, Dates, Maps, Sets,
 * arrays and plain objects. Prototypes are ignored (values crossed a
 * structured-clone boundary), own enumerable keys are compared.
 */
export function deepEqual(a, b, seen = new Map()) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;

  if (seen.get(a) === b) return true;
  seen.set(a, b);

  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime());
  }
  if (a instanceof Error || b instanceof Error) {
    return a.name === b.name && a.message === b.message;
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map && b instanceof Map) || a.size !== b.size) return false;
    for (const [key, value] of a) {
      if (!b.has(key) || !deepEqual(value, b.get(key), seen)) return false;
    }
    return true;
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set && b instanceof Set) || a.size !== b.size) return false;
    outer: for (const value of a) {
      if (b.has(value)) continue;
      for (const candidate of b) if (deepEqual(value, candidate, seen)) continue outer;
      return false;
    }
    return true;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (i in a !== i in b || !deepEqual(a[i], b[i], seen)) return false;
    }
    return true;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key], seen));
}

const logTexts = (result) => result.logs.map((entry) => entry.text);

/**
 * @param {object} expect  option expectation
 * @param {import('./executor.js').ExecutionResult} result
 */
export function matchesExpectation(expect, result) {
  if (!expect || !result) return false;

  switch (expect.kind) {
    case 'output':
      return result.status === 'success' && !result.truncated && linesEqual(logTexts(result), expect.lines);

    case 'values':
      return (
        result.status === 'success' &&
        !result.truncated &&
        result.logs.length === expect.values.length &&
        result.logs.every(
          (entry, i) =>
            entry.args.length === 1 && entry.args[0].cloneable && deepEqual(entry.args[0].value, expect.values[i]),
        )
      );

    case 'error': {
      if (result.status !== 'error' || !result.error) return false;
      if (result.error.name !== expect.name) return false;
      if (expect.messageIncludes && !result.error.message.includes(expect.messageIncludes)) return false;
      if (expect.logs && !linesEqual(logTexts(result), expect.logs)) return false;
      return true;
    }

    case 'timeout':
      return result.status === 'timeout';

    default:
      return false;
  }
}

/** Returns the ids of every option whose expectation matches the actual result. */
export function findMatchingOptions(question, result) {
  return question.options.filter((option) => matchesExpectation(option.expect, result)).map((option) => option.id);
}

/**
 * Evaluates the candidate's answer against the ACTUAL execution result.
 *
 * @returns {{
 *   isCorrect: boolean,
 *   selectedOptionId: string,
 *   correctOptionId: string | null,   option that matches the real execution (null if none)
 *   matchedOptionIds: string[],
 *   consistentWithAnswerKey: boolean, the execution agrees with the authored answer key
 *   pointsEarned: number,
 * }}
 */
export function evaluateAnswer(question, selectedOptionId, result) {
  const matchedOptionIds = findMatchingOptions(question, result);
  const correctOptionId = matchedOptionIds.length === 1 ? matchedOptionIds[0] : null;
  const isCorrect = correctOptionId !== null && selectedOptionId === correctOptionId;
  return {
    isCorrect,
    selectedOptionId,
    correctOptionId,
    matchedOptionIds,
    consistentWithAnswerKey: correctOptionId === question.answer,
    pointsEarned: isCorrect ? question.points : 0,
  };
}
