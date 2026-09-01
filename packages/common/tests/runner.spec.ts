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
})
