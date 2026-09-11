/**
 * Robot profile names double as YAML file names
 * (`~/.dsh-ros2/robots/<name>.yaml`), so a name must never carry a path
 * separator, a `.`/`..` segment, or any other escape out of the profiles
 * directory. This is the single source of truth for the Tool layer; the
 * authoritative check lives in `scripts/robot_profile.py` (`safe_name()`),
 * which is what actually opens the file.
 */
export const PROFILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** Whether `name` may safely become one profile file name (no path escape). */
export function isSafeProfileName(name: string): boolean {
  // `..` cannot survive without a separator, but reject it explicitly so the
  // intent is obvious and a future separator allowance cannot reintroduce it.
  return PROFILE_NAME_RE.test(name) && !name.includes('..')
}
