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
