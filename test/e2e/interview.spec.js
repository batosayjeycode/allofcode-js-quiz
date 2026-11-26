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
const byId = new Map(questions.map((q) => [q.id, q]));
const wrongOption = (q) => q.options.find((o) => o.id !== q.answer).id;

// Questions and options are shuffled per session, so tests read the order from the page.
// Options are located by their stable id (data-option-id); the visible letter is data-option-key.

/** The bank entry for the question currently on screen. */
async function currentQuestion(page) {
  return byId.get(await page.getByTestId('question').getAttribute('data-question-id'));
}

/** Question ids in this session's order (from the sidebar). */
const sessionOrder = (page) => page.getByTestId('nav-item').evaluateAll((els) => els.map((el) => el.dataset.questionId));

/** Display letter of an option on the current question. */
const displayKey = (page, optionId) =>
  page.locator(`[data-testid="option"][data-option-id="${optionId}"]`).getAttribute('data-option-key');

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
  const order = await sessionOrder(page);
  expect([...order].sort()).toEqual(questions.map((q) => q.id).sort());
  const last = questions.length - 1;
  for (const [index, id] of order.entries()) {
    const question = byId.get(id);
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
  await page.locator(`[data-testid="option"][data-option-id="${byId.get(order[last]).answer}"]`).click();
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
  const q = await currentQuestion(page);
  const run = page.getByTestId('run-button');
  await expect(run).toBeDisabled();
  await expect(page.getByTestId('explanation')).toHaveCount(0);
  await expect(page.getByTestId('console')).toHaveCount(0);

  const wrong = wrongOption(q);
  const [wrongKey, rightKey] = [await displayKey(page, wrong), await displayKey(page, q.answer)];
  await page.locator(`[data-option-id="${wrong}"]`).click();
  await expect(run).toBeEnabled();
  await run.click();

  const verdict = page.getByTestId('verdict');
  await expect(verdict).toHaveAttribute('data-correct', 'false');
  // The verdict uses the letters the candidate sees, not the internal ids.
  await expect(verdict).toContainText(`You chose option ${wrongKey}, but the code actually produced option ${rightKey}`);
  await expect(page.getByTestId('explanation')).toBeVisible();
  await expect(page.locator('input[name="answer"]').first()).toBeDisabled();
  await expect(page.locator(`[data-option-id="${q.answer}"]`)).toHaveClass(/option--actual/);
  await expect(page.locator(`[data-option-id="${wrong}"]`)).toHaveClass(/option--wrong/);
  await expect(run).toBeDisabled();
  await expect(page.getByTestId('nav-item').first()).toHaveAttribute('data-status', 'incorrect');
});

test('shows runtime errors distinctly in the console', async ({ page }) => {
  await startQuiz(page);
  await page.locator('[data-testid="nav-item"][data-question-id="JS-003"]').click();
  await answerCurrent(page, 'A');
  await expect(page.getByTestId('console')).toHaveAttribute('data-status', 'error');
  await expect(page.getByTestId('console-error')).toContainText('Uncaught ReferenceError');
});

test('shows async unhandled rejections with prior output', async ({ page }) => {
  await startQuiz(page);
  await page.locator('[data-testid="nav-item"][data-question-id="JS-006"]').click();
  await answerCurrent(page, 'C');
  await expect(page.getByTestId('console')).toContainText('got object');
  await expect(page.getByTestId('console-error')).toContainText('Uncaught (in promise) Error: boom');
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-correct', 'true');
});

test('keyboard: letter keys select by displayed letter, Ctrl+Enter runs', async ({ page }) => {
  await startQuiz(page);
  const q = await currentQuestion(page);
  await page.keyboard.press((await displayKey(page, q.answer)).toLowerCase());
  await expect(page.locator(`[data-option-id="${q.answer}"] input`)).toBeChecked();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-correct', 'true');
});

test('navigation, persistence, and the timer ending the quiz with a mixed score', async ({ page }) => {
  await startQuiz(page, 15);
  const order = await sessionOrder(page);
  await expect(page.getByTestId('prev-button')).toBeDisabled();
  let expectedPoints = 0;
  let correct = 0;
  // Answer the first 6 questions: correct on even indexes, wrong on odd; leave 4 unanswered.
  for (let i = 0; i < 6; i += 1) {
    const q = byId.get(order[i]);
    await expect(page.getByTestId('question')).toHaveAttribute('data-question-id', q.id);
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
  await expect(page.getByTestId('question')).toHaveAttribute('data-question-id', order[5]);
  await expect(page.getByTestId('verdict')).toBeVisible();

  // Survives a reload (the leave-page prompt is accepted); the deadline is kept.
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByTestId('progress-count')).toHaveText('6');
  await expect(page.getByTestId('question')).toHaveAttribute('data-question-id', order[5]);
  await expect(page.getByTestId('timer')).toHaveAttribute('data-phase', 'quiz');
  expect(await sessionOrder(page)).toEqual(order); // no reshuffle on reload

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
  await expect(page.getByTestId('summary-accuracy')).toHaveText('50%'); // 3 of 6 answered; unanswered excluded
  await expect(page.getByTestId('completion-status')).toHaveText('Time expired');
  await expect(page.getByTestId('summary-time')).toHaveText('15m 00s');
  await expect(page.getByTestId('summary-row')).toHaveCount(10);
  expect(await page.getByTestId('summary-row').evaluateAll((els) => els.map((el) => el.dataset.questionId))).toEqual(order);

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
  await answerCurrent(page, (await currentQuestion(page)).answer);
  await page.clock.fastForward('30:00');
  await expect(page.getByTestId('summary')).toBeVisible();
  await expect(page.getByTestId('end-reason')).toHaveAttribute('data-reason', 'timeout');
  await expect(page.getByTestId('summary-unanswered')).toHaveText(String(questions.length - 1));
});

test.describe('anti-cheat', () => {
  const STORAGE_KEY = 'js-quiz:session';
  const timerSeconds = async (page) => {
    const [m, sec] = (await page.locator('[data-timer-value]').first().textContent()).split(':').map(Number);
    return m * 60 + sec;
  };
  const setHidden = (page, hidden) =>
    page.evaluate((value) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (value ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);

  test('back and forward navigation cannot leave the active quiz', async ({ page }) => {
    await startQuiz(page, 10);
    await answerCurrent(page, (await currentQuestion(page)).answer);
    const url = page.url();
    await page.goBack();
    await expect(page.getByTestId('question')).toBeVisible();
    await expect(page.getByTestId('timer')).toHaveAttribute('data-phase', 'quiz');
    expect(page.url()).toBe(url);
    await page.goBack();
    await page.goForward();
    await expect(page.getByTestId('question')).toBeVisible();
    await expect(page.getByTestId('progress-count')).toHaveText('1');
  });

  test('leaving the site and coming back resumes the quiz with the clock still running, then only the result', async ({ page }) => {
    await startQuiz(page, 5);
    await answerCurrent(page, (await currentQuestion(page)).answer);
    const before = await timerSeconds(page);

    page.on('dialog', (dialog) => dialog.accept());
    await page.goto('about:blank');
    await page.clock.fastForward('02:00');
    await page.goto('/');
    await expect(page.getByTestId('question')).toBeVisible();
    await expect(page.getByTestId('progress-count')).toHaveText('1');
    expect(await timerSeconds(page)).toBeLessThanOrEqual(before - 119);

    await page.clock.fastForward('03:00');
    await expect(page.getByTestId('summary')).toBeVisible();
    // Returning to the app after it ended always shows the result.
    await page.goto('about:blank');
    await page.goto('/');
    await expect(page.getByTestId('summary')).toBeVisible();
    await expect(page.getByTestId('end-reason')).toHaveAttribute('data-reason', 'timeout');
    await page.goBack();
    await page.goForward();
    await expect(page.getByTestId('summary')).toBeVisible();
    await expect(page.getByTestId('question')).toHaveCount(0);
  });

  test('tab switches are counted without pausing the countdown, and shown on the result', async ({ page }) => {
    await startQuiz(page, 5);
    const before = await timerSeconds(page);
    await setHidden(page, true);
    await page.clock.fastForward('01:00');
    await setHidden(page, false);
    expect(await timerSeconds(page)).toBeLessThanOrEqual(before - 59);
    await setHidden(page, true);
    await setHidden(page, false);

    await page.clock.fastForward('05:00');
    await expect(page.getByTestId('summary')).toBeVisible();
    await expect(page.getByTestId('tab-switches')).toHaveAttribute('data-count', '2');
    await expect(page.getByTestId('tab-switches')).toContainText('Left the quiz tab 2 times');
  });

  test('a second tab joins the same session, and finishing in one tab ends it in both', async ({ page, context }) => {
    await startQuiz(page, 15);
    await answerCurrent(page, (await currentQuestion(page)).answer);

    const second = await context.newPage();
    await second.goto('/');
    await expect(second.getByTestId('question')).toBeVisible();
    await expect(second.getByTestId('progress-count')).toHaveText('1');
    await expect(second.getByTestId('nav-item').first()).toHaveAttribute('data-status', 'correct');
    expect(await sessionOrder(second)).toEqual(await sessionOrder(page));

    // Answer the rest in the second tab; the first tab follows along.
    for (let i = 1; i < questions.length; i += 1) {
      const item = second.getByTestId('nav-item').nth(i);
      const q = byId.get(await item.getAttribute('data-question-id'));
      await item.click();
      await second.locator(`[data-testid="option"][data-option-id="${q.answer}"]`).click();
      await second.getByTestId('run-button').click();
      await expect(second.getByTestId('progress-count')).toHaveText(String(i + 1), { timeout: 10_000 });
    }
    await expect(second.getByTestId('summary')).toBeVisible();
    await expect(page.getByTestId('summary')).toBeVisible();
    await expect(page.getByTestId('end-reason')).toHaveAttribute('data-reason', 'completed');
    await expect(page.getByTestId('summary-percentage')).toHaveText('100%');
    await second.close();
  });

  test('editing the saved session while the quiz is open is undone', async ({ page }) => {
    await startQuiz(page, 5);
    const before = await timerSeconds(page);
    await page.evaluate((key) => {
      const saved = JSON.parse(localStorage.getItem(key));
      saved.quizEndsAt += 60 * 60_000; // try to grant an extra hour
      localStorage.setItem(key, JSON.stringify(saved));
    }, STORAGE_KEY);
    page.on('dialog', (dialog) => dialog.accept());
    await page.reload();
    await expect(page.getByTestId('question')).toBeVisible();
    expect(await timerSeconds(page)).toBeLessThanOrEqual(before);
    await page.clock.fastForward('05:00');
    await expect(page.getByTestId('summary')).toBeVisible();
  });

  for (const [name, value] of [
    ['unparseable', '{broken'],
    ['inconsistent', JSON.stringify({ version: 3, phase: 'result', answers: [] })],
  ]) {
    test(`${name} saved data found on load starts a clean session without errors`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error));
      // Written before the app's scripts run, as if edited while no quiz tab was open.
      await page.addInitScript(([key, raw]) => localStorage.setItem(key, raw), [STORAGE_KEY, value]);
      await page.reload();
      await expect(page.getByTestId('preparation')).toBeVisible();
      await expect(page.getByTestId('timer')).toHaveAttribute('data-phase', 'preparation');
      expect(errors).toEqual([]);
    });
  }
});

test.describe('assessment mode', () => {
  const optionKeysOf = (page) =>
    page.getByTestId('option').evaluateAll((els) => els.map((el) => `${el.dataset.optionKey}=${el.dataset.optionId}`));

  test('questions and options are shuffled per session and stay the same after a reload', async ({ page, browser }) => {
    const preparationOrder = await page
      .getByTestId('preview-question')
      .evaluateAll((els) => els.map((el) => el.querySelector('.badge--mono').textContent));
    await startQuiz(page, 15);
    const order = await sessionOrder(page);
    expect(order).toEqual(preparationOrder); // the preparation shows the same order as the quiz
    const options = await optionKeysOf(page);
    expect(options.map((o) => o.split('=')[0])).toEqual(['A', 'B', 'C', 'D']); // letters follow display position

    page.on('dialog', (dialog) => dialog.accept());
    await page.reload();
    expect(await sessionOrder(page)).toEqual(order);
    expect(await optionKeysOf(page)).toEqual(options);

    // A different session (new browser profile) gets a different deal: 10! question orders × option orders.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto('/');
    const otherOrder = await sessionOrder(otherPage);
    const otherOptions = await otherPage.getByTestId('preview-question').first().locator('.option__body').allTextContents();
    await other.close();
    expect([...otherOrder].sort()).toEqual([...order].sort());
    const firstOptionsHere = await page.getByTestId('option').locator('.option__body').allTextContents();
    expect(otherOrder.join() !== order.join() || otherOptions.join() !== firstOptionsHere.join()).toBe(true);
  });

  test('the result shows accuracy, time, an interviewer summary and a detailed answer review', async ({ page }) => {
    await startQuiz(page, 10);
    const order = await sessionOrder(page);
    const first = byId.get(order[0]);
    const second = byId.get(order[1]);
    await answerCurrent(page, first.answer); // correct
    await page.getByTestId('next-button').click();
    await answerCurrent(page, wrongOption(second)); // incorrect
    const wrongKey = await displayKey(page, wrongOption(second));
    const rightKey = await displayKey(page, second.answer);
    await page.clock.fastForward('10:00');

    await expect(page.getByTestId('summary')).toBeVisible();
    await expect(page.getByTestId('summary-points')).toHaveText(`${first.points} / 23`);
    await expect(page.getByTestId('summary-accuracy')).toHaveText('50%');
    await expect(page.getByTestId('summary-unanswered')).toHaveText('8');
    await expect(page.getByTestId('completion-status')).toHaveText('Time expired');
    await expect(page.getByTestId('summary-time')).toHaveText('10m 00s');

    const summary = page.getByTestId('interviewer-summary');
    await expect(summary).toBeVisible();
    await expect(summary.getByTestId('overall-performance')).toHaveText('Needs Improvement');
    await expect(summary.getByTestId('overall-headline')).toContainText('1 of 2 answered questions correct (50% accuracy)');
    await expect(summary.getByTestId('difficulty-row')).toHaveCount(3);
    await expect(summary.getByTestId('improvement').first()).toContainText(second.category);
    await expect(summary.getByTestId('follow-up').first()).toContainText(second.category);

    // Detailed review, in session order, with the letters the candidate saw.
    const items = page.getByTestId('review-item');
    await expect(items).toHaveCount(10);
    const review = items.nth(1);
    await expect(review).toHaveAttribute('data-question-id', second.id);
    await expect(review).toHaveAttribute('data-status', 'incorrect');
    await review.locator('summary').click();
    await expect(review.getByTestId('review-candidate')).toContainText(wrongKey);
    await expect(review.getByTestId('review-correct')).toContainText(rightKey);
    await expect(review.locator('.explanation')).toBeVisible();
    await expect(review.getByTestId('review-points')).toHaveText(`0 / ${second.points} pts`);
    await expect(items.nth(2)).toHaveAttribute('data-status', 'unanswered');
  });
});

test.describe('export PDF', () => {
  /** Finishes a short quiz (one correct answer, then time runs out) with window.print stubbed. */
  async function finishWithPrintStub(page) {
    await page.addInitScript(() => {
      window.__prints = [];
      window.print = () =>
        window.__prints.push({
          title: document.title,
          closedDetails: document.querySelectorAll('details:not([open])').length,
          reviewItems: document.querySelectorAll('[data-testid="review-item"]').length,
        });
    });
    await page.reload();
    await startQuiz(page, 5);
    await expect(page.getByTestId('export-pdf')).toHaveCount(0); // only on the result page
    await answerCurrent(page, (await currentQuestion(page)).answer);
    await page.clock.fastForward('05:00');
    await expect(page.getByTestId('summary')).toBeVisible();
  }

  test('Export PDF opens the print dialog with every review expanded and a descriptive file name', async ({ page }) => {
    await finishWithPrintStub(page);
    const appTitle = await page.title();
    const points = await page.getByTestId('summary-points').textContent();

    await page.getByTestId('export-pdf').click();
    const prints = await page.evaluate(() => window.__prints);
    expect(prints).toHaveLength(1);
    expect(prints[0].reviewItems).toBe(10);
    expect(prints[0].closedDetails).toBe(0);
    const [earned, total] = points.split('/').map((n) => n.trim());
    expect(prints[0].title).toMatch(new RegExp(`^js-quiz-result-\\d{4}-\\d{2}-\\d{2}-\\d{4}-${earned}of${total}$`));

    // Closing the dialog restores the page as it was.
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page).toHaveTitle(appTitle);
    await expect(page.locator('[data-testid="review-item"][open]')).toHaveCount(0);
  });

  test('the print layout is a clean report, also via Ctrl/Cmd+P, and renders to a PDF file', async ({ page }) => {
    await finishWithPrintStub(page);
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint'))); // what Ctrl/Cmd+P fires
    await expect(page.locator('[data-testid="review-item"][open]')).toHaveCount(10);

    await page.emulateMedia({ media: 'print' });
    await expect(page.getByTestId('print-report')).toBeVisible();
    await expect(page.getByTestId('print-report')).toContainText('Assessment report');
    for (const hidden of ['.topbar', '.sidebar', '.summary__actions']) {
      await expect(page.locator(hidden)).toBeHidden();
    }
    await expect(page.getByTestId('interviewer-summary')).toBeVisible();
    await expect(page.getByTestId('review-correct').first()).toBeVisible();

    // Page-break rules: block layout so long sections can continue on the next page,
    // and a question's heading is never split or left alone at the bottom of a page.
    const printStyles = await page.evaluate(() => {
      const css = (selector) => getComputedStyle(document.querySelector(selector));
      return {
        summary: css('.summary').display,
        review: css('.review-item').display,
        headingInside: css('.review-item__summary').breakInside,
        headingAfter: css('.review-item__summary').breakAfter,
        answers: css('.review-answers').breakInside,
      };
    });
    expect(printStyles).toEqual({ summary: 'block', review: 'block', headingInside: 'avoid', headingAfter: 'avoid', answers: 'avoid' });

    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(50_000);

    await page.emulateMedia({ media: 'screen' });
    await expect(page.getByTestId('print-report')).toBeHidden();
  });
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

test('on a phone, answering keeps the scroll position and the current question stays visible in the strip', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await startQuiz(page);
  const options = page.locator('label:has(input[name="answer"])');

  await options.last().scrollIntoViewIfNeeded();
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(0);
  await options.first().click();
  await expect(page.locator('input[name="answer"]').first()).toBeChecked();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);

  // Moving to the last question scrolls the navigator strip, not the page.
  await page.locator('[data-testid="nav-item"]').last().click();
  const chipVisible = await page.evaluate(() => {
    const strip = document.querySelector('[data-region="nav"]').getBoundingClientRect();
    const chip = document.querySelector('.is-current').getBoundingClientRect();
    return chip.left >= strip.left && chip.right <= strip.right;
  });
  expect(chipVisible).toBe(true);
});
