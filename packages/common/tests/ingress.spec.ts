/**
 * Round 28: the ingress policy (size budget + character class) on tool results.
 *
 * Every case here is a MEASURED shape from the round-28 sweep, not a
 * hypothetical: the 4 MiB figure is what one topic field actually delivered
 * into `result.data` before the policy existed, and the character list is what
 * survived into the model's context verbatim.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  INGRESS_ARRAY_ITEMS,
  INGRESS_STRING_BYTES,
  INGRESS_TOTAL_BYTES,
  applyIngress,
  boundToolData,
  capUtf8,
  ingressWarning,
  isDroppedChar,
  sanitizeText,
} from '../src/ingress.js'
import { okResult, tail } from '../src/toolkit.js'
import type { JsonValue } from '../src/parse.js'

const bytes = (v: unknown): number => Buffer.byteLength(JSON.stringify(v ?? null), 'utf8')

describe('ingress: a bounded reading, never a silently shortened one', () => {
  it('forwards a small payload untouched, with no warning', () => {
    const data = { state: 'NORMAL', joints: [1, 2, 3], ok: true, note: null }
    const out = applyIngress(data)
    expect(out.value).toEqual(data)
    expect(out.warning).toBeUndefined()
  })

  it('caps ONE 4 MiB field — the round-28 measurement — and says so', () => {
    const big = 'A'.repeat(4 * 1024 * 1024)
    const out = applyIngress({ data: big })
    const text = (out.value as { data: string }).data
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(INGRESS_STRING_BYTES + 64)
    expect(text.endsWith(`[…truncated ${4 * 1024 * 1024} bytes]`)).toBe(true)
    expect(out.warning).toContain('截断 1 处')
    // The warning is quantitative: it names the bytes that were removed, so a
    // reader can tell how much of the reading is missing.
    expect(out.warning).toContain(String(4 * 1024 * 1024 - INGRESS_STRING_BYTES))
  })

  it('caps the whole document, not only each field (many medium fields)', () => {
    const field = 'B'.repeat(8 * 1024)
    const doc: Record<string, JsonValue> = {}
    for (let i = 0; i < 200; i++) doc[`f${i}`] = field
    const out = applyIngress(doc)
    expect(bytes(out.value)).toBeLessThan(INGRESS_TOTAL_BYTES + 8 * 1024)
    expect(out.warning).toContain('截断')
  })

  it('keeps every numeric/boolean field exactly as computed while capping text', () => {
    const out = applyIngress({ x: 1.25, y: -3e-7, ok: false, flag: true, n: null, text: 'C'.repeat(20 * 1024) })
    const v = out.value as Record<string, JsonValue>
    expect(v.x).toBe(1.25)
    expect(v.y).toBe(-3e-7)
    expect(v.ok).toBe(false)
    expect(v.flag).toBe(true)
    expect(v.n).toBeNull()
    expect(typeof v.text).toBe('string')
  })

  it('caps arrays by item count and marks the cut', () => {
    const out = applyIngress(Array.from({ length: INGRESS_ARRAY_ITEMS + 50 }, (_, i) => i))
    const arr = out.value as JsonValue[]
    expect(arr.length).toBe(INGRESS_ARRAY_ITEMS + 1)
    expect(String(arr[arr.length - 1])).toContain('truncated 50 bytes')
  })

  it('bounds a hostile KEY as well — the bytes can be in the key', () => {
    const key = 'K'.repeat(200 * 1024)
    const out = applyIngress({ [key]: 1 })
    const keys = Object.keys(out.value as Record<string, JsonValue>)
    expect(Buffer.byteLength(keys[0]!, 'utf8')).toBeLessThan(INGRESS_STRING_BYTES + 64)
  })

  it('never splits a code point when a cap lands inside one', () => {
    // 3-byte characters: a naive byte slice would emit a replacement char.
    const text = '\u4e2d'.repeat(4000) // 12000 bytes
    const capped = capUtf8(text, 4096)
    expect(Buffer.byteLength(capped.text, 'utf8')).toBeLessThanOrEqual(4096)
    expect(capped.text).not.toContain('\ufffd')
    expect(capped.original).toBe(12000)
  })
})

describe('ingress: character class', () => {
  it('drops C0/DEL/C1 and keeps tab + newline as structure', () => {
    const text = 'a\tb\nc\x1b[2Kd\x07e\x00f\x7fg\u009bh'
    const report = {
      dropped: 0, droppedBidi: 0, truncated: 0, droppedBytes: 0, budgetHit: false,
    }
    expect(sanitizeText(text, report)).toBe('a\tb\nc[2Kdefgh')
    expect(report.dropped).toBe(5) // ESC, BEL, NUL, DEL, C1-CSI
  })

  it('drops the bidi overrides (Trojan-Source class) and counts them separately', () => {
    const text = 'invoice\u202Egnp.exe'
    const out = applyIngress({ name: text })
    expect((out.value as { name: string }).name).toBe('invoicegnp.exe')
    expect(out.warning).toContain('方向覆盖')
  })

  it('is a rule about code points, not about ASCII', () => {
    expect(isDroppedChar('\u001b')).toBe(true)
    expect(isDroppedChar('\u0000')).toBe(true)
    expect(isDroppedChar('\u0085')).toBe(true) // NEL, a C1
    expect(isDroppedChar('\u202e')).toBe(true)
    expect(isDroppedChar('\t')).toBe(false)
    expect(isDroppedChar('\n')).toBe(false)
    expect(isDroppedChar('中')).toBe(false)
  })
})

describe('ingress: one chokepoint', () => {
  it('okResult applies the policy to every caller', () => {
    const r = okResult('t', 'cmd', { data: 'D'.repeat(64 * 1024) })
    expect(r.ok).toBe(true)
    expect(bytes(r.data)).toBeLessThan(INGRESS_STRING_BYTES + 128)
    expect(r.warnings?.some((w) => w.startsWith('ingress:'))).toBe(true)
  })

  it('okResult keeps its old shape when the payload is small', () => {
    const r = okResult('t', 'cmd', { a: 1 })
    expect(r).toEqual({ ok: true, tool: 't', command: 'cmd', data: { a: 1 } })
  })

  it('stderr warnings answer to the same character rule', () => {
    const lines = tail('ok\n\x1b[31mfailed\x1b[0m\n')
    expect(lines.join('|')).not.toContain('\u001b')
    expect(lines.join('|')).toContain('[31mfailed[0m')
  })

  it('the policy is wired into the result builder, not left importable-but-unused', () => {
    // Static assertion: the round-27 lesson is that a gate nobody calls looks
    // exactly like a gate that works. Deleting the call turns this red.
    const src = readFileSync(fileURLToPath(new URL('../src/toolkit.ts', import.meta.url)), 'utf8')
    expect(src).toContain('applyIngress(data)')
    expect(src).toContain('boundToolData(l).value')
    // and the tool adapter must not build its own unbounded success result
    expect(src).not.toContain('const value: ToolResult = { ok: true, tool: spec.name, command, data')
  })

  it('reports nothing when nothing was removed or capped', () => {
    const { report } = boundToolData({ a: 'plain' })
    expect(ingressWarning(report)).toBeUndefined()
  })
})
