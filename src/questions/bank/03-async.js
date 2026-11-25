import { labeled, output, throws } from '../helpers.js';

export default [
  {
    id: 'JS-005',
    title: 'Promise Executor Timing',
    category: 'Async JavaScript',
    difficulty: 'Intermediate',
    points: 2,
    tags: ['promises', 'execution order'],
    description: 'In which order are the letters printed?',
    code: `
      console.log('A');

      const promise = new Promise((resolve) => {
        console.log('B');
        resolve('C');
        console.log('D');
      });

      promise.then((value) => console.log(value));

      console.log('E');
    `,
    options: [
      output('A', 'B', 'C', 'D', 'E'),
      output('A', 'E', 'B', 'D', 'C'),
      output('A', 'B', 'D', 'E', 'C'),
      output('A', 'B', 'D', 'C', 'E'),
    ],
    answer: 'C',
    explanation: `
      The Promise **executor runs synchronously**, immediately inside \`new Promise(...)\`, so \`B\` and \`D\` are printed straight after \`A\`. Calling \`resolve('C')\` does not stop the executor.

      \`.then\` callbacks are always invoked asynchronously as **microtasks**, even if the promise is already resolved. The synchronous code finishes first (printing \`E\`), then the microtask queue runs and prints \`C\`.
    `,
  },
  {
    id: 'JS-006',
    title: 'Missing await in try/catch',
    category: 'Async JavaScript',
    difficulty: 'Advanced',
    points: 3,
    tags: ['async/await', 'error handling', 'unhandled rejection'],
    description: 'An async function throws inside a try/catch block. What is the observable result?',
    code: `
      async function loadUser() {
        throw new Error('boom');
      }

      async function main() {
        try {
          const user = loadUser();
          console.log('got', typeof user);
        } catch (error) {
          console.log('caught');
        }
      }

      main();
    `,
    options: [
      output('caught'),
      output('got object'),
      labeled(throws('Error', { logs: ['got object'], messageIncludes: 'boom' }), [
        'got object',
        'Uncaught (in promise) Error: boom',
      ]),
      output('got undefined'),
    ],
    answer: 'C',
    explanation: `
      Calling an \`async\` function never throws synchronously — it always returns a **Promise**. The \`throw\` inside \`loadUser\` turns into a *rejected* promise.

      Because the promise is not awaited, the \`try/catch\` only protects the synchronous call, which succeeds: \`typeof user\` is \`'object'\`, so \`got object\` is printed and \`catch\` never runs.

      Nobody handles the rejected promise, so the runtime reports an **unhandled promise rejection**: \`Uncaught (in promise) Error: boom\`. The fix is \`const user = await loadUser();\`.
    `,
  },
];
