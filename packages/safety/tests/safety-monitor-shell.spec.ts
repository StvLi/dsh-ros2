import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Regression guard for the V-001 command-injection fix (PR #11).
 *
 * `safety_monitor` used to interpolate a config-supplied watchdog topic into a
 * `bash -lc "timeout N ros2 topic echo {topic} --once"` string, so a topic
 * containing `;` / `$()` / backticks executed arbitrary commands under the
 * safety-critical monitor. The fix scans topics through an argv array instead.
 *
 * The shipped script is a ROS2 node (rclpy), so it is not importable here;
 * this asserts on the source text that the shell cannot creep back in.
 */
const source = readFileSync(
  fileURLToPath(new URL('../safety/scripts/safety_monitor', import.meta.url)),
  'utf8',
)

describe('safety_monitor shell safety', () => {
  it('never invokes a shell', () => {
    expect(source).not.toMatch(/\bbash\b/)
    expect(source).not.toMatch(/shell\s*=\s*True/)
  })

  it('scans watchdog topics through an argv array (no interpolation)', () => {
    expect(source).toMatch(/"topic",\s*"echo",\s*topic,\s*"--once"/)
  })
})
