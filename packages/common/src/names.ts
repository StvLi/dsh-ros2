/**
 * One safe path component: a string that may be appended to a directory (and
 * carry a suffix) without ever escaping it — no separator, no `.`/`..`
 * segment, no control character, bounded to a sane file-name budget.
 *
 * Every caller that turns a caller-supplied string into a file name uses this
 * same rule, so the escape boundary cannot drift between them. The
 * authoritative checks live next to the filesystem operation, in
 * `scripts/robot_profile.py` (`safe_name()`) and `scripts/pty_session.py`
 * (`safe_sid()`), which are what actually open the file; this is the
 * Tool-layer guard that keeps an unsafe value from ever reaching them.
 */
export const PATH_COMPONENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** Whether `value` may safely become one path component (no path escape). */
export function isSafePathComponent(value: string): boolean {
  // `..` cannot survive without a separator, but reject it explicitly so the
  // intent is obvious and a future separator allowance cannot reintroduce it.
  return PATH_COMPONENT_RE.test(value) && !value.includes('..')
}

/**
 * Robot profile names double as YAML file names
 * (`~/.dsh-ros2/robots/<name>.yaml`). Same rule as any other path component;
 * kept under its own name so a future tightening of ONE namespace cannot
 * silently retighten the other.
 */
export const PROFILE_NAME_RE = PATH_COMPONENT_RE

/** Whether `name` may safely become one profile file name (no path escape). */
export function isSafeProfileName(name: string): boolean {
  return isSafePathComponent(name)
}
