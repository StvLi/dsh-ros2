/**
 * Round 29: the ingress closed point must cover `error`, not only `data`.
 *
 * Round 28 wired the policy into every *success* path (`okResult` and the
 * `ros2Tool` adapter) and wrote "一个闭点". The other half of the same door was
 * left open: `error.message` went to the model verbatim — up to `MAX_BUFFER`
 * (16 MiB) of a child process's stderr, with no character rule. Five read-only,
 * no-approval tools put raw `res.stderr`/`res.stdout` there (`robot_load`,
 * `robot_topology show`, `ros2_lifecycle get`, `ros2_component list`,
 * `ros2_daemon status`).
 *
 * These cases measure the payload the MODEL receives, through a tool built the
 * same way every bundle builds them, so they fail if the finalizer is unwired.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { INGRESS_STRING_BYTES } from '../src/ingress.js'
import {
  defineRos2Tool,
  finalizeToolResult,
  okResult,
  renderResult,
  resultSchema,
  toolError,
  type ToolResult,
} from '../src/toolkit.js'

const PACKAGES_DIR = fileURLToPath(new URL('../../', import.meta.url))

/** Build a real tool whose `execute` returns exactly what the case dictates. */
function probeTool(body: () => ToolResult) {
  const tool = defineRos2Tool({
    name: 'probe_ingress',
    description: 'probe: what does the model actually receive?',
    parameters: {},
    output: { schema: resultSchema, render: renderResult },
    async execute() {
      return body()
    },
  })
  return async (): Promise<ToolResult> => {
    const run = tool.execute as unknown as (a: unknown, e: unknown) => Promise<ToolResult>
    return run({}, {})
  }
}

describe('the closed point includes error.message', () => {
  it('bounds a 1 MiB stderr-shaped error and says the reading is short', async () => {
    // Shape measured from a real failing child: a Python traceback is what
    // stderr actually carried (1107 bytes for a bogus `ros2 lifecycle get`),
    // and a node that keeps writing can take it to MAX_BUFFER (16 MiB).
    const huge = `${'\x1b[31mRED\x1b[0m \u202eEVIL '.repeat(80000)}tail-marker`
    expect(Buffer.byteLength(huge, 'utf8')).toBeGreaterThan(1024 * 1024)

    const out = await probeTool(() => toolError('probe_ingress', 'probe', 'COMMAND_FAILED', huge))()

    const message = out.error?.message ?? ''
    expect(Buffer.byteLength(message, 'utf8')).toBeLessThan(INGRESS_STRING_BYTES + 128)
    // A shortened error must not read like a complete one.
    expect(out.warnings ?? []).toHaveLength(1)
    expect((out.warnings ?? [])[0]).toContain('ingress:')
    // The character rule applies to the error channel too — round 28's list.
    expect(message).not.toContain('\x1b')
    expect(message).not.toContain('\u202e')
  })

  it('leaves a small error untouched, with no warning', async () => {
    const out = await probeTool(() => toolError('probe_ingress', 'probe', 'MISSING_PARAM', 'name 必填'))()
    expect(out.error).toEqual({ code: 'MISSING_PARAM', message: 'name 必填' })
    expect(out.warnings).toBeUndefined()
  })

  it('bounds warnings added AFTER okResult (the withProfileWarnings shape)', async () => {
    // profile's `withProfileWarnings` appends to a result `okResult` already
    // returned, so bounding inside okResult alone never saw these bytes.
    const out = await probeTool(() => ({
      ...okResult('probe_ingress', 'probe', { ok: true }),
      warnings: ['\x07' + 'W'.repeat(512 * 1024)],
    }))()
    const warning = (out.warnings ?? []).join('\n')
    expect(Buffer.byteLength(warning, 'utf8')).toBeLessThan(INGRESS_STRING_BYTES + 512)
    expect(warning).not.toContain('\x07')
  })

  it('is idempotent: a result the policy already accepted keeps no extra warning', async () => {
    const clean = okResult('probe_ingress', 'probe', { state: 'NORMAL', joints: [1, 2, 3] })
    expect(finalizeToolResult(clean)).toEqual(clean)
  })
})

describe('every bundle builds its tools through defineRos2Tool', () => {
  it('no package imports defineTool from @deepseek-ai/dsh-tools directly', () => {
    const offenders: string[] = []
    for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'common') continue
      const file = path.join(PACKAGES_DIR, entry.name, 'src', 'tools.ts')
      if (!existsSync(file)) continue
      if (/\bdefineTool\b/.test(readFileSync(file, 'utf8'))) offenders.push(`${entry.name}/src/tools.ts`)
    }
    expect(offenders).toEqual([])
  })

  it('the wrapper is the one that defines it (removing it must break this file)', () => {
    const toolkit = readFileSync(path.join(PACKAGES_DIR, 'common', 'src', 'toolkit.ts'), 'utf8')
    expect(/\bdefineRos2Tool\b/.test(toolkit)).toBe(true)
    // The finalizer is called from the wrapper, not from each tool.
    expect(toolkit).toMatch(/execute: async \(args: unknown, exec: unknown\) =>\s*finalizeToolResult\(/)
  })
})
