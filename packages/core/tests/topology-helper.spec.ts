import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `scripts/ros2_topology.py` is the one-process survey behind `ros2_topology`,
 * `ros2_tf_list` and `ros2_tf_echo`. Its graph-facing half needs a live ROS2
 * graph, but the framing logic (hidden-name filtering, action derivation from
 * the `_action/*` plumbing) is pure and checks itself with `--selftest`.
 */
const helper = fileURLToPath(new URL('../scripts/ros2_topology.py', import.meta.url))

describe('scripts/ros2_topology.py', () => {
  it('passes its pure-logic selftest', () => {
    const out = execFileSync('python3', [helper, '--selftest'], { encoding: 'utf8', timeout: 30000 })
    expect(out).toContain('SELFTEST OK')
  })
})
