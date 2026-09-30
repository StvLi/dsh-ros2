/**
 * Character classes spelled out, so the linear scanners in `parse.ts` and
 * `toolkit.ts` agree with the regex shorthands they replaced (`\s`, `\w`).
 *
 * `\s` is wider than ASCII: it also accepts U+00A0, U+1680, U+2000–U+200A,
 * U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. Enumerating them is what
 * keeps the scanners byte-for-byte equivalent instead of only ASCII-equivalent;
 * `tests/parser-linear.spec.ts` re-derives both sets from the engine and
 * asserts agreement.
 */

const WHITESPACE = new Set([
  '\t',
  '\n',
  '\v',
  '\f',
  '\r',
  ' ',
  '\u00a0',
  '\u1680',
  '\u2000',
  '\u2001',
  '\u2002',
  '\u2003',
  '\u2004',
  '\u2005',
  '\u2006',
  '\u2007',
  '\u2008',
  '\u2009',
  '\u200a',
  '\u2028',
  '\u2029',
  '\u202f',
  '\u205f',
  '\u3000',
  '\ufeff',
])

/** True for exactly the code points JavaScript's `\s` matches. */
export function isWhitespace(ch: string): boolean {
  return WHITESPACE.has(ch)
}

/** True for exactly the code points JavaScript's `\w` matches (`[A-Za-z0-9_]`). */
export function isWordChar(ch: string): boolean {
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    (ch >= '0' && ch <= '9') ||
    ch === '_'
  )
}
