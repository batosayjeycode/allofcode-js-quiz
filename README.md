# JS Quiz

An interactive web app for JavaScript interviews. The candidate reads a snippet, predicts the result,
then runs the code in an isolated sandbox. The app compares the prediction with the **actual**
execution result and shows an explanation.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

| Command            | What it does                                                         |
| ------------------ | -------------------------------------------------------------------- |
| `npm run dev`      | Vite dev server                                                      |
| `npm run build`    | Production build to `dist/` (static, no backend needed)              |
| `npm run preview`  | Serve the production build                                           |
| `npm run lint`     | ESLint                                                               |
| `npm test`         | Unit tests (Vitest). Runs every bank question in a sandboxed worker  |
| `npm run test:e2e` | Playwright end-to-end tests (desktop + tablet) using local Chrome    |
| `npm run check`    | All of the above                                                     |

E2E tests use the installed Google Chrome (`channel: 'chrome'`). To use Playwright's bundled Chromium instead,
run `npx playwright install chromium` and `PW_CHANNEL= npm run test:e2e`.

## Architecture

```
src/
  engine/            execution + validation (no UI code)
    runtime.js         runs INSIDE the worker: console capture, timer tracking, error capture
    sandbox.worker.js  browser Web Worker entry point
    executor.js        main-thread controller: one worker per run, hard timeout, normalised result
    format.js          DevTools-like value formatting
    validator.js       compares results with option expectations (structural for values)
  questions/         question data (no UI code)
    bank/*.js          the question files; every file here is loaded automatically
    helpers.js         output() / values() / throws() / timesOut() authoring helpers
    schema.js          validation & normalisation of questions
  state/             phase state machine + store (+ localStorage), deadline ticker, scoring
  ui/                rendering only: components, highlighter, markdown, app shell
```

### Quiz flow

The session is a strict, forward-only state machine (`src/state/session.js`):

```
preparation (5 min, read-only) → durationSelection (5 / 10 / 15 min) → quiz → result
```

- **Preparation** shows every question read-only. Answering and running are disabled, and the phase can't be skipped.
- **Duration selection** offers only 5, 10 or 15 minutes. Choosing starts the quiz; the choice can't be changed.
- **Quiz** ends when every question has been run or the deadline passes. Runs still in progress at the deadline are
  discarded, so those questions count as unanswered.
- **Result** is read-only and can't be left except by starting a new quiz.

Timers are deadline based: the state stores absolute timestamps, and every action is stamped with the current time.
The reducer applies any deadline that has passed *before* handling an action, so a throttled background tab, a late
tick or a reload can never extend a phase or let a late answer count. A single ticker (`src/state/timer.js`) checks
the clock every 250 ms and again on `visibilitychange`, `focus` and `pageshow`, and any click re-checks it too.

### Anti-cheat

- **One saved session.** The session (phase, deadlines, duration, answers) is kept in `localStorage`, so reloading,
  closing the tab or opening a new tab resumes it with the clock still running. An active quiz can't be restarted.
- **Tabs share it.** Every change re-reads storage first and retries if another tab wrote in between, so all tabs
  show the same session and a stale tab can't overwrite a newer state (such as a finished result).
- **Clock can't go backwards.** The store keeps a persisted high-water mark of the time it has seen, so moving the
  system clock back doesn't add time.
- **Back/forward.** During the quiz a guard history entry keeps the user on the page, and the view always follows the
  saved phase, so navigating back into the app after the quiz shows the result.
- **Tab switches.** Hiding the quiz tab (switching tabs, minimizing, reloading) is counted, with the time away, and
  shown on the result. The timer is never paused.
- **Integrity.** Saved data is validated on load (structure, deadlines that match the chosen duration, answers that
  fit the phase) and every new state is validated before it is saved. Scores are recomputed from the stored execution
  results. Invalid data, or a session untouched for 24 hours outside an active quiz, starts a clean session; if storage
  is cleared or corrupted while a quiz tab is open, it is rewritten from memory.
- **Interrupted runs.** A run cut off by a reload stays locked and is re-run automatically, so the answer can't be
  changed. Async run results are tagged with their session and ignored after the quiz ends.

These are client-side protections. Someone who edits storage or the app with developer tools *before* opening the
quiz can still get a fresh session; preventing that needs a server.

### Assessment mode

- **Randomized per session.** When a session starts it deals a random question order and, for each question, a
  random option order (`src/state/order.js`, using `crypto.getRandomValues`). The order is saved with the session, so
  reloads and other tabs show the same order; only Restart (after a finished quiz) deals a new one. Options keep
  their authored ids internally, so the answer key and scoring are unaffected; the letters A–D on screen and the
  keyboard shortcuts follow the displayed position.
- **Scoring by difficulty.** Easy / Medium / Hard are worth 1 / 2 / 3 points by default, configurable in
  `src/assessment.config.js`. Accuracy is correct ÷ answered, so unanswered questions lower the score but not the
  accuracy.
- **Result page.** Score / maximum, accuracy, correct / incorrect / unanswered, completion status (Completed / Time
  expired), time spent, tab switches, and a per-question review with the candidate's answer, the correct answer, the
  explanation, difficulty and points.
- **Export PDF.** The result page's *Export PDF* button opens the browser's print dialog (choose *Save as PDF*). A
  print stylesheet turns the page into a light, text-based report with a header (start / end time, limit, session),
  every answer review expanded and app controls hidden; the suggested file name is
  `js-quiz-result-<date>-<time>-<points>of<max>`. Ctrl/Cmd+P on the result page gives the same report. No PDF
  library is needed.
- **Interviewer summary** (`src/state/assessment.js`). Built from the answers with fixed rules, no AI: overall
  performance, strengths (topics answered fully correctly), areas for improvement (topics with incorrect or
  unanswered questions, most incorrect first), a breakdown by difficulty, follow-up topics from per-category prompts in
  `src/assessment.config.js`, and notes on time and tab switches. Topics and questions are sorted by name and id, so the
  same answers always give the same summary, whatever order they were shown in.

### Execution sandbox

- Code runs in a **dedicated Web Worker created per run** — never in the page context. The worker
  has no DOM, no access to app state, and is terminated after every run.
- `fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, `postMessage`, … are disabled inside the worker.
- **Timeouts:** the main thread terminates the worker after 3 s, so infinite loops (sync or
  `setInterval`) can never freeze the UI. Output printed before the timeout is kept.
- **Async:** timers are tracked; the run completes once no timers are pending and the
  microtask queue has drained, so promises, `async/await`, and `setTimeout` all finish naturally.
- **Errors:** compile errors (`SyntaxError`), synchronous throws, errors in timer callbacks and
  unhandled promise rejections are all captured with their name, message, and phase.
- Logged values are sent back both as formatted text and as a structured clone, so `values()` expectations
  compare arrays and objects structurally instead of as strings.

### How answers are judged

Each option has an *expectation*. After execution, the validator finds the option whose expectation
matches the actual result. The candidate is correct when that is the option they picked. Each question also has an
`answer` key. The unit tests check that real execution matches exactly that option for every question,
and the UI shows a warning if the two ever disagree.

## Adding questions

Create a file in `src/questions/bank/` (or append to an existing one). No other code changes are needed:

```js
import { output, throws, values, labeled } from '../helpers.js';

export default [
  {
    id: 'JS-011',                       // unique
    title: 'Optional chaining',
    category: 'Operators',
    difficulty: 'Medium',               // Easy | Medium | Hard (default Medium; Basic/Intermediate/Advanced/Expert still accepted)
    points: 2,                          // optional: overrides the difficulty's points (src/assessment.config.js)
    description: 'What is printed?',
    code: `
      const user = {};
      console.log(user.profile?.name ?? 'anon');
    `,
    options: [
      output('anon'),                   // console prints these lines
      output('undefined'),
      throws('TypeError'),              // code throws (optionally { logs, messageIncludes })
      values(null),                     // logged values compared structurally
    ],
    answer: 'A',                        // option ids are assigned A, B, C, … in authored order (shown shuffled)
    explanation: 'Markdown-lite: `code`, **bold**, *italic*, "- " and "1." lists.',
  },
];
```

Run `npm test`. It checks the schema and executes the snippet to confirm the answer key.
