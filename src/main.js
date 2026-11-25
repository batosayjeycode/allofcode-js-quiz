import './styles.css';
import { executeCode } from './engine/executor.js';
import { questions } from './questions/index.js';
import { createSessionStore } from './state/session.js';
import { mountApp } from './ui/app.js';

function safeSessionStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const store = createSessionStore(questions, { storage: safeSessionStorage() });

mountApp(document.getElementById('app'), {
  questions,
  store,
  execute: (code) => executeCode(code),
});
