/**
 * Question bank entry point.
 *
 * Every file in ./bank is picked up automatically — to add questions, create
 * a new file there (or append to an existing one). No application code changes.
 */
import { loadQuestionBank } from './schema.js';

const modules = import.meta.glob('./bank/*.js', { eager: true });

export const questions = loadQuestionBank(modules);
