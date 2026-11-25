import { describe, expect, it } from 'vitest';
import { describeError } from '../../src/engine/executor.js';
import { highlightLines, tokenize } from '../../src/ui/highlight.js';
import { renderInline, renderMarkdown } from '../../src/ui/markdown.js';

describe('highlighter', () => {
  it('classifies tokens', () => {
    const types = Object.fromEntries(
      tokenize("const x = 'a'; // hi\nconsole.log(x.length, 42, true);")
        .filter((t) => t.type !== 'space')
        .map((t) => [t.value, t.type]),
    );
    expect(types).toMatchObject({
      const: 'keyword',
      "'a'": 'string',
      '// hi': 'comment',
      console: 'builtin',
      log: 'function',
      length: 'property',
      42: 'number',
      true: 'literal',
    });
  });

  it('escapes HTML and preserves line structure', () => {
    const lines = highlightLines("const s = `<b>\n</b>`;\nx < y");
    expect(lines).toHaveLength(3);
    expect(lines.join('\n')).not.toContain('<b>');
    expect(lines[2]).toContain('&lt;');
  });
});

describe('markdown', () => {
  it('renders inline code, bold and italics safely', () => {
    expect(renderInline('**a** *b* `<c>` <script>')).toBe(
      '<strong>a</strong> <em>b</em> <code>&lt;c&gt;</code> &lt;script&gt;',
    );
    expect(renderInline('`a * b` and `c * d`')).toBe('<code>a * b</code> and <code>c * d</code>');
  });

  it('renders paragraphs and lists', () => {
    expect(renderMarkdown('One\ntwo\n\n- a\n- b\n\n1. x\n2. y')).toBe(
      '<p>One two</p><ul><li>a</li><li>b</li></ul><ol><li>x</li><li>y</li></ol>',
    );
  });
});

describe('describeError', () => {
  it('formats error phases', () => {
    expect(describeError({ name: 'TypeError', message: 'x', phase: 'sync' })).toBe('Uncaught TypeError: x');
    expect(describeError({ name: 'Error', message: 'x', phase: 'promise' })).toBe('Uncaught (in promise) Error: x');
    expect(describeError({ name: 'SyntaxError', message: 'x', phase: 'compile' })).toBe('SyntaxError: x');
    expect(describeError({ name: 'Uncaught', message: "'s'", phase: 'sync', nonError: true })).toBe("Uncaught 's'");
    expect(describeError({ name: 'TimeoutError', message: 'slow', phase: 'host' })).toBe('TimeoutError: slow');
  });
});
