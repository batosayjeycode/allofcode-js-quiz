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

/** Skips the 5-minute preparation (via the fake clock) and starts a quiz. */
async function startQuiz(page, minutes = 15) {
  await page.clock.fastForward('05:00');
  await expect(page.getByTestId('duration-selection')).toBeVisible();
  await page.locator(`[data-testid="duration-option"][data-minutes="${minutes}"]`).click();
  await expect(page.getByTestId('question')).toBeVisible();
}

// Each test gets a fresh browser context, so sessionStorage starts empty.
// The fake clock keeps flowing in real time; fastForward jumps it like a long background-tab pause.
test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await expect(page.getByTestId('preparation')).toBeVisible();
});

test.describe('preparation and duration selection', () => {
  test('shows every question read-only for exactly 5 minutes, then asks for a duration', async ({ page }) => {
    await expect(page.getByTestId('preview-question')).toHaveCount(questions.length);
    await expect(page.locator('input[name="answer"]')).toHaveCount(0);
    await expect(page.getByTestId('run-button')).toHaveCount(0);
    await expect(page.getByTestId('timer')).toHaveAttribute('data-phase', 'preparation');
    await expect(page.getByTestId('timer')).toContainText(/0[45]:\d\d/);

    // Keyboard shortcuts and the sidebar can't open a question during preparation.
    await page.keyboard.press('a');
    await page.keyboard.press('Control+Enter');
    await page.getByTestId('nav-item').nth(3).click();
    await expect(page.getByTestId('preparation')).toBeVisible();
    await expect(page.getByTestId('question')).toHaveCount(0);

    await page.clock.fastForward('04:50');
    await expect(page.getByTestId('preparation')).toBeVisible();
    await page.clock.fastForward('00:15');
    await expect(page.getByTestId('duration-selection')).toBeVisible();
    await expect(page.getByTestId('timer')).toHaveCount(0);
    await expect(page.getByTestId('duration-option')).toHaveText([/5\s*minutes/, /10\s*minutes/, /15\s*minutes/]);
  });

  test('a reload keeps the preparation deadline instead of restarting it', async ({ page }) => {
    await page.clock.fastForward('03:00');
    await page.reload();
    await expect(page.getByTestId('preparation')).toBeVisible();
    await expect(page.getByTestId('timer')).toContainText(/0[12]:\d\d/);
    await page.clock.fastForward('02:05');
    await expect(page.getByTestId('duration-selection')).toBeVisible();
  });

  test('the chosen duration starts the countdown and cannot be changed', async ({ page }) => {
    await startQuiz(page, 10);
    await expect(page.getByTestId('timer')).toHaveAttribute('data-phase', 'quiz');
    await expect(page.getByTestId('timer')).toContainText(/(10:00|09:\d\d)/);
    await expect(page.getByTestId('duration-option')).toHaveCount(0);
    await page.clock.fastForward('09:30');
    await expect(page.getByTestId('timer')).toHaveClass(/timer--low/);
  });
});

test('every question executes in the browser sandbox; answering them all ends the quiz', async ({ page }) => {
  await startQuiz(page);
  const last = questions.length - 1;
  for (const [index, question] of questions.entries()) {
    await expect(page.getByTestId('question')).toHaveAttribute('data-question-id', question.id);
    await expect(page.getByTestId('question-number')).toHaveText(`Question ${index + 1} of ${questions.length}`);
    if (index === last) break;
    await answerCurrent(page, question.answer);
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-correct', 'true');
    await expect(page.getByTestId('console')).toHaveAttribute('data-status', question.resultType === 'error' ? 'error' : 'success');
    await expect(page.getByText('The execution result differs')).toHaveCount(0);
    await page.getByTestId('next-button').click();
  }
  await expect(page.getByTestId('next-button')).toBeDisabled();

  // Running the last unanswered question ends the quiz: no "Finish" click, the result opens on its own.
  await page.locator(`[data-testid="option"][data-option-id="${questions[last].answer}"]`).click();
  await page.getByTestId('run-button').click();
  await expect(page.getByTestId('summary')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('summary-row').nth(last)).toHaveAttribute('data-status', 'correct');
  await expect(page.getByTestId('end-reason')).toHaveAttribute('data-reason', 'completed');
  await expect(page.getByTestId('summary-percentage')).toHaveText('100%');
  await expect(page.getByTestId('summary-performance')).toHaveText('Excellent');
  await expect(page.getByTestId('timer')).toHaveCount(0);
});

test('gates Run Code on a selection, locks the answer and reveals the explanation only after running', async ({ page }) => {
  await startQuiz(page);
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
  await startQuiz(page);
  const index = questions.findIndex((q) => q.id === 'JS-003');
  await page.getByTestId('nav-item').nth(index).click();
  await answerCurrent(page, 'A');
  await expect(page.getByTestId('console')).toHaveAttribute('data-status', 'error');
  await expect(page.getByTestId('console-error')).toContainText('Uncaught ReferenceError');
});

test('shows async unhandled rejections with prior output', async ({ page }) => {
  await startQuiz(page);
  const index = questions.findIndex((q) => q.id === 'JS-006');
  await page.getByTestId('nav-item').nth(index).click();
  await answerCurrent(page, 'C');
  await expect(page.getByTestId('console')).toContainText('got object');
  await expect(page.getByTestId('console-error')).toContainText('Uncaught (in promise) Error: boom');
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-correct', 'true');
});

test('keyboard: letter keys select, Ctrl+Enter runs', async ({ page }) => {
  await startQuiz(page);
  await page.keyboard.press(questions[0].answer.toLowerCase());
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-correct', 'true');
});

test('navigation, persistence, and the timer ending the quiz with a mixed score', async ({ page }) => {
  await startQuiz(page, 15);
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
  // Select (but don't run) question 7: it must still count as unanswered.
  await page.locator('[data-testid="option"][data-option-id="A"]').click();

  // Previous navigation and review of a completed question
  await page.getByTestId('prev-button').click();
  await expect(page.getByTestId('question')).toHaveAttribute('data-question-id', questions[5].id);
  await expect(page.getByTestId('verdict')).toBeVisible();

  // Survives a reload (the leave-page prompt is accepted); the deadline is kept.
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByTestId('progress-count')).toHaveText('6');
  await expect(page.getByTestId('question')).toHaveAttribute('data-question-id', questions[5].id);
  await expect(page.getByTestId('timer')).toHaveAttribute('data-phase', 'quiz');

  const statuses = await page.getByTestId('nav-item').evaluateAll((els) => els.map((el) => el.dataset.status));
  expect(statuses).toEqual(['correct', 'incorrect', 'correct', 'incorrect', 'correct', 'incorrect', 'selected', 'unanswered', 'unanswered', 'unanswered']);
  await expect(page.getByRole('button', { name: /Finish|Results/ })).toHaveCount(0);

  // Time runs out: the result opens by itself.
  await page.clock.fastForward('15:00');
  await expect(page.getByTestId('summary')).toBeVisible();
  await expect(page.getByTestId('end-reason')).toHaveAttribute('data-reason', 'timeout');

  const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);
  const pct = Math.round((expectedPoints / totalPoints) * 1000) / 10;
  await expect(page.getByTestId('summary-total')).toHaveText('10');
  await expect(page.getByTestId('summary-correct')).toHaveText(String(correct));
  await expect(page.getByTestId('summary-incorrect')).toHaveText('3');
  await expect(page.getByTestId('summary-unanswered')).toHaveText('4');
  await expect(page.getByTestId('summary-points')).toHaveText(`${expectedPoints} / ${totalPoints}`);
  await expect(page.getByTestId('summary-percentage')).toHaveText(`${pct}%`);
  await expect(page.getByTestId('summary-row')).toHaveCount(10);

  // The finished quiz is read-only: no way back to the questions, and inputs do nothing.
  await expect(page.getByRole('button', { name: /Review|Back to questions/ })).toHaveCount(0);
  await expect(page.getByTestId('nav-item').first()).toBeDisabled();
  await page.keyboard.press('a');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('question')).toHaveCount(0);

  // A reload stays on the result.
  await page.reload();
  await expect(page.getByTestId('summary')).toBeVisible();
  await expect(page.getByTestId('summary-points')).toHaveText(`${expectedPoints} / ${totalPoints}`);

  // Restart (two-step confirm) begins a new preparation.
  await page.getByTestId('restart').click();
  await page.getByTestId('confirm-restart').click();
  await expect(page.getByTestId('preparation')).toBeVisible();
  await expect(page.getByTestId('progress-count')).toHaveText('0');
});

test('a long pause (throttled or hidden tab) still ends the quiz at its deadline', async ({ page }) => {
  await startQuiz(page, 5);
  await answerCurrent(page, questions[0].answer);
  await page.clock.fastForward('30:00');
  await expect(page.getByTestId('summary')).toBeVisible();
  await expect(page.getByTestId('end-reason')).toHaveAttribute('data-reason', 'timeout');
  await expect(page.getByTestId('summary-unanswered')).toHaveText(String(questions.length - 1));
});

test('layout has no horizontal overflow in any phase', async ({ page }) => {
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.clock.fastForward('05:00');
  await expect(page.getByTestId('duration-selection')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.locator('[data-testid="duration-option"][data-minutes="5"]').click();
  await expect(page.getByTestId('question')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.clock.fastForward('05:00');
  await expect(page.getByTestId('summary')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
});
