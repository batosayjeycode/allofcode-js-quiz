import { output, throws, values } from '../helpers.js';

export default [
  {
    id: 'JS-003',
    title: 'Temporal Dead Zone & Shadowing',
    category: 'Scope & Hoisting',
    difficulty: 'Intermediate',
    points: 2,
    tags: ['let', 'hoisting', 'tdz'],
    description: 'A function reads a variable that also exists in the outer scope. What happens when it runs?',
    code: `
      var x = 'outer';

      function show() {
        console.log(x);
        let x = 'inner';
      }

      show();
    `,
    options: [output('outer'), output('undefined'), output('inner'), throws('ReferenceError')],
    answer: 'D',
    explanation: `
      \`let\` declarations are hoisted to the top of their block, but they are **not initialised** until the declaration line runs. The time between entering the scope and the declaration is the *Temporal Dead Zone* (TDZ).

      Inside \`show\`, the inner \`x\` already shadows the outer \`x\` for the entire function body. Reading it before \`let x = 'inner'\` throws \`ReferenceError: Cannot access 'x' before initialization\` — it does **not** fall back to \`'outer'\`, and unlike \`var\` it does not yield \`undefined\`.
    `,
  },
  {
    id: 'JS-004',
    title: 'Closures in Loops: var vs let',
    category: 'Scope & Hoisting',
    difficulty: 'Intermediate',
    points: 2,
    tags: ['closures', 'var', 'let'],
    description: 'Two loops create callbacks that capture the loop variable. What do the two arrays contain?',
    code: `
      const withVar = [];
      for (var i = 0; i < 3; i++) {
        withVar.push(() => i);
      }

      const withLet = [];
      for (let j = 0; j < 3; j++) {
        withLet.push(() => j);
      }

      console.log(withVar.map((fn) => fn()));
      console.log(withLet.map((fn) => fn()));
    `,
    options: [
      values([0, 1, 2], [0, 1, 2]),
      values([3, 3, 3], [0, 1, 2]),
      values([3, 3, 3], [3, 3, 3]),
      values([2, 2, 2], [0, 1, 2]),
    ],
    answer: 'B',
    explanation: `
      Closures capture **variables**, not values.

      \`var i\` is function-scoped, so there is a single \`i\` shared by every callback. When the callbacks run, the loop has finished and \`i\` is \`3\` (the value that made \`i < 3\` false).

      \`let j\` is block-scoped, and \`for (let …)\` creates a **fresh binding for each iteration**, so each callback closes over its own \`j\`: \`0\`, \`1\` and \`2\`.
    `,
  },
];
