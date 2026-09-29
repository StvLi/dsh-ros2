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
    // The auto-detected path is spliced into a `bash -lc` string, so it must be
    // ONE shq()-quoted shell word — a bare path would break on a space.
    expect(['', `source '/opt/ros`]).toContain(setup.prefix.slice(0, `source '/opt/ros`.length))
  })

  it('quotes the auto-detected setup path so a space or metacharacter cannot break out', async () => {
    const { resolveSetup } = await import('../src/runner.js')
    const { mkdirSync, writeFileSync } = require('node:fs')
    // A workspace root carrying both a space and a shell metacharacter.
    const root = `/tmp/dsh-runner auto ws;${process.pid}`
    mkdirSync(`${root}/install`, { recursive: true })
    writeFileSync(`${root}/install/setup.bash`, 'true\n')
    const setup = resolveSetup({ rosSetup: 'source /nonexistent/ros/setup.bash && ', workspaceRoot: root })
    // sourcePath stays a real filesystem path (consumers stat it)…
    expect(setup.sourcePath).toBe(`${root}/install/setup.bash`)
    // …while the prefix carries it as one single-quoted word, so neither the
    // space nor the `;` can end the command or start another one.
    expect(setup.prefix).toBe(`source '${root}/install/setup.bash' && `)
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

  // ── the existence probe reads the SHELL's word, not its raw text ──────────
  // `~/vlm_ws/install/setup.bash` names a real file that the raw string "~/…"
  // is not. Comparing the raw text called the workspace missing, dropped the
  // segment, and — as the only segment — replaced it with an auto-detected
  // /opt/ros setup: a silent swap to a different environment than the one
  // configured, which is exactly what self-heal promises not to do. The README
  // now recommends the `~/vlm_ws` form, so this is the documented path shape.

  function withFakeHome<T>(run: (home: string) => T): T {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
    const { tmpdir } = require('node:os')
    const { join } = require('node:path')
    const prevHome = process.env.HOME
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-'))
    mkdirSync(join(home, 'vlm_ws/install'), { recursive: true })
    writeFileSync(join(home, 'vlm_ws/install/setup.bash'), 'true\n')
    process.env.HOME = home
    try {
      return run(home)
    } finally {
      if (prevHome === undefined) delete process.env.HOME
      else process.env.HOME = prevHome
      rmSync(home, { recursive: true, force: true })
    }
  }

  it('keeps a healthy ~/… workspace instead of dropping it and swapping the environment', async () => {
    const { resolveSetup } = await import('../src/runner.js')
    withFakeHome(() => {
      const chain = 'source ~/vlm_ws/install/setup.bash && '
      const setup = resolveSetup({ rosSetup: chain })
      expect(setup.missingSources).toEqual([])
      expect(setup.note).toBe('')
      // emitted verbatim: the configured text is never rewritten to its expansion
      expect(setup.prefix).toBe(chain)
      expect(setup.prefix).not.toContain('/opt/ros')
    })
  })

  it('validates a $HOME/… segment and still names a genuinely dead sibling', async () => {
    const { resolveSetup } = await import('../src/runner.js')
    withFakeHome(() => {
      const head = 'source $HOME/vlm_ws/install/setup.bash'
      const setup = resolveSetup({ rosSetup: `${head} && source /nonexistent/sibling/setup.bash && ` })
      expect(setup.missingSources).toEqual(['/nonexistent/sibling/setup.bash'])
      expect(setup.prefix).toBe(`${head} && `)
      // reported as WRITTEN, so the operator can find it in the configuration
      expect(setup.sourcePath).toBe('$HOME/vlm_ws/install/setup.bash')
    })
  })

  it("reports a single-quoted '~/…' as missing — bash would not expand it either", async () => {
    const { resolveSetup } = await import('../src/runner.js')
    withFakeHome(() => {
      const setup = resolveSetup({ rosSetup: "source '~/vlm_ws/install/setup.bash' && ", workspaceRoot: '' })
      expect(setup.missingSources).toEqual(['~/vlm_ws/install/setup.bash'])
      expect(setup.prefix).not.toContain('~/vlm_ws')
    })
  })

  it('leaves an unresolvable word to the shell instead of declaring it dead', async () => {
    const { resolveSetup } = await import('../src/runner.js')
    const prev = process.env.DSH_UNSET_WS_PROBE
    delete process.env.DSH_UNSET_WS_PROBE
    try {
      const chain = 'source $DSH_UNSET_WS_PROBE/install/setup.bash && '
      const setup = resolveSetup({ rosSetup: chain })
      expect(setup.missingSources).toEqual([])
      expect(setup.prefix).toBe(chain)
    } finally {
      if (prev !== undefined) process.env.DSH_UNSET_WS_PROBE = prev
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

describe('runCommand setup prefix joining', () => {
  // A prefix that ends at `&&` with no trailing space (the live deployment's
  // ran `… &&ros2 'node' 'list'` in every error) still executes identically —
  // but it read as a malformed command in the diagnostic, so the seam inserts
  // the separator while the reported prefix stays faithful to the config.
  it('inserts the separator when the prefix ends at && and still runs the command', async () => {
    const { runCommand } = await import('../src/runner.js')
    const { mkdirSync, writeFileSync, rmSync } = require('node:fs')
    const dir = `/tmp/dsh-runner-join-${process.pid}`
    mkdirSync(`${dir}/install`, { recursive: true })
    writeFileSync(`${dir}/install/setup.bash`, 'true\n')
    const src = `${dir}/install/setup.bash`
    try {
      const ok = await runCommand('bash', ['-lc', 'echo marker'], { rosSetup: `source ${src} &&` })
      expect(ok.ok).toBe(true)
      expect(ok.stdout.trim()).toBe('marker')
      expect(ok.envNote).toBeUndefined()

      // Failure path: the message echoes the shell string Node ran.
      const bad = await runCommand('bash', ['-lc', 'exit 3'], { rosSetup: `source ${src} &&` })
      expect(bad.ok).toBe(false)
      expect(bad.error).toContain(`source ${src} && bash`)
      expect(bad.error).not.toContain('&&bash')

      // A prefix that already ends in whitespace is left alone.
      const spaced = await runCommand('bash', ['-lc', 'echo marker'], { rosSetup: `source ${src} && ` })
      expect(spaced.ok).toBe(true)
      expect(spaced.stdout.trim()).toBe('marker')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('setupSourcePaths', () => {
  // A chain can name several workspaces; callers that need the workspaces
  // behind the prefix (e.g. the vision doctor's install roots) must see ALL of
  // them, not just the first — reading only the head is what let a deleted
  // tail workspace stay "healthy" before the whole-chain validation landed.
  it('returns every source path of a multi-workspace chain, in order', async () => {
    const { setupSourcePaths } = await import('../src/runner.js')
    const prefix = 'source /ws/a/install/setup.bash && source /ws/b/install/setup.bash && '
    expect(setupSourcePaths(prefix)).toEqual(['/ws/a/install/setup.bash', '/ws/b/install/setup.bash'])
  })

  it('de-quotes quoted paths (including spaces) and ignores non-source segments', async () => {
    const { setupSourcePaths } = await import('../src/runner.js')
    const prefix = `export FOO=1 && source '/tmp/my ws/install/setup.bash' && source "/ws/b/install/setup.bash" && `
    expect(setupSourcePaths(prefix)).toEqual(['/tmp/my ws/install/setup.bash', '/ws/b/install/setup.bash'])
  })

  it('returns an empty list when the prefix sources nothing', async () => {
    const { setupSourcePaths } = await import('../src/runner.js')
    expect(setupSourcePaths('')).toEqual([])
    expect(setupSourcePaths('export ROS_DOMAIN_ID=1 && ')).toEqual([])
  })

  it('resolves ~ and $VAR so a consumer can stat the workspace it names', async () => {
    // The callers of this helper `existsSync` the result (vision doctor install
    // roots): handing them the literal `~/vlm_ws/install` would report a built
    // workspace as missing.
    const { setupSourcePaths } = await import('../src/runner.js')
    const home = process.env.HOME
    process.env.HOME = '/home/dsh-setup-paths'
    process.env.DSH_SETUP_WS = '/opt/dsh-setup'
    try {
      const prefix = 'source ~/vlm_ws/install/setup.bash && source $DSH_SETUP_WS/install/setup.bash && '
      expect(setupSourcePaths(prefix)).toEqual([
        '/home/dsh-setup-paths/vlm_ws/install/setup.bash',
        '/opt/dsh-setup/install/setup.bash',
      ])
    } finally {
      if (home === undefined) delete process.env.HOME
      else process.env.HOME = home
      delete process.env.DSH_SETUP_WS
    }
  })
})
