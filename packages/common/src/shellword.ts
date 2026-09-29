/**
 * Shell-word parsing for `rosSetup` chains.
 *
 * A `rosSetup` value is a SHELL string (`source A && source B && `): the word
 * after `source` is interpreted by bash, not by Node. The existence probe that
 * backs self-heal compares that word against the filesystem, and comparing the
 * RAW text is only correct for a literal absolute path:
 *
 *   `source ~/vlm_ws/install/setup.bash`   ← README's persistent-path example
 *   `source $HOME/vlm_ws/install/setup.bash`
 *   `source "$ROS_WS/install/setup.bash"`
 *
 * all name a file that exists, but not as those literal strings. The probe used
 * to report a HEALTHY workspace as missing, drop the segment, and — when it was
 * the only segment — replace it with an auto-detected `/opt/ros/<distro>/setup.bash`.
 * That is precisely the failure the surrounding code documents itself as
 * preventing: the plugin silently ran against a different environment than the
 * one configured, and the docs now recommend the `~/…` form.
 *
 * So: resolve the word the way bash does for the two expansions that decide
 * existence — leading `~` and parameter expansion — and SAY SO when it cannot.
 * The word is never rewritten: callers keep the configured text
 * verbatim in the emitted prefix and only use the resolved path to answer
 * "does this exist?". An unresolvable word (`~user`, unset variable, `$(...)`)
 * is left to the shell and must not be treated as dead.
 */

import { homedir } from 'node:os'

/** How the shell word was quoted — this decides what bash expands inside it. */
export type WordQuoting = 'bare' | 'double' | 'single'

/** A `source` argument as written, with the outer quotes removed. */
export interface ShellWord {
  /**
   * The word's text with the outer quoting removed. Backslash escapes are kept
   * verbatim: whether `\X` is a literal `X` (bare, double) or a plain backslash
   * (single) is decided during expansion, and the caller's prefix must stay
   * byte-identical either way.
   */
  text: string
  quoting: WordQuoting
}

/** A shell word resolved to a filesystem path, plus whether that is knowable. */
export interface ResolvedWord {
  /** Best-effort path: expanded where possible, otherwise the text as written. */
  path: string
  /**
   * `false` = the word could not be fully resolved here (unset variable,
   * `~user`, command substitution), so existence is UNKNOWN. Callers must not
   * act on it as if the path were proven missing.
   */
  verified: boolean
}

const SOURCE_KEYWORD = /\bsource\s+/
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const SEPARATOR = /[\s&;|]/

/**
 * Read one shell word starting at `start`.
 *
 * Bare words end at unquoted whitespace or a control token, and honour `\X`
 * escapes (so `source /a\ b/setup.bash` is ONE word, which the previous
 * character-class regex truncated at the space). Single quotes are literal;
 * double quotes honour the four characters bash lets a backslash escape.
 * Returns `undefined` for unterminated quoting — malformed input stays
 * unverifiable rather than being guessed at.
 */
function readWord(input: string, start: number): ShellWord | undefined {
  const first = input[start]
  if (first === undefined) return undefined
  if (first === "'") {
    const end = input.indexOf("'", start + 1)
    if (end < 0) return undefined
    return { text: input.slice(start + 1, end), quoting: 'single' }
  }
  if (first === '"') {
    let i = start + 1
    let text = ''
    while (i < input.length) {
      const ch = input[i]!
      if (ch === '"') return { text, quoting: 'double' }
      if (ch === '\\' && i + 1 < input.length) {
        text += ch + input[i + 1]!
        i += 2
        continue
      }
      text += ch
      i += 1
    }
    return undefined
  }
  let i = start
  let text = ''
  while (i < input.length) {
    const ch = input[i]!
    if (ch === '\\' && i + 1 < input.length) {
      text += ch + input[i + 1]!
      i += 2
      continue
    }
    if (SEPARATOR.test(ch)) break
    text += ch
    i += 1
  }
  return text ? { text, quoting: 'bare' } : undefined
}

/**
 * Extract the `source` argument of ONE `&&`-separated segment
 * (`source <word>`), where <word> may be bare, single-quoted (`shq`) or
 * double-quoted. Returns `undefined` when the segment carries no `source`
 * (e.g. `export FOO=1`), which is not a path claim at all.
 */
export function parseSourceWord(segment: string): ShellWord | undefined {
  const match = SOURCE_KEYWORD.exec(segment)
  if (!match) return undefined
  return readWord(segment, match.index + match[0].length)
}

/**
 * Read a parameter expansion at `at` (`$NAME` or `${NAME}`).
 * Returns `null` for anything else that starts with `$` — `${X:-y}`, `$(cmd)`,
 * `$((expr))`, `$1`, `$?` — because those are not resolvable here.
 */
function readVariable(input: string, at: number): { name: string; end: number } | null {
  const next = input[at + 1]
  if (next === undefined) return null
  if (next === '{') {
    const close = input.indexOf('}', at + 2)
    if (close < 0) return null
    const name = input.slice(at + 2, close)
    if (!VARIABLE_NAME.test(name)) return null
    return { name, end: close + 1 }
  }
  let end = at + 1
  while (end < input.length && /[A-Za-z0-9_]/.test(input[end]!)) end += 1
  const name = input.slice(at + 1, end)
  if (!/^[A-Za-z_]/.test(name)) return null
  return { name, end }
}

/**
 * Resolve a shell word to a path, applying only what determines existence.
 *
 * - bare: leading `~` → home directory; `$NAME`/`${NAME}` → the environment;
 *   `\X` → literal `X`.
 * - double: NO tilde expansion (bash does not expand `~` inside quotes);
 *   parameter expansion applies; `\` escapes only ``$ ` " \``.
 * - single: nothing expands; the text is already literal.
 *
 * An unresolvable piece does not abort: the best-effort path is returned with
 * `verified: false` so the caller can decline to judge it.
 */
export function expandShellWord(word: ShellWord): ResolvedWord {
  const { text, quoting } = word
  let out = ''
  let verified = true
  let i = 0
  if (quoting === 'bare') {
    if (text === '~' || text.startsWith('~/')) {
      out += homedir()
      i = 1 // the loop copies the '/' (if any) verbatim
    } else if (text.startsWith('~')) {
      verified = false // ~user / ~+ / ~-: not resolvable without a passwd lookup
    }
  }
  while (i < text.length) {
    const ch = text[i]!
    if (ch === '\\') {
      const next = text[i + 1]
      if (next === undefined) {
        out += ch
        i += 1
        continue
      }
      // Inside double quotes a backslash is only special before these four.
      if (quoting === 'double' && next !== '$' && next !== '`' && next !== '"' && next !== '\\') {
        out += ch + next
      } else {
        out += next
      }
      i += 2
      continue
    }
    if (quoting !== 'single' && ch === '$') {
      const variable = readVariable(text, i)
      if (variable) {
        const value = process.env[variable.name]
        // Unset: bash would expand to '' — we cannot decide whether the path
        // exists, so mark it unknown instead of declaring the segment dead.
        if (value === undefined) verified = false
        else out += value
        i = variable.end
        continue
      }
      verified = false
      out += ch
      i += 1
      continue
    }
    out += ch
    i += 1
  }
  return { path: out, verified }
}

/** Parse + expand one segment's `source` word in a single step. */
export function resolveSourcePath(segment: string): ResolvedWord | undefined {
  const word = parseSourceWord(segment)
  return word ? expandShellWord(word) : undefined
}
