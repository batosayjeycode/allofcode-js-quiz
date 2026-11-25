/**
 * Tiny markdown subset for question explanations:
 * paragraphs, "-" / "1." lists, `code`, **bold** and *italic*.
 * Input is escaped first, so question text can never inject HTML.
 */
import { escapeHtml } from './dom.js';

export function renderInline(text) {
  const codeSpans = [];
  let html = escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => {
    codeSpans.push(code);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // eslint-disable-next-line no-control-regex
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codeSpans[Number(i)]}</code>`);
}

export function renderMarkdown(source) {
  const blocks = String(source).trim().split(/\n\s*\n/);
  return blocks
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim());
      if (lines.every((line) => /^[-*] /.test(line))) {
        return `<ul>${lines.map((line) => `<li>${renderInline(line.slice(2))}</li>`).join('')}</ul>`;
      }
      if (lines.every((line) => /^\d+\. /.test(line))) {
        return `<ol>${lines.map((line) => `<li>${renderInline(line.replace(/^\d+\. /, ''))}</li>`).join('')}</ol>`;
      }
      return `<p>${renderInline(lines.join(' '))}</p>`;
    })
    .join('');
}
