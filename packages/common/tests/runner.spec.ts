import { describe, expect, it } from 'vitest'
import { ensureWritableRosLogDir } from '../src/runner.js'

describe('ensureWritableRosLogDir', () => {
  it('keeps an explicitly set ROS_LOG_DIR in the env', () => {
    const env = { ROS_LOG_DIR: '/tmp/x' }
    ensureWritableRosLogDir(env)
    expect(env.ROS_LOG_DIR).toBe('/tmp/x')
  })

  it('keeps the ambient process ROS_LOG_DIR when set', () => {
    const prev = process.env.ROS_LOG_DIR
    process.env.ROS_LOG_DIR = '/tmp/ambient'
    try {
      const env: Record<string, string> = {}
      ensureWritableRosLogDir(env)
      expect(env.ROS_LOG_DIR).toBe('/tmp/ambient')
    } finally {
      if (prev === undefined) delete process.env.ROS_LOG_DIR
      else process.env.ROS_LOG_DIR = prev
    }
  })

  it('falls back to a writable dir without throwing when nothing is set', () => {
    const prev = process.env.ROS_LOG_DIR
    delete process.env.ROS_LOG_DIR
    try {
      const env: Record<string, string> = {}
      expect(() => ensureWritableRosLogDir(env)).not.toThrow()
      // writable host: no override; locked-down host: a non-empty fallback dir
      if (env.ROS_LOG_DIR !== undefined) expect(env.ROS_LOG_DIR.length).toBeGreaterThan(0)
    } finally {
      if (prev !== undefined) process.env.ROS_LOG_DIR = prev
    }
  })
})

describe('resolveSetup fallback chain + session override', () => {
  function tempSetup(sub: string): string {
    const { mkdirSync, writeFileSync } = require('node:fs')
    const dir = `/tmp/dsh-runner-${sub}-${process.pid}`
    mkdirSync(`${dir}/install`, { recursive: true })
    writeFileSync(`${dir}/install/setup.bash`, 'true\n')
    return `${dir}/install/setup.bash`
  }

  it('uses the explicit rosSetup when its source path exists', async () => {
    const { resolveSetup } = await import('../src/runner.js')
    const src = tempSetup('explicit')
    const setup = resolveSetup({ rosSetup: `source ${src} && ` })
    expect(setup.explicit).toBe(true)
    expect(setup.prefix).toBe(`source ${src} && `)
  })

  it('falls back to auto-detect when the explicit source path is missing', async () => {
    const { resolveSetup } = await import('../src/runner.js')
    const setup = resolveSetup({ rosSetup: 'source /nonexistent/ros/setup.bash && ', workspaceRoot: '' })
    expect(setup.explicit).toBe(true)
    expect(setup.note).toContain('不存在')
    // never keeps the broken explicit prefix; either auto-detected or empty
    expect(setup.prefix.includes('nonexistent')).toBe(false)
    expect(['', 'source /opt/ros/']).toContain(setup.prefix.slice(0, 'source /opt/ros/'.length))
  })

  it('session override beats the configured rosSetup (real paths)', async () => {
    const { resolveSetup, setSessionRosSetup, getSessionRosSetup } = await import('../src/runner.js')
    const override = tempSetup('override')
    const configured = tempSetup('configured')
    try {
      setSessionRosSetup(`source ${override} && `)
      const setup = resolveSetup({ rosSetup: `source ${configured} && ` })
      expect(setup.prefix).toBe(`source ${override} && `)
      setSessionRosSetup(null)
      expect(getSessionRosSetup()).toBeNull()
      const after = resolveSetup({ rosSetup: `source ${configured} && ` })
      expect(after.prefix).toBe(`source ${configured} && `)
    } finally {
      setSessionRosSetup(null)
    }
  })

  it('de-quotes a shq()-quoted source path (even with spaces) back to the unquoted path', async () => {
    // ros2_workspace `use` now stores `source '<path>' && ` via shq(); resolveSetup
    // must return the RAW path so the existence check runs against the real file
    // and the prefix round-trips unchanged instead of falsely auto-falling-back.
    const { resolveSetup } = await import('../src/runner.js')
    const dir = `/tmp/dsh runner ${process.pid}`
    const { mkdirSync, writeFileSync, rmSync } = require('node:fs')
    mkdirSync(`${dir}/install`, { recursive: true })
    writeFileSync(`${dir}/install/setup.bash`, 'true\n')
    const src = `${dir}/install/setup.bash`
    const quoted = `source '${src}' && `
    try {
      const setup = resolveSetup({ rosSetup: quoted })
      expect(setup.explicit).toBe(true)
      expect(setup.sourcePath).toBe(src)
      expect(setup.prefix).toBe(quoted)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // ── whole-chain validation ─────────────────────────────────────────────
  // The live shape (2026-09-21, a deployment whose rosSetup was
  // `source <delivery ws> && source /tmp/vlm_ws/…`: the tail's directory had
  // been deleted, so EVERY ros2 tool failed while the head — and therefore the
  // old first-segment-only check — still looked healthy.

  it('names a missing TAIL segment and keeps the healthy head it was meant to build', async () => {
    const { resolveSetup } = await import('../src/runner.js')
    const head = tempSetup('chain-head')
    const setup = resolveSetup({ rosSetup: `source ${head} && source /nonexistent/dsh-chain/setup.bash && ` })
    expect(setup.explicit).toBe(true)
    expect(setup.missingSources).toEqual(['/nonexistent/dsh-chain/setup.bash'])
    // the intended environment is kept, not swapped for an auto-detected one…
    expect(setup.prefix).toBe(`source ${head} && `)
    expect(setup.sourcePath).toBe(head)
    // …and the misconfiguration is named instead of being left to stderr
    expect(setup.note).toContain('/nonexistent/dsh-chain/setup.bash')
  })

  it('drops only the missing segment of a longer chain and preserves the rest verbatim', async () => {
    const { resolveSetup } = await import('../src/runner.js')
    const a = tempSetup('chain-a')
    const b = tempSetup('chain-b')
    const setup = resolveSetup({
      rosSetup: `export DSH_X=1 && source ${a} && source /nope/setup.bash && source '${b}' && `,
    })
    expect(setup.missingSources).toEqual(['/nope/setup.bash'])
    expect(setup.prefix).toBe(`export DSH_X=1 && source ${a} && source '${b}' && `)
    expect(setup.sourcePath).toBe(a)
  })

  it('leaves a fully healthy chain byte-identical (no behaviour change)', async () => {
    const { resolveSetup } = await import('../src/runner.js')
    const a = tempSetup('ok-a')
    const b = tempSetup('ok-b')
    const chain = `source ${a} && source '${b}' && `
    const setup = resolveSetup({ rosSetup: chain })
    expect(setup.prefix).toBe(chain)
    expect(setup.sourcePath).toBe(a)
    expect(setup.missingSources).toEqual([])
    expect(setup.note).toBe('')
  })

  it('falls back to auto-detect when every configured segment is missing, naming all of them', async () => {
    const { resolveSetup } = await import('../src/runner.js')
    const setup = resolveSetup({
      rosSetup: 'source /nonexistent/a/setup.bash && source /nonexistent/b/setup.bash && ',
      workspaceRoot: '',
    })
    expect(setup.missingSources).toEqual(['/nonexistent/a/setup.bash', '/nonexistent/b/setup.bash'])
    expect(setup.note).toContain('/nonexistent/a/setup.bash')
    expect(setup.note).toContain('/nonexistent/b/setup.bash')
    expect(setup.prefix).not.toContain('nonexistent')
  })

  it('validates the session override chain, not only the configured rosSetup', async () => {
    const { resolveSetup, setSessionRosSetup } = await import('../src/runner.js')
    const head = tempSetup('override-chain')
    try {
      setSessionRosSetup(`source ${head} && source /nonexistent/override/setup.bash && `)
      const setup = resolveSetup({ rosSetup: '' })
      expect(setup.prefix).toBe(`source ${head} && `)
      expect(setup.missingSources).toEqual(['/nonexistent/override/setup.bash'])
    } finally {
      setSessionRosSetup(null)
    }
  })
})

describe('buildSafetyMonitorCommand', () => {
  it('emits the profile path as a single shq() shell word', async () => {
    const { buildSafetyMonitorCommand } = await import('../src/runner.js')
    expect(buildSafetyMonitorCommand('/tmp/testbot.yaml'))
      .toBe("ros2 run dsh_ros2_safety safety_monitor --profile '/tmp/testbot.yaml'")
  })

  it('neutralises shell metacharacters and embedded quotes in the profile path', async () => {
    const { buildSafetyMonitorCommand } = await import('../src/runner.js')
    const hostile = "/tmp/a'; touch /tmp/pwned; echo '"
    const cmd = buildSafetyMonitorCommand(hostile)
    // The whole hostile value stays inside ONE single-quoted word; the embedded
    // quote is escaped as '\'' so `;` / `touch` can never become shell syntax.
    expect(cmd).toBe(`ros2 run dsh_ros2_safety safety_monitor --profile '/tmp/a'\\''; touch /tmp/pwned; echo '\\'''`)
    expect(cmd).not.toContain("--profile '/tmp/a'; touch")
  })
})
