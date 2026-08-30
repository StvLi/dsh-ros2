import { describe, expect, it } from 'vitest'
import { Config, name } from '../src/index.js'

describe('dsh-ros2 aggregate bundle', () => {
  it('exposes the bundle name', () => {
    expect(name).toBe('dsh-ros2')
  })

  it('exposes a Config schema', () => {
    expect(Config).toBeDefined()
    expect(typeof Config).toBe('function') // schemastery z.object
  })
})
