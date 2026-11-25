/**
 * Value formatting for the sandbox console.
 *
 * Produces a deterministic, DevTools-like text representation of any value
 * logged by candidate code. This module has no environment dependencies so it
 * runs inside the browser worker, a Node worker (tests) and the main thread.
 */

const MAX_DEPTH = 3;
const MAX_ITEMS = 100;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function formatString(value, top) {
  if (top) return value;
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function formatKey(key) {
  if (typeof key === 'symbol') return `[${key.toString()}]`;
  return IDENTIFIER.test(key) ? key : formatString(key, false);
}

function formatFunction(fn) {
  let source = '';
  try {
    source = Function.prototype.toString.call(fn);
  } catch {
    /* some host functions refuse toString */
  }
  if (/^class[\s{]/.test(source)) return `[class ${fn.name || '(anonymous)'}]`;
  return fn.name ? `[Function: ${fn.name}]` : '[Function (anonymous)]';
}

function constructorName(value) {
  try {
    const proto = Object.getPrototypeOf(value);
    if (proto === null) return null;
    const ctor = proto.constructor;
    return typeof ctor === 'function' && ctor.name ? ctor.name : '';
  } catch {
    return '';
  }
}

function safeGet(obj, key) {
  try {
    return obj[key];
  } catch (error) {
    return `[Getter threw: ${error && error.message}]`;
  }
}

function truncateList(parts, total) {
  if (total > MAX_ITEMS) parts.push(`... ${total - MAX_ITEMS} more items`);
  return parts;
}

function formatObjectLike(value, ctx) {
  if (ctx.seen.has(value)) return '[Circular]';

  const name = constructorName(value);

  if (Array.isArray(value)) {
    if (ctx.depth >= MAX_DEPTH) return '[Array]';
    return withSeen(value, ctx, (inner) => {
      const parts = [];
      const limit = Math.min(value.length, MAX_ITEMS);
      for (let i = 0; i < limit; i += 1) {
        parts.push(i in value ? formatValue(safeGet(value, i), inner) : 'empty');
      }
      return `[${truncateList(parts, value.length).join(', ')}]`;
    });
  }

  if (value instanceof Error || (typeof value.name === 'string' && typeof value.message === 'string' && 'stack' in value)) {
    return value.message ? `${value.name}: ${value.message}` : String(value.name);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  }
  if (value instanceof RegExp) return String(value);
  if (typeof Promise !== 'undefined' && value instanceof Promise) return 'Promise {<unknown state>}';
  if (typeof WeakMap !== 'undefined' && value instanceof WeakMap) return 'WeakMap { <items unknown> }';
  if (typeof WeakSet !== 'undefined' && value instanceof WeakSet) return 'WeakSet { <items unknown> }';

  if (value instanceof Map) {
    if (ctx.depth >= MAX_DEPTH) return '[Map]';
    return withSeen(value, ctx, (inner) => {
      const parts = [];
      let count = 0;
      for (const [k, v] of value) {
        if (count++ >= MAX_ITEMS) break;
        parts.push(`${formatValue(k, inner)} => ${formatValue(v, inner)}`);
      }
      truncateList(parts, value.size);
      return parts.length ? `Map(${value.size}) {${parts.join(', ')}}` : `Map(0) {}`;
    });
  }

  if (value instanceof Set) {
    if (ctx.depth >= MAX_DEPTH) return '[Set]';
    return withSeen(value, ctx, (inner) => {
      const parts = [];
      let count = 0;
      for (const v of value) {
        if (count++ >= MAX_ITEMS) break;
        parts.push(formatValue(v, inner));
      }
      truncateList(parts, value.size);
      return parts.length ? `Set(${value.size}) {${parts.join(', ')}}` : `Set(0) {}`;
    });
  }

  let prefix = '';
  if (name === null) prefix = '[Object: null prototype] ';
  else if (name && name !== 'Object') prefix = `${name} `;

  if (ctx.depth >= MAX_DEPTH) return name && name !== 'Object' ? `[${name}]` : '[Object]';

  return withSeen(value, ctx, (inner) => {
    const keys = [...Object.keys(value), ...Object.getOwnPropertySymbols(value)];
    const parts = keys
      .slice(0, MAX_ITEMS)
      .map((key) => `${formatKey(key)}: ${formatValue(safeGet(value, key), inner)}`);
    truncateList(parts, keys.length);
    return parts.length ? `${prefix}{${parts.join(', ')}}` : `${prefix}{}`;
  });
}

function withSeen(value, ctx, fn) {
  ctx.seen.add(value);
  try {
    return fn({ depth: ctx.depth + 1, seen: ctx.seen, top: false });
  } finally {
    ctx.seen.delete(value);
  }
}

/**
 * Formats any JavaScript value as readable text.
 * Top-level strings are printed raw (like console.log); nested strings are quoted.
 *
 * @param {unknown} value
 * @param {{ depth?: number, seen?: Set<object>, top?: boolean }} [ctx]
 * @returns {string}
 */
export function formatValue(value, ctx = {}) {
  const context = { depth: ctx.depth ?? 0, seen: ctx.seen ?? new Set(), top: ctx.top ?? true };

  switch (typeof value) {
    case 'string':
      return formatString(value, context.top);
    case 'number':
      return Object.is(value, -0) ? '-0' : String(value);
    case 'bigint':
      return `${value}n`;
    case 'boolean':
    case 'undefined':
      return String(value);
    case 'symbol':
      return value.toString();
    case 'function':
      return formatFunction(value);
    default:
      if (value === null) return 'null';
      return formatObjectLike(value, context);
  }
}

/**
 * Formats a list of console arguments into a single output line.
 * @param {unknown[]} args
 */
export function formatLogLine(args) {
  return args.map((arg) => formatValue(arg)).join(' ');
}

/**
 * Prepares a logged value for transfer across the worker boundary.
 * The raw value is kept (via structured clone) when possible so the validator
 * can compare complex values structurally instead of by string.
 *
 * @param {unknown} value
 * @returns {{ text: string, cloneable: boolean, value?: unknown }}
 */
export function serializeValue(value) {
  const text = formatValue(value);
  try {
    if (typeof structuredClone !== 'function') throw new Error('structuredClone unavailable');
    return { text, cloneable: true, value: structuredClone(value) };
  } catch {
    return { text, cloneable: false };
  }
}
