import './styles.css';
import { executeCode } from './engine/executor.js';
import { questions } from './questions/index.js';
import { createSessionStore } from './state/session.js';
import { mountApp } from './ui/app.js';

// localStorage (not sessionStorage): the session must survive closing the tab
// and be shared by every tab, so neither can be used to start over mid-quiz.
function safeLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const store = createSessionStore(questions, { storage: safeLocalStorage() });

mountApp(document.getElementById('app'), {
  questions,
  store,
  execute: (code) => executeCode(code),
});
