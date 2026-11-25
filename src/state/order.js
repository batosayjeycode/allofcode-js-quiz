/**
 * Per-session randomization. A session stores the order it was dealt — question
 * ids, and for each question its option ids — so a reload or another tab shows
 * exactly the same order. Option ids are never rewritten: the answer key and
 * scoring keep working on them, and only the displayed letter follows the
 * shuffled position.
 */

const DISPLAY_KEYS = 'ABCDEFGH';

/** Uniform random float in [0, 1), from the Web Crypto API when available. */
export function secureRandom() {
  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues) {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return buffer[0] / 2 ** 32;
  }
  return Math.random();
}

/** Fisher–Yates shuffle into a new array. */
export function shuffle(items, random = secureRandom) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** A new random order for a session. */
export function createSessionOrder(questions, random = secureRandom) {
  return {
    questionOrder: shuffle(
      questions.map((q) => q.id),
      random,
    ),
    optionOrder: Object.fromEntries(
      questions.map((q) => [
        q.id,
        shuffle(
          q.options.map((o) => o.id),
          random,
        ),
      ]),
    ),
  };
}

/** The authored order, used to carry over sessions saved before randomization existed. */
export function identityOrder(questions) {
  return {
    questionOrder: questions.map((q) => q.id),
    optionOrder: Object.fromEntries(questions.map((q) => [q.id, q.options.map((o) => o.id)])),
  };
}

const isPermutation = (list, expected) =>
  Array.isArray(list) &&
  list.length === expected.length &&
  new Set(list).size === expected.length &&
  list.every((item) => expected.includes(item));

/** True when the order covers every question and every option exactly once. */
export function isValidOrder(state, questions) {
  if (!isPermutation(state?.questionOrder, questions.map((q) => q.id))) return false;
  const optionOrder = state.optionOrder;
  if (!optionOrder || typeof optionOrder !== 'object') return false;
  return questions.every((q) =>
    isPermutation(
      optionOrder[q.id],
      q.options.map((o) => o.id),
    ),
  );
}

/**
 * The questions as this session shows them: in session order, each with its
 * options reordered and given a display `key` (A, B, C… by position).
 * Results are cached per order, so repeated renders reuse the same objects.
 */
export function createOrderedQuestions(questions) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  let cacheKey = null;
  let cached = null;

  return function orderedQuestions(state) {
    const key = `${state.sessionId}|${state.questionOrder.join(',')}`;
    if (key === cacheKey) return cached;
    cached = state.questionOrder.map((id) => {
      const question = byId.get(id);
      const optionsById = new Map(question.options.map((o) => [o.id, o]));
      const options = state.optionOrder[id].map((optionId, index) => ({
        ...optionsById.get(optionId),
        key: DISPLAY_KEYS[index],
      }));
      return { ...question, options };
    });
    cacheKey = key;
    return cached;
  };
}

/** Display letter of an option id within an ordered question (falls back to the id). */
export function optionKey(question, optionId) {
  return question.options.find((o) => o.id === optionId)?.key ?? optionId;
}
