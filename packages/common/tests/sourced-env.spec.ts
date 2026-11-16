/**
 * The environment a sourced setup chain exports, and what may cross from that
 * shell into a child we exec directly (round 33).
 *
 * Context: `runCommand` runs everything as `bash -lc '<setup prefix> <command>'`,
 * so the sourced environment exists — but only inside that bash. Children that
 * are spawned directly (rviz2 / rqt, started by `ros2_gui_start`) got the
 * plugin's own `process.env`. On the maintenance host that meant
 * `command -v rviz2` was EMPTY inside the child, while
 * `/opt/ros/jazzy/bin/rviz2` existed after sourcing the deployment's setup.
 *
 * These cases pin the two halves of the fix: (a) the capture goes through the
 * same seam as every other command, and (b) what comes back is bounded and
 * shape-checked before it becomes a child's environment.
 */
import { describe, expect, it } from 'vitest'
import {
  captureSourcedEnv,
  parseSourcedEnv,
  type ToolDeps,
} from '../src/toolkit.js'
import type { RosResult, RunOptions } from '../src/runner.js'

function res(over: Partial<RosResult> = {}): RosResult {
  return {
    ok: true,
    command: 'env -0',
    stdout: '',
    stderr: '',
    exitCode: 0,
    timedOut: false,
    durationMs: 1,
    ...over,
  }
}

function depsWithRun(
  run: (bin: string, args: string[], opts?: RunOptions) => Promise<RosResult>,
  extra: Partial<ToolDeps> = {},
): ToolDeps {
  return { run, ...extra }
}

describe('parseSourcedEnv', () => {
  it('keeps an ordinary environment and reports no note', () => {
    const parsed = parseSourcedEnv('PATH=/opt/ros/jazzy/bin:/usr/bin\u0000ROS_DISTRO=jazzy\u0000')
    expect(parsed.env).toEqual({ PATH: '/opt/ros/jazzy/bin:/usr/bin', ROS_DISTRO: 'jazzy' })
    expect(parsed.note).toBeUndefined()
  })

  it('keeps a value that merely CONTAINS an equals sign', () => {
    const parsed = parseSourcedEnv('AMENT_PREFIX_PATH=/opt/ros/jazzy\u0000FLAGS=-DFOO=1\u0000')
    expect(parsed.env.FLAGS).toBe('-DFOO=1')
  })

  it('drops an exported bash function: those bytes are shell syntax, not a value', () => {
    // Real shape of `f() { echo pwned; }; export -f f` in `env -0` output.
    const parsed = parseSourcedEnv(
      'BASH_FUNC_f%%=() {  echo pwned\n}\u0000MARKER=1\u0000',
    )
    expect(parsed.env).toEqual({ MARKER: '1' })
    expect(Object.keys(parsed.env).some((k) => k.startsWith('BASH_FUNC_'))).toBe(false)
    expect(parsed.note).toContain('不是环境变量')
  })

  it('drops the producing shell\'s own session state', () => {
    const parsed = parseSourcedEnv('SHLVL=3\u0000_=/usr/bin/env\u0000RANDOM=1234\u0000HOME=/home/u\u0000')
    expect(parsed.env).toEqual({ HOME: '/home/u' })
    expect(parsed.note).toContain('shell 会话状态')
  })

  it('does not let the setup chain move the child to another display', () => {
    // `wmctrl` / `xdotool` / the screenshot commands run through the run seam,
    // i.e. on the plugin's DISPLAY. A child started on a different one would be
    // listed and captured on the wrong display: a window that exists and can
    // never be found.
    const parsed = parseSourcedEnv(
      'DISPLAY=:99\u0000WAYLAND_DISPLAY=wayland-9\u0000XAUTHORITY=/tmp/other-xauth\u0000'
      + 'DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/other-bus\u0000PATH=/opt/ros/jazzy/bin\u0000',
    )
    expect(parsed.env).toEqual({ PATH: '/opt/ros/jazzy/bin' })
    expect(parsed.note).toContain('显示/会话标识')
  })

  it('drops a value over the per-value budget, and says how many', () => {
    const big = 'x'.repeat(9000)
    const parsed = parseSourcedEnv(`HUGE=${big}\u0000MARKER=1\u0000`)
    expect(parsed.env.HUGE).toBeUndefined()
    expect(parsed.env.MARKER).toBe('1')
    expect(parsed.note).toContain('单项 8192 字节预算')
  })

  it('stops at the total budget instead of handing over everything', () => {
    // 40 × 4 KiB = 160 KiB, over the 128 KiB cap.
    const chunk = 'y'.repeat(4096)
    const payload = Array.from({ length: 40 }, (_, i) => `V${i}=${chunk}`).join('\u0000')
    const parsed = parseSourcedEnv(`${payload}\u0000`)
    const kept = Object.keys(parsed.env).length
    expect(kept).toBeGreaterThan(0)
    expect(kept).toBeLessThan(40)
    expect(parsed.note).toContain('总预算')
  })
})

describe('captureSourcedEnv', () => {
  it('asks the run seam for the env through the setup chain it was given', async () => {
    const seen: Array<{ bin: string; args: string[]; opts?: RunOptions }> = []
    const deps = depsWithRun(async (bin, args, opts) => {
      seen.push({ bin, args, ...(opts !== undefined ? { opts } : {}) })
      return res({ stdout: 'MARKER=1\u0000' })
    }, { rosSetup: 'source /ws/install/setup.bash &&', workspaceRoot: '/ws', rosLogDir: '/ws/log' })

    const parsed = await captureSourcedEnv(deps)

    expect(parsed.env).toEqual({ MARKER: '1' })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.bin).toBe('env')
    expect(seen[0]?.args).toEqual(['-0'])
    // Same seam options every other child gets — that is the whole point.
    expect(seen[0]?.opts).toMatchObject({
      rosSetup: 'source /ws/install/setup.bash &&',
      workspaceRoot: '/ws',
      rosLogDir: '/ws/log',
    })
  })

  it('returns an empty environment plus a note when the capture fails, rather than throwing', async () => {
    const deps = depsWithRun(async () => res({ ok: false, error: 'ENOENT', exitCode: null }))
    const parsed = await captureSourcedEnv(deps)
    expect(parsed.env).toEqual({})
    expect(parsed.note).toContain('裸 PATH')
  })

  it('treats a non-zero exit as a failed capture', async () => {
    const deps = depsWithRun(async () => res({ ok: false, exitCode: 127 }))
    const parsed = await captureSourcedEnv(deps)
    expect(parsed.env).toEqual({})
    expect(parsed.note).toContain('退出码 127')
  })
})
