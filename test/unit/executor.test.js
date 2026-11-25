import { describe, expect, it } from 'vitest';
import { describeError, executeCode } from '../../src/engine/executor.js';
import { createNodeWorker } from '../helpers/nodeWorker.js';

const run = (code, timeoutMs = 2000) => executeCode(code, { timeoutMs, createWorker: createNodeWorker });
const texts = (result) => result.logs.map((entry) => entry.text);

describe('executeCode (sandboxed worker)', () => {
  it('captures console output and primitive values', async () => {
    const result = await run(`console.log(1 + 1, 'x', null, undefined, NaN, -0, 10n);`);
    expect(result.status).toBe('success');
    expect(texts(result)).toEqual(['2 x null undefined NaN -0 10n']);
  });

  it('keeps undefined distinct from an absent log', async () => {
    const result = await run(`let a; console.log(a);`);
    expect(texts(result)).toEqual(['undefined']);
    expect(result.logs[0].args[0]).toMatchObject({ cloneable: true, value: undefined });
  });

  it('transfers complex values for structural comparison', async () => {
    const result = await run(`console.log({ a: [1, { b: 2 }], m: new Map([[1, 'x']]) });`);
    expect(texts(result)).toEqual(["{a: [1, {b: 2}], m: Map(1) {1 => 'x'}}"]);
    expect(result.logs[0].args[0].value).toEqual({ a: [1, { b: 2 }], m: new Map([[1, 'x']]) });
  });

  it('formats non-cloneable values without failing', async () => {
    const result = await run(`function hello() {} console.log(hello, { fn: () => 1 }, Symbol('s'));`);
    expect(texts(result)).toEqual(['[Function: hello] {fn: [Function: fn]} Symbol(s)']);
    expect(result.logs[0].args[0].cloneable).toBe(false);
  });

  it('captures synchronous runtime errors with output produced before them', async () => {
    const result = await run(`console.log('before'); null.prop;`);
    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({ name: 'TypeError', phase: 'sync' });
    expect(texts(result)).toEqual(['before']);
    expect(describeError(result.error)).toMatch(/^Uncaught TypeError: /);
  });

  it('captures ReferenceError and SyntaxError', async () => {
    const ref = await run(`console.log(notDefined);`);
    expect(ref.error.name).toBe('ReferenceError');

    const syntax = await run(`const = 5;`);
    expect(syntax.status).toBe('error');
    expect(syntax.error).toMatchObject({ name: 'SyntaxError', phase: 'compile' });
  });

  it('captures thrown non-Error values', async () => {
    const result = await run(`throw 'plain string';`);
    expect(result.error).toMatchObject({ name: 'Uncaught', nonError: true, message: "'plain string'" });
  });

  it('waits for promises, microtasks and timers in event-loop order', async () => {
    const result = await run(`
      setTimeout(() => console.log('timeout'), 0);
      Promise.resolve().then(() => console.log('micro'));
      (async () => { await null; console.log('await'); })();
      setTimeout(() => console.log('late'), 50);
      console.log('sync');
    `);
    expect(result.status).toBe('success');
    expect(texts(result)).toEqual(['sync', 'micro', 'await', 'timeout', 'late']);
  });

  it('reports errors thrown inside timer callbacks', async () => {
    const result = await run(`setTimeout(() => { throw new RangeError('later'); }, 5);`);
    expect(result.error).toMatchObject({ name: 'RangeError', message: 'later', phase: 'async' });
  });

  it('reports unhandled promise rejections', async () => {
    const result = await run(`Promise.reject(new Error('nope')); console.log('after');`);
    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({ name: 'Error', message: 'nope', phase: 'promise' });
    expect(describeError(result.error)).toBe('Uncaught (in promise) Error: nope');
  });

  it('does not report handled rejections', async () => {
    const result = await run(`Promise.reject(new Error('x')).catch((e) => console.log('handled', e.message));`);
    expect(result.status).toBe('success');
    expect(texts(result)).toEqual(['handled x']);
  });

  it('terminates synchronous infinite loops with a timeout', async () => {
    const started = Date.now();
    const result = await run(`console.log('start'); while (true) {}`, 400);
    expect(result.status).toBe('timeout');
    expect(result.error.name).toBe('TimeoutError');
    expect(texts(result)).toEqual(['start']);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('terminates never-ending intervals with a timeout', async () => {
    const result = await run(`setInterval(() => {}, 10);`, 300);
    expect(result.status).toBe('timeout');
  });

  it('finishes once a cleared interval stops', async () => {
    const result = await run(`
      let n = 0;
      const id = setInterval(() => { n++; if (n === 3) { clearInterval(id); console.log(n); } }, 1);
    `);
    expect(result.status).toBe('success');
    expect(texts(result)).toEqual(['3']);
  });

  it('caps runaway logging', async () => {
    const result = await run(`for (let i = 0; i < 5000; i++) console.log(i);`);
    expect(result.logs.length).toBe(300);
    expect(result.truncated).toBe(true);
  });

  it('blocks network and messaging globals', async () => {
    const result = await run(`fetch('https://example.com');`);
    expect(result.error).toMatchObject({ name: 'Error', message: 'fetch is disabled in the interview sandbox' });
  });

  it('isolates state between runs', async () => {
    await run(`globalThis.leak = 42;`);
    const result = await run(`console.log(typeof globalThis.leak);`);
    expect(texts(result)).toEqual(['undefined']);
  });

  it('honours a leading "use strict" directive', async () => {
    const result = await run(`'use strict'; function f() { return this; } console.log(f());`);
    expect(texts(result)).toEqual(['undefined']);
  });
});
