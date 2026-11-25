/**
 * Minimal, dependency-free JavaScript syntax highlighter.
 * Good enough for interview snippets (no regex-literal / nested template parsing).
 */
import { escapeHtml } from './dom.js';

const KEYWORDS = new Set(
  'async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield get set'.split(
    ' ',
  ),
);
const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);
const BUILTINS = new Set(
  'console Promise Object Array Map Set WeakMap WeakSet Symbol JSON Math Number String Boolean BigInt Date RegExp Error TypeError ReferenceError SyntaxError RangeError globalThis setTimeout setInterval clearTimeout clearInterval queueMicrotask structuredClone Reflect Proxy'.split(
    ' ',
  ),
);

const RULES = [
  ['comment', /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y],
  ['string', /'(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?|`(?:\\[\s\S]|[^`\\])*`?/y],
  ['number', /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)n?/y],
  ['identifier', /[A-Za-z_$][\w$]*/y],
  ['space', /\s+/y],
  ['operator', /=>|\.\.\.|\?\?=?|\?\.|\*\*=?|===|!==|&&=?|\|\|=?|[=!<>]=?|[+\-*/%&|^]=?|\+\+|--|[~?:]/y],
  ['punctuation', /[{}()[\];,.]/y],
];

/** @returns {{ type: string, value: string }[]} */
export function tokenize(code) {
  const tokens = [];
  let index = 0;
  while (index < code.length) {
    let matched = false;
    for (const [type, pattern] of RULES) {
      pattern.lastIndex = index;
      const match = pattern.exec(code);
      if (match && match[0].length) {
        tokens.push({ type, value: match[0] });
        index += match[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      tokens.push({ type: 'plain', value: code[index] });
      index += 1;
    }
  }
  return classifyIdentifiers(tokens);
}

function classifyIdentifiers(tokens) {
  const significant = (from, step) => {
    for (let i = from; i >= 0 && i < tokens.length; i += step) {
      if (tokens[i].type !== 'space' && tokens[i].type !== 'comment') return tokens[i];
    }
    return null;
  };
  return tokens.map((token, i) => {
    if (token.type !== 'identifier') return token;
    const prev = significant(i - 1, -1);
    const next = significant(i + 1, 1);
    const isProperty = prev?.value === '.' || prev?.value === '?.';
    let type = 'plain';
    if (!isProperty && KEYWORDS.has(token.value)) type = 'keyword';
    else if (!isProperty && LITERALS.has(token.value)) type = 'literal';
    else if (next?.value === '(') type = 'function';
    else if (!isProperty && BUILTINS.has(token.value)) type = 'builtin';
    else if (isProperty || next?.value === ':') type = 'property';
    return { type, value: token.value };
  });
}

/**
 * Highlights code and returns one HTML string per source line, so the
 * caller can render line numbers. Multi-line tokens are split per line.
 */
export function highlightLines(code) {
  const lines = [''];
  for (const token of tokenize(code)) {
    const pieces = token.value.split('\n');
    pieces.forEach((piece, i) => {
      if (i > 0) lines.push('');
      if (!piece) return;
      const text = escapeHtml(piece);
      lines[lines.length - 1] +=
        token.type === 'plain' || token.type === 'space' ? text : `<span class="tok-${token.type}">${text}</span>`;
    });
  }
  return lines;
}
