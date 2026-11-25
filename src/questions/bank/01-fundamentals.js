import { output } from '../helpers.js';

export default [
  {
    id: 'JS-001',
    title: 'Implicit Type Coercion',
    category: 'JavaScript Fundamentals',
    difficulty: 'Basic',
    points: 1,
    tags: ['coercion', 'operators'],
    description: 'Each expression mixes strings, numbers and booleans. What does the console print?',
    code: `
      console.log('5' + 3, '5' - 3, '5' * '2', true + 1);
    `,
    options: [output('53 2 10 2'), output('8 2 10 2'), output('53 2 52 true1'), output('53 NaN 10 2')],
    answer: 'A',
    explanation: `
      The \`+\` operator is overloaded: if either operand is a string, it performs string concatenation, so \`'5' + 3\` becomes \`'53'\`.

      The other arithmetic operators (\`-\`, \`*\`, \`/\`) only work on numbers, so both operands are converted with \`ToNumber\`: \`'5' - 3\` is \`2\` and \`'5' * '2'\` is \`10\`.

      With no string involved, \`true + 1\` converts \`true\` to \`1\`, giving \`2\`.
    `,
  },
  {
    id: 'JS-002',
    title: 'Shallow Copy with Object Spread',
    category: 'Array & Object',
    difficulty: 'Intermediate',
    points: 2,
    tags: ['references', 'mutation', 'spread'],
    description: 'A copy is created with the spread operator and then modified. What is logged for the original object?',
    code: `
      const original = { tags: ['js'], meta: { level: 1 } };
      const copy = { ...original };

      copy.tags.push('ts');
      copy.meta = { level: 2 };

      console.log(original.tags.length, original.meta.level);
    `,
    options: [output('1 1'), output('2 2'), output('2 1'), output('1 2')],
    answer: 'C',
    explanation: `
      Object spread creates a **shallow** copy: the top-level properties are copied, but nested objects are copied by reference.

      \`copy.tags.push('ts')\` mutates the array that both objects share, so \`original.tags.length\` becomes \`2\`.

      \`copy.meta = { level: 2 }\` *reassigns* a property on the copy only; \`original.meta\` still points to the old object, so its level stays \`1\`. Use \`structuredClone()\` when you need a deep copy.
    `,
  },
];
