import { expect, test } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { loadQuestionBank } from '../../src/questions/schema.js';

// Load the same question bank the app uses (answer key for the test only).
const bankDir = new URL('../../src/questions/bank/', import.meta.url);
const modules = {};
for (const file of readdirSync(bankDir).filter((f) => f.endsWith('.js'))) {
  modules[file] = await import(new URL(file, bankDir).href);
}
const questions = loadQuestionBank(modules);
const wrongOption = (q) => q.options.find((o) => o.id !== q.answer).id;

async function answerCurrent(page, optionId) {
  await page.locator(`[data-testid="option"][data-option-id="${optionId}"]`).click();
  await page.getByTestId('run-button').click();
  await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 10_000 });
}

// Each test gets a fresh browser context, so sessionStorage starts empty.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('question')).toBeVisible();
});

test('every question executes in the browser sandbox and the correct answer is accepted', async ({ page }) => {
  for (const [index, question] of questions.entries()) {
    await expect(page.getByTestId('question')).toHaveAttribute('data-question-id', question.id);
    await expect(page.getByTestId('question-number')).toHaveText(`Question ${index + 1} of ${questions.length}`);
    await answerCurrent(page, question.answer);
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-correct', 'true');
    await expect(page.getByTestId('console')).toHaveAttribute('data-status', question.resultType === 'error' ? 'error' : 'success');
    await expect(page.getByText('The execution result differs')).toHaveCount(0);
    await page.getByTestId('next-button').click();
  }
  await expect(page.getByTestId('summary-percentage')).toHaveText('100%');
  await expect(page.getByTestId('summary-performance')).toHaveText('Excellent');
});

test('gates Run Code on a selection, locks the answer and reveals the explanation only after running', async ({ page }) => {
  const q = questions[0];
  const run = page.getByTestId('run-button');
  await expect(run).toBeDisabled();
  await expect(page.getByTestId('explanation')).toHaveCount(0);
  await expect(page.getByTestId('console')).toHaveCount(0);

  const wrong = wrongOption(q);
  await page.locator(`[data-option-id="${wrong}"]`).click();
  await expect(run).toBeEnabled();
  await run.click();

  const verdict = page.getByTestId('verdict');
  await expect(verdict).toHaveAttribute('data-correct', 'false');
  await expect(verdict).toContainText(`You chose option ${wrong}, but the code actually produced option ${q.answer}`);
  await expect(page.getByTestId('explanation')).toBeVisible();
  await expect(page.locator('input[name="answer"]').first()).toBeDisabled();
  await expect(page.locator(`[data-option-id="${q.answer}"]`)).toHaveClass(/option--actual/);
  await expect(page.locator(`[data-option-id="${wrong}"]`)).toHaveClass(/option--wrong/);
  await expect(run).toBeDisabled();
  await expect(page.getByTestId('nav-item').first()).toHaveAttribute('data-status', 'incorrect');
});

test('shows runtime errors distinctly in the console', async ({ page }) => {
  const index = questions.findIndex((q) => q.id === 'JS-003');
  await page.getByTestId('nav-item').nth(index).click();
  await answerCurrent(page, 'A');
  await expect(page.getByTestId('console')).toHaveAttribute('data-status', 'error');
  await expect(page.getByTestId('console-error')).toContainText('Uncaught ReferenceError');
});

test('shows async unhandled rejections with prior output', async ({ page }) => {
  const index = questions.findIndex((q) => q.id === 'JS-006');
  await page.getByTestId('nav-item').nth(index).click();
  await answerCurrent(page, 'C');
  await expect(page.getByTestId('console')).toContainText('got object');
  await expect(page.getByTestId('console-error')).toContainText('Uncaught (in promise) Error: boom');
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-correct', 'true');
});

test('keyboard: letter keys select, Ctrl+Enter runs', async ({ page }) => {
  await page.keyboard.press(questions[0].answer.toLowerCase());
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-correct', 'true');
});

test('navigation, progress tracking, persistence and mixed final score', async ({ page }) => {
  await expect(page.getByTestId('prev-button')).toBeDisabled();
  let expectedPoints = 0;
  let correct = 0;
  // Answer the first 6 questions: correct on even indexes, wrong on odd; leave 4 unanswered.
  for (let i = 0; i < 6; i += 1) {
    const q = questions[i];
    const isRight = i % 2 === 0;
    await answerCurrent(page, isRight ? q.answer : wrongOption(q));
    if (isRight) {
      expectedPoints += q.points;
      correct += 1;
    }
    await expect(page.getByTestId('progress-count')).toHaveText(String(i + 1));
    await page.getByTestId('next-button').click();
  }

  // Previous navigation and review of a completed question
  await page.getByTestId('prev-button').click();
  await expect(page.getByTestId('question')).toHaveAttribute('data-question-id', questions[5].id);
  await expect(page.getByTestId('verdict')).toBeVisible();

  // Survives a reload
  await page.reload();
  await expect(page.getByTestId('progress-count')).toHaveText('6');
  await expect(page.getByTestId('question')).toHaveAttribute('data-question-id', questions[5].id);

  const statuses = await page.getByTestId('nav-item').evaluateAll((els) => els.map((el) => el.dataset.status));
  expect(statuses).toEqual(['correct', 'incorrect', 'correct', 'incorrect', 'correct', 'incorrect', 'unanswered', 'unanswered', 'unanswered', 'unanswered']);

  await page.getByRole('button', { name: /Finish/ }).first().click();
  const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);
  const pct = Math.round((expectedPoints / totalPoints) * 1000) / 10;
  await expect(page.getByTestId('summary-total')).toHaveText('10');
  await expect(page.getByTestId('summary-correct')).toHaveText(String(correct));
  await expect(page.getByTestId('summary-incorrect')).toHaveText('3');
  await expect(page.getByTestId('summary-unanswered')).toHaveText('4');
  await expect(page.getByTestId('summary-points')).toHaveText(`${expectedPoints} / ${totalPoints}`);
  await expect(page.getByTestId('summary-percentage')).toHaveText(`${pct}%`);
  await expect(page.getByTestId('summary-row')).toHaveCount(10);

  // Review from summary, then restart (two-step confirm)
  await page.getByRole('button', { name: 'Review' }).nth(1).click();
  await expect(page.getByTestId('question')).toHaveAttribute('data-question-id', questions[1].id);
  await page.getByTestId('restart').click();
  await page.getByTestId('confirm-restart').click();
  await expect(page.getByTestId('progress-count')).toHaveText('0');
  await expect(page.getByTestId('question')).toHaveAttribute('data-question-id', questions[0].id);
});

test('layout has no horizontal overflow', async ({ page }) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
