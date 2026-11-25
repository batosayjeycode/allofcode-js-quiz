import { output } from '../helpers.js';

export default [
  {
    id: 'JS-007',
    title: 'Microtasks vs Macrotasks',
    category: 'Event Loop',
    difficulty: 'Medium',
    tags: ['event loop', 'microtasks', 'setTimeout'],
    description: 'Synchronous logs, a timer, a promise and a queued microtask. What is the output order?',
    code: `
      console.log('1');

      setTimeout(() => console.log('2'), 0);

      Promise.resolve().then(() => console.log('3'));

      queueMicrotask(() => console.log('4'));

      console.log('5');
    `,
    options: [
      output('1', '5', '2', '3', '4'),
      output('1', '5', '3', '4', '2'),
      output('1', '3', '4', '5', '2'),
      output('1', '5', '4', '3', '2'),
    ],
    answer: 'B',
    explanation: `
      1. All **synchronous** code runs first: \`1\`, then \`5\`.
      2. When the call stack is empty, the engine drains the **microtask queue** in FIFO order. The \`.then\` callback was queued before \`queueMicrotask\`, so \`3\` prints before \`4\`.
      3. Only then does the event loop pick the next **macrotask** — the \`setTimeout\` callback — printing \`2\`. A delay of \`0\` never lets a timer jump ahead of microtasks.
    `,
  },
  {
    id: 'JS-008',
    title: 'async/await Resumption Order',
    category: 'Event Loop',
    difficulty: 'Hard',
    tags: ['event loop', 'async/await', 'microtasks'],
    description: 'Async functions, promise chains and a timer compete for the event loop. What is printed?',
    code: `
      async function first() {
        console.log('a1');
        await second();
        console.log('a2');
      }

      async function second() {
        console.log('b');
      }

      console.log('start');
      setTimeout(() => console.log('timeout'), 0);

      first();

      Promise.resolve()
        .then(() => console.log('p1'))
        .then(() => console.log('p2'));

      console.log('end');
    `,
    options: [
      output('start', 'a1', 'b', 'end', 'a2', 'p1', 'p2', 'timeout'),
      output('start', 'a1', 'end', 'b', 'a2', 'p1', 'p2', 'timeout'),
      output('start', 'a1', 'b', 'end', 'p1', 'a2', 'p2', 'timeout'),
      output('start', 'a1', 'b', 'a2', 'end', 'p1', 'p2', 'timeout'),
    ],
    answer: 'A',
    explanation: `
      - \`first()\` runs synchronously until its first \`await\`: it prints \`a1\`, then calls \`second()\`, which also runs synchronously and prints \`b\`.
      - \`await\` always pauses \`first\`, even for an already-resolved promise. Its continuation is queued as a **microtask**, *before* the \`p1\` callback is registered.
      - Synchronous code finishes with \`end\`.
      - Microtasks run in queue order: \`a2\`, then \`p1\`. Running \`p1\` queues \`p2\`, which runs next.
      - The \`setTimeout\` macrotask runs last: \`timeout\`.
    `,
  },
];
