import { describe, expect, it } from 'vitest';
import { executeCode } from '../../src/engine/executor.js';
import { evaluateAnswer, findMatchingOptions } from '../../src/engine/validator.js';
import { questions } from '../../src/questions/index.js';
import { DIFFICULTIES } from '../../src/questions/schema.js';
import { createNodeWorker } from '../helpers/nodeWorker.js';

const run = (code) => executeCode(code, { timeoutMs: 3000, createWorker: createNodeWorker });

describe('question bank', () => {
  it('ships 10 questions with unique ids', () => {
    expect(questions).toHaveLength(10);
    expect(new Set(questions.map((q) => q.id)).size).toBe(10);
  });

  it('covers a spread of categories and difficulties', () => {
    expect(new Set(questions.map((q) => q.category)).size).toBeGreaterThanOrEqual(6);
    const difficulties = new Set(questions.map((q) => q.difficulty));
    expect(difficulties.size).toBeGreaterThanOrEqual(3);
    for (const d of difficulties) expect(DIFFICULTIES).toContain(d);
  });

  it('mixes outputs and runtime errors as correct answers', () => {
    const types = new Set(questions.map((q) => q.resultType));
    expect(types).toEqual(new Set(['output', 'error']));
  });

  describe.each(questions.map((q) => [q.id, q]))('%s', (_id, question) => {
    it('executes to exactly one option, which is the answer key', async () => {
      const result = await run(question.code);
      expect(result.status).not.toBe('timeout');
      expect(findMatchingOptions(question, result)).toEqual([question.answer]);
    });

    it('scores the correct option and rejects every other option', async () => {
      const result = await run(question.code);
      for (const option of question.options) {
        const evaluation = evaluateAnswer(question, option.id, result);
        expect(evaluation.isCorrect).toBe(option.id === question.answer);
        expect(evaluation.pointsEarned).toBe(option.id === question.answer ? question.points : 0);
        expect(evaluation.consistentWithAnswerKey).toBe(true);
      }
    });
  });
});
