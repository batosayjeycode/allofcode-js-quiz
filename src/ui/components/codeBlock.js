import { escapeHtml } from '../dom.js';
import { highlightLines } from '../highlight.js';

export function renderCodeBlock(code, { filename = 'snippet.js' } = {}) {
  const lines = highlightLines(code)
    .map((html, i) => `<span class="code-line"><span class="code-ln" aria-hidden="true">${i + 1}</span><span class="code-src">${html || ' '}</span></span>`)
    .join('');
  return `
    <figure class="code-panel">
      <figcaption class="panel-head">
        <span class="window-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="panel-title">${escapeHtml(filename)}</span>
      </figcaption>
      <pre class="code" tabindex="0" aria-label="Code snippet"><code>${lines}</code></pre>
    </figure>`;
}
