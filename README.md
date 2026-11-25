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
  state/             phase state machine + store (+ sessionStorage), deadline ticker, scoring
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
the clock every 250 ms and again on `visibilitychange`, `focus` and `pageshow`. The session, including its deadlines,
is saved to `sessionStorage`, so a refresh resumes where it left off with the clock still running.

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
    difficulty: 'Intermediate',         // Basic | Intermediate | Advanced | Expert
    points: 2,                          // optional, default 1
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
    answer: 'A',                        // option ids are assigned A, B, C, … in order
    explanation: 'Markdown-lite: `code`, **bold**, *italic*, "- " and "1." lists.',
  },
];
```

Run `npm test`. It checks the schema and executes the snippet to confirm the answer key.
