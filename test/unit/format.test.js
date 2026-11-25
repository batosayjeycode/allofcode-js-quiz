import { describe, expect, it } from 'vitest';
import { formatLogLine, formatValue, serializeValue } from '../../src/engine/format.js';

describe('formatValue', () => {
  it.each([
    ['hello', 'hello'],
    [42, '42'],
    [-0, '-0'],
    [NaN, 'NaN'],
    [10n, '10n'],
    [true, 'true'],
    [undefined, 'undefined'],
    [null, 'null'],
    [Symbol('id'), 'Symbol(id)'],
  ])('formats primitive %s', (value, expected) => {
    expect(formatValue(value)).toBe(expected);
  });

  it('quotes nested strings only', () => {
    expect(formatValue(['a', "it's"])).toBe("['a', 'it\\'s']");
  });

  it('formats arrays, sparse arrays and objects', () => {
    expect(formatValue([1, [2, 3]])).toBe('[1, [2, 3]]');
    expect(formatValue([1, , 3])).toBe('[1, empty, 3]'); // eslint-disable-line no-sparse-arrays
    expect(formatValue({ a: 1, 'b-c': { d: null } })).toBe("{a: 1, 'b-c': {d: null}}");
    expect(formatValue({})).toBe('{}');
  });

  it('formats class instances, null-prototype objects and functions', () => {
    class Point {
      constructor() {
        this.x = 1;
      }
    }
    expect(formatValue(new Point())).toBe('Point {x: 1}');
    expect(formatValue(Object.create(null))).toBe('[Object: null prototype] {}');
    expect(formatValue(Point)).toBe('[class Point]');
    expect(formatValue(() => {})).toBe('[Function (anonymous)]');
  });

  it('formats built-ins', () => {
    expect(formatValue(new Map([['k', [1]]]))).toBe("Map(1) {'k' => [1]}");
    expect(formatValue(new Set([1, 2]))).toBe('Set(2) {1, 2}');
    expect(formatValue(new Date(0))).toBe('1970-01-01T00:00:00.000Z');
    expect(formatValue(/a+/g)).toBe('/a+/g');
    expect(formatValue(new TypeError('bad'))).toBe('TypeError: bad');
  });

  it('handles circular references and depth limits', () => {
    const a = { name: 'a' };
    a.self = a;
    expect(formatValue(a)).toBe("{name: 'a', self: [Circular]}");
    expect(formatValue({ l1: { l2: { l3: { l4: 1 } } } })).toBe('{l1: {l2: {l3: [Object]}}}');
  });

  it('joins log arguments with spaces', () => {
    expect(formatLogLine(['got', 'object', 1])).toBe('got object 1');
  });
});

describe('serializeValue', () => {
  it('keeps cloneable values', () => {
    expect(serializeValue([1, NaN])).toEqual({ text: '[1, NaN]', cloneable: true, value: [1, NaN] });
  });
  it('flags non-cloneable values', () => {
    expect(serializeValue({ fn() {} })).toEqual({ text: '{fn: [Function: fn]}', cloneable: false });
  });
});
