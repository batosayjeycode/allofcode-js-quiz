import { describe, expect, it } from 'vitest';
import { output, throws, values } from '../../src/questions/helpers.js';
import { dedent, loadQuestionBank, normalizeQuestion } from '../../src/questions/schema.js';

const base = {
  id: 'X-1',
  title: 'Title',
  category: 'Cat',
  difficulty: 'Basic',
  description: 'Desc',
  code: '\n    console.log(1);\n      console.log(2);\n  ',
  options: [output('1'), throws('TypeError')],
  answer: 'A',
  explanation: 'Because.',
};

describe('question schema', () => {
  it('normalises ids, labels, code and defaults', () => {
    const q = normalizeQuestion({ ...base, options: [output('1', '2'), values([1, 'a']), throws('TypeError')] });
    expect(q.code).toBe('console.log(1);\n  console.log(2);');
    expect(q.options.map((o) => o.id)).toEqual(['A', 'B', 'C']);
    expect(q.options.map((o) => o.display)).toEqual([['1', '2'], ["[1, 'a']"], ['TypeError']]);
    expect(q.points).toBe(1);
    expect(q.resultType).toBe('output');
  });

  it('derives the result type from the answer', () => {
    expect(normalizeQuestion({ ...base, answer: 'B' }).resultType).toBe('error');
  });

  it.each([
    [{ id: '' }, /"id"/],
    [{ title: '' }, /"title"/],
    [{ difficulty: 'Easy' }, /"difficulty"/],
    [{ options: [output('1')] }, /"options"/],
    [{ options: [output('1'), { kind: 'weird' }] }, /unknown kind/],
    [{ options: [output('1'), output('1')] }, /unique/],
    [{ answer: 'Z' }, /"answer"/],
    [{ points: 0 }, /"points"/],
  ])('rejects invalid question %#', (override, message) => {
    expect(() => normalizeQuestion({ ...base, ...override })).toThrow(message);
  });

  it('loads every module, supports single and array exports, and sorts by id', () => {
    const bank = loadQuestionBank({
      './b.js': { default: [{ ...base, id: 'Q-10' }, { ...base, id: 'Q-2' }] },
      './a.js': { default: { ...base, id: 'Q-1' } },
    });
    expect(bank.map((q) => q.id)).toEqual(['Q-1', 'Q-2', 'Q-10']);
  });

  it('rejects duplicate ids across modules', () => {
    expect(() => loadQuestionBank({ './a.js': { default: base }, './b.js': { default: base } })).toThrow(/duplicate/);
  });

  it('dedent handles blank lines', () => {
    expect(dedent('\n  a\n\n    b\n')).toBe('a\n\n  b');
  });
});
