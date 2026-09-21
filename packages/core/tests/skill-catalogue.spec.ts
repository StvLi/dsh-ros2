import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { makeSkillCatalogueProbe } from '../src/index.js'

/**
 * The probe is the one place where the harness's live skill catalogue is turned
 * into plain data for `ros2_env_check` (issue #22, item 2). Its whole job is to
 * be honest about what the harness actually offers: an older harness has no
 * `snapshot()`, and that must yield `undefined` — which the tool reports as
 * "reconciliation unavailable" — rather than an empty catalogue, which would
 * read as "every registered skill is missing".
 */
function ctxWith(service: unknown): Context {
  return { get: (name: string) => (name === 'skills' ? service : undefined) } as unknown as Context
}

function probeOf(service: unknown) {
  const probe = makeSkillCatalogueProbe(ctxWith(service))
  if (probe === undefined) throw new Error('expected a probe')
  return probe
}

describe('makeSkillCatalogueProbe', () => {
  it('is absent when the harness provides no skills service', () => {
    expect(makeSkillCatalogueProbe(ctxWith(undefined))).toBeUndefined()
  })

  it('is absent when the service exposes no snapshot (older harness)', () => {
    // The rc.6-era stub shape: `register` only, no catalogue read.
    expect(makeSkillCatalogueProbe(ctxWith({ register: () => () => {} }))).toBeUndefined()
  })

  it('copies only the name and the completeness flag, dropping malformed entries', async () => {
    const probe = probeOf({
      snapshot: async () => ({
        skills: [{ name: 'ros2-diagnostics' }, { name: 42 }, {}, { name: 'robot-motion-control' }],
        complete: true,
      }),
    })
    await expect(probe({})).resolves.toEqual({
      skills: [{ name: 'ros2-diagnostics' }, { name: 'robot-motion-control' }],
      complete: true,
    })
  })

  it('passes the caller scope through and treats a missing flag as incomplete', async () => {
    const seen: unknown[] = []
    const scope = { agent: 'a' }
    const probe = probeOf({
      snapshot: async (options: { scope?: object }) => {
        seen.push(options.scope)
        return { skills: [] }
      },
    })
    // No `complete` on the wire means "cannot confirm": the tool must not warn.
    await expect(probe({ scope })).resolves.toEqual({ skills: [], complete: false })
    expect(seen).toEqual([scope])
  })
})
