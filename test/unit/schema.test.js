import { describe, expect, it } from 'vitest';
import { output, throws, values } from '../../src/questions/helpers.js';
import { DEFAULT_DIFFICULTY, dedent, loadQuestionBank, normalizeQuestion } from '../../src/questions/schema.js';

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

  it('scores by difficulty: Easy 1, Medium 2, Hard 3 by default, Medium when missing', () => {
    const noDifficulty = { ...base };
    delete noDifficulty.difficulty;
    expect(normalizeQuestion(noDifficulty)).toMatchObject({ difficulty: DEFAULT_DIFFICULTY, points: 2 });
    expect(normalizeQuestion({ ...base, difficulty: 'Easy' })).toMatchObject({ difficulty: 'Easy', points: 1 });
    expect(normalizeQuestion({ ...base, difficulty: 'Hard' })).toMatchObject({ difficulty: 'Hard', points: 3 });
  });

  it('maps legacy difficulty names for older question files', () => {
    expect(['Basic', 'Intermediate', 'Advanced', 'Expert'].map((d) => normalizeQuestion({ ...base, difficulty: d }).difficulty)).toEqual([
      'Easy',
      'Medium',
      'Hard',
      'Hard',
    ]);
  });

  it('takes points from config, with a per-question override', () => {
    const difficultyPoints = { Easy: 5, Medium: 10, Hard: 20 };
    expect(normalizeQuestion({ ...base, difficulty: 'Hard' }, { difficultyPoints }).points).toBe(20);
    expect(normalizeQuestion({ ...base, difficulty: 'Hard', points: 7 }, { difficultyPoints }).points).toBe(7);
    const bank = loadQuestionBank({ './a.js': { default: { ...base, difficulty: 'Medium' } } }, { difficultyPoints });
    expect(bank[0].points).toBe(10);
  });

  it('derives the result type from the answer', () => {
    expect(normalizeQuestion({ ...base, answer: 'B' }).resultType).toBe('error');
  });

  it.each([
    [{ id: '' }, /"id"/],
    [{ title: '' }, /"title"/],
    [{ difficulty: 'Impossible' }, /"difficulty"/],
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
