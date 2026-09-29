import { describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { expandShellWord, parseSourceWord, resolveSourcePath } from '../src/shellword.js'

describe('parseSourceWord', () => {
  it('reads a bare word and reports it as bare', () => {
    expect(parseSourceWord('source /ws/install/setup.bash')).toEqual({
      text: '/ws/install/setup.bash',
      quoting: 'bare',
    })
  })

  it('keeps a backslash-escaped space inside ONE bare word', () => {
    // The old character-class regex stopped at the space, truncating the path to
    // `/a\` — which then "did not exist", so the segment was dropped.
    expect(parseSourceWord('source /a\\ b/install/setup.bash')).toEqual({
      text: '/a\\ b/install/setup.bash',
      quoting: 'bare',
    })
  })

  it('de-quotes single- and double-quoted words and keeps the quoting kind', () => {
    expect(parseSourceWord("source '/a b/install/setup.bash'")).toEqual({
      text: '/a b/install/setup.bash',
      quoting: 'single',
    })
    expect(parseSourceWord('source "/a b/install/setup.bash"')).toEqual({
      text: '/a b/install/setup.bash',
      quoting: 'double',
    })
  })

  it('stops a bare word at the chain separator', () => {
    expect(parseSourceWord('source /ws/a && source /ws/b && ')).toEqual({
      text: '/ws/a',
      quoting: 'bare',
    })
  })

  it('returns undefined for a segment that carries no source', () => {
    expect(parseSourceWord('export ROS_DOMAIN_ID=1')).toBeUndefined()
    expect(parseSourceWord('')).toBeUndefined()
  })
})

describe('expandShellWord', () => {
  it('expands a leading ~ in a bare word (the README form)', () => {
    const home = process.env.HOME
    process.env.HOME = '/home/dsh-shellword-test'
    try {
      const resolved = expandShellWord({ text: '~/vlm_ws/install/setup.bash', quoting: 'bare' })
      expect(resolved.verified).toBe(true)
      expect(resolved.path).toBe(`${homedir()}/vlm_ws/install/setup.bash`)
      expect(resolved.path.startsWith('~')).toBe(false)
    } finally {
      if (home === undefined) delete process.env.HOME
      else process.env.HOME = home
    }
  })

  it('expands `~` alone to the home directory', () => {
    expect(expandShellWord({ text: '~', quoting: 'bare' }).path).toBe(homedir())
  })

  it('does NOT expand ~ inside double quotes (bash does not either)', () => {
    expect(expandShellWord({ text: '~/ws/setup.bash', quoting: 'double' })).toEqual({
      path: '~/ws/setup.bash',
      verified: true,
    })
  })

  it('does NOT expand a ~ at the start of a single-quoted word', () => {
    expect(expandShellWord({ text: '~/ws/setup.bash', quoting: 'single' }).path).toBe('~/ws/setup.bash')
  })

  it('expands $NAME and ${NAME}, bare and inside double quotes', () => {
    process.env.DSH_SHELLWORD_WS = '/opt/dsh-ws'
    try {
      expect(expandShellWord({ text: '$DSH_SHELLWORD_WS/install/setup.bash', quoting: 'bare' })).toEqual({
        path: '/opt/dsh-ws/install/setup.bash',
        verified: true,
      })
      expect(expandShellWord({ text: '${DSH_SHELLWORD_WS}/install/setup.bash', quoting: 'double' })).toEqual({
        path: '/opt/dsh-ws/install/setup.bash',
        verified: true,
      })
    } finally {
      delete process.env.DSH_SHELLWORD_WS
    }
  })

  it('expands nothing inside single quotes', () => {
    process.env.DSH_SHELLWORD_WS = '/opt/dsh-ws'
    try {
      expect(expandShellWord({ text: '$DSH_SHELLWORD_WS/x/setup.bash', quoting: 'single' })).toEqual({
        path: '$DSH_SHELLWORD_WS/x/setup.bash',
        verified: true,
      })
    } finally {
      delete process.env.DSH_SHELLWORD_WS
    }
  })

  it('honours an escaped dollar as a literal dollar', () => {
    process.env.DSH_SHELLWORD_WS = '/opt/dsh-ws'
    try {
      expect(expandShellWord({ text: '\\$DSH_SHELLWORD_WS/x', quoting: 'bare' })).toEqual({
        path: '$DSH_SHELLWORD_WS/x',
        verified: true,
      })
      expect(expandShellWord({ text: '\\$DSH_SHELLWORD_WS/x', quoting: 'double' })).toEqual({
        path: '$DSH_SHELLWORD_WS/x',
        verified: true,
      })
    } finally {
      delete process.env.DSH_SHELLWORD_WS
    }
  })

  it('reports an UNSET variable as unverifiable instead of guessing "missing"', () => {
    delete process.env.DSH_SHELLWORD_ABSENT
    const resolved = expandShellWord({ text: '$DSH_SHELLWORD_ABSENT/install/setup.bash', quoting: 'bare' })
    expect(resolved.verified).toBe(false)
  })

  it('reports ~user and command substitution as unverifiable', () => {
    expect(expandShellWord({ text: '~someone/ws/install/setup.bash', quoting: 'bare' }).verified).toBe(false)
    expect(expandShellWord({ text: '$(pwd)/install/setup.bash', quoting: 'bare' }).verified).toBe(false)
    expect(expandShellWord({ text: '$((1+1))/install/setup.bash', quoting: 'bare' }).verified).toBe(false)
  })
})

describe('resolveSourcePath', () => {
  it('parses and expands a segment in one step', () => {
    process.env.DSH_SHELLWORD_WS = '/opt/dsh-ws'
    try {
      expect(resolveSourcePath('source $DSH_SHELLWORD_WS/install/setup.bash && ')).toEqual({
        path: '/opt/dsh-ws/install/setup.bash',
        verified: true,
      })
    } finally {
      delete process.env.DSH_SHELLWORD_WS
    }
  })

  it('returns undefined for a segment without a source', () => {
    expect(resolveSourcePath('export FOO=1')).toBeUndefined()
  })
})
