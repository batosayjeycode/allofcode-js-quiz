/**
 * Question schema: validation + normalisation of raw question definitions.
 * Kept free of bundler-specific APIs so tests and tooling can reuse it.
 */
import { assessmentConfig } from '../assessment.config.js';
import { formatValue } from '../engine/format.js';

export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
export const DEFAULT_DIFFICULTY = 'Medium';
/** Names used by older question files, mapped to the current levels. */
export const LEGACY_DIFFICULTIES = Object.freeze({ Basic: 'Easy', Intermediate: 'Medium', Advanced: 'Hard', Expert: 'Hard' });

/** Current difficulty for a raw value: missing → Medium, legacy names mapped, anything else → null. */
export function normalizeDifficulty(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_DIFFICULTY;
  if (DIFFICULTIES.includes(value)) return value;
  return LEGACY_DIFFICULTIES[value] ?? null;
}
export const EXPECTATION_KINDS = ['output', 'values', 'error', 'timeout'];
const OPTION_IDS = 'ABCDEFGH';

/** Removes surrounding blank lines and common indentation from a template literal. */
export function dedent(code) {
  const lines = String(code).replace(/\t/g, '  ').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const indent = Math.min(
    ...lines.filter((line) => line.trim()).map((line) => line.match(/^ */)[0].length),
  );
  return lines.map((line) => line.slice(Number.isFinite(indent) ? indent : 0).trimEnd()).join('\n');
}

/** Lines shown for an answer option. */
export function optionDisplay(expect) {
  if (expect.label !== undefined) return Array.isArray(expect.label) ? expect.label : [String(expect.label)];
  switch (expect.kind) {
    case 'output':
      return expect.lines;
    case 'values':
      return expect.values.map((value) => formatValue(value, { top: false }));
    case 'error':
      return [...(expect.logs ?? []), expect.name];
    case 'timeout':
      return ['Never finishes (timeout)'];
    default:
      return ['?'];
  }
}

class QuestionSchemaError extends Error {
  constructor(id, message) {
    super(`[question ${id ?? '<missing id>'}] ${message}`);
    this.name = 'QuestionSchemaError';
  }
}

/**
 * Validates and normalises one raw question.
 * Option ids (A, B, C…) follow the authored order and are stable identifiers:
 * the answer key and scoring use them, while the UI shows its own letters for
 * the session's shuffled order.
 * @param {{ difficultyPoints?: Record<string, number> }} [options]
 * @returns normalised question with option ids, dedented code and defaults.
 */
export function normalizeQuestion(raw, { difficultyPoints = assessmentConfig.difficultyPoints } = {}) {
  const id = raw?.id;
  const fail = (message) => {
    throw new QuestionSchemaError(id, message);
  };

  if (!raw || typeof raw !== 'object') fail('question must be an object');
  if (typeof id !== 'string' || !id.trim()) fail('"id" must be a non-empty string');
  for (const field of ['title', 'category', 'description', 'code', 'explanation']) {
    if (typeof raw[field] !== 'string' || !raw[field].trim()) fail(`"${field}" must be a non-empty string`);
  }
  const difficulty = normalizeDifficulty(raw.difficulty);
  if (!difficulty) fail(`"difficulty" must be one of ${DIFFICULTIES.join(', ')} (or omitted for ${DEFAULT_DIFFICULTY})`);
  if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > OPTION_IDS.length) {
    fail(`"options" must contain 2–${OPTION_IDS.length} entries`);
  }
  const points = raw.points ?? difficultyPoints[difficulty];
  if (typeof points !== 'number' || !(points > 0)) fail('"points" must be a positive number');

  const options = raw.options.map((expect, index) => {
    if (!expect || !EXPECTATION_KINDS.includes(expect.kind)) {
      fail(`option ${index + 1} has an unknown kind; use the helpers in questions/helpers.js`);
    }
    return { id: OPTION_IDS[index], expect, display: optionDisplay(expect) };
  });

  const displays = options.map((option) => option.display.join('\n'));
  if (new Set(displays).size !== displays.length) fail('option labels must be unique');
  if (!options.some((option) => option.id === raw.answer)) {
    fail(`"answer" must be one of ${options.map((o) => o.id).join(', ')}`);
  }

  const answerKind = options.find((option) => option.id === raw.answer).expect.kind;

  return {
    id,
    title: raw.title.trim(),
    category: raw.category.trim(),
    difficulty,
    description: raw.description.trim(),
    code: dedent(raw.code),
    options,
    answer: raw.answer,
    resultType: answerKind === 'error' || answerKind === 'timeout' ? answerKind : 'output',
    explanation: dedent(raw.explanation),
    points,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    order: typeof raw.order === 'number' ? raw.order : Number.MAX_SAFE_INTEGER,
  };
}

/**
 * Builds the question bank from loaded modules. Each module may export a
 * question or an array of questions as default export (or `questions`).
 *
 * @param {Record<string, any>} modules  e.g. the result of import.meta.glob(..., { eager: true })
 * @param {{ difficultyPoints?: Record<string, number> }} [options]
 */
export function loadQuestionBank(modules, options) {
  const raw = Object.keys(modules)
    .sort()
    .flatMap((path) => {
      const mod = modules[path];
      const exported = mod?.default ?? mod?.questions ?? mod;
      return Array.isArray(exported) ? exported : [exported];
    });

  const questions = raw.map((question) => normalizeQuestion(question, options));
  const seen = new Set();
  for (const question of questions) {
    if (seen.has(question.id)) throw new QuestionSchemaError(question.id, 'duplicate question id');
    seen.add(question.id);
  }
  return questions.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id, 'en', { numeric: true }));
}
