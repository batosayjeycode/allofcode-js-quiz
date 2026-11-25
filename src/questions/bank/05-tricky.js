import { labeled, output, throws } from '../helpers.js';

export default [
  {
    id: 'JS-009',
    title: 'Losing `this` in Strict Mode',
    category: 'Functions',
    difficulty: 'Advanced',
    points: 3,
    tags: ['this', 'strict mode', 'execution context'],
    description: 'A method is extracted from its object and called on its own. What happens?',
    code: `
      'use strict';

      const user = {
        name: 'Ada',
        getName() {
          return this.name;
        },
      };

      const getName = user.getName;
      console.log(getName());
    `,
    options: [output('Ada'), output('undefined'), throws('ReferenceError'), throws('TypeError')],
    answer: 'D',
    explanation: `
      \`this\` is determined by **how a function is called**, not where it was defined. \`getName()\` is a plain function call with no receiver object.

      In strict mode, \`this\` is therefore \`undefined\` (in sloppy mode it would be the global object). Evaluating \`this.name\` reads a property of \`undefined\`, which throws \`TypeError: Cannot read properties of undefined\`.

      Fixes: call it as \`user.getName()\`, or bind it with \`user.getName.bind(user)\`.
    `,
  },
  {
    id: 'JS-010',
    title: 'return Inside finally',
    category: 'Error Handling',
    difficulty: 'Advanced',
    points: 3,
    tags: ['try/catch/finally', 'control flow'],
    description: 'Both the catch and the finally block return a value. What is printed?',
    code: `
      function getStatus() {
        try {
          throw new Error('fail');
        } catch (error) {
          console.log('catch:', error.message);
          return 'from catch';
        } finally {
          console.log('finally');
          return 'from finally';
        }
      }

      console.log(getStatus());
    `,
    options: [
      output('catch: fail', 'from catch'),
      output('catch: fail', 'finally', 'from finally'),
      output('catch: fail', 'finally', 'from catch'),
      labeled(throws('Error'), 'Uncaught Error: fail'),
    ],
    answer: 'B',
    explanation: `
      The error is thrown in \`try\` and handled by \`catch\`, which logs \`catch: fail\` and evaluates \`return 'from catch'\`.

      A \`finally\` block **always** runs before the function actually returns, so \`finally\` is printed.

      Because \`finally\` itself executes a \`return\`, that completion **overrides** the pending return value from \`catch\` (it would also swallow a thrown error). The function returns \`'from finally'\`. This is why returning from \`finally\` is considered a pitfall.
    `,
  },
];
