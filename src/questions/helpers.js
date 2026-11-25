/**
 * Authoring helpers for question files. Each helper returns an answer-option
 * expectation; add `label` to override how the option is displayed.
 *
 *   output('1', '5', '3')                 -> console prints these three lines
 *   values([3, 3, 3], [0, 1, 2])           -> each line logs one value, compared structurally
 *   throws('TypeError')                    -> code throws a TypeError
 *   throws('Error', { logs: ['got'], messageIncludes: 'boom' })
 *   timesOut()                             -> code never finishes
 */

export const output = (...lines) => ({ kind: 'output', lines: lines.map(String) });

export const values = (...vals) => ({ kind: 'values', values: vals });

export const throws = (name, { messageIncludes, logs } = {}) => ({
  kind: 'error',
  name,
  ...(messageIncludes ? { messageIncludes } : {}),
  ...(logs ? { logs: logs.map(String) } : {}),
});

export const timesOut = () => ({ kind: 'timeout' });

/** Attach a custom display label (string or array of lines) to an expectation. */
export const labeled = (expect, label) => ({ ...expect, label });
