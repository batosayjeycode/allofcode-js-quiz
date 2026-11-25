/**
 * Assessment settings.
 *
 * - difficultyPoints: points awarded per difficulty, unless a question sets its own `points`.
 * - followUpPrompts: interview follow-up suggested when a candidate misses or skips a question
 *   in that category. Categories without an entry get a generic prompt.
 */
export const assessmentConfig = Object.freeze({
  difficultyPoints: Object.freeze({ Easy: 1, Medium: 2, Hard: 3 }),
  followUpPrompts: Object.freeze({
    'JavaScript Fundamentals': 'Type coercion: when `+` concatenates instead of adding, and how `==` differs from `===`.',
    'Array & Object': 'Shallow vs deep copies: spread, `structuredClone`, and shared nested references.',
    'Scope & Hoisting': 'Hoisting, the temporal dead zone, and how closures capture `var` vs `let` in loops.',
    'Async JavaScript': 'Promise timing and error handling: what runs synchronously, and where a missing `await` lets errors escape.',
    'Event Loop': 'Microtasks vs macrotasks: the order in which promises, `queueMicrotask` and timers run.',
    Functions: 'How `this` is bound: call sites, strict mode, method extraction, arrow functions and `bind`.',
    'Error Handling': '`try` / `catch` / `finally` control flow, including what a `return` inside `finally` overrides.',
  }),
});
