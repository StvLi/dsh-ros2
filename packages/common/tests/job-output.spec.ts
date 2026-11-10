/**
 * Round 30: the jobs channel is an entry surface too.
 *
 * Every tool result passes the ingress policy (the tool factory finalizes it).
 * Background job output does not: `spawnJob()` hands `readOutput()` to the
 * harness jobs registry, which shows it to the model directly, so the policy
 * never saw those bytes. Measured on this host before the fix — a background job
 * printing ESC and U+202E delivered both **raw** into the conversation (~70 KiB
 * of it), with no warning: the harness's own spill limit bounded the size, but
 * nothing looked at the characters.
 *
 * These cases pin the two properties that matter: the refused characters never
 * come back, and a cleaned reading says it was cleaned (a shortened/edited log
 * must not read like the original).
 */
import { describe, expect, it } from 'vitest'
import { spawnJob, type JobHooks } from '../src/runner.js'

/** Run a one-shot job to completion and return its output as the model would see it. */
async function capture(command: string): Promise<string> {
  const job: JobHooks = spawnJob('bash', ['-c', command])
  await job.done
  return job.readOutput?.() ?? ''
}

describe('job output passes the character rule before it reaches the model', () => {
  it('strips ESC and direction-override characters and says so', async () => {
    const output = await capture(`printf '\\033[31mRED\\033[0m \\342\\200\\256EVIL\\n'`)

    expect(output).not.toContain('\x1b')
    expect(output).not.toContain('\u202e')
    // The remaining text is intact — the policy removes characters, not lines.
    expect(output).toContain('RED')
    expect(output).toContain('EVIL')
    // An edited reading must not look like the original.
    expect(output).toContain('ingress:')
    expect(output).toContain('方向覆盖字符')
  })

  it('strips invisible carriers too — a tag character hides text, not bytes', async () => {
    // U+E0049 (TAG LATIN CAPITAL LETTER I): UTF-8 f3 a0 80 89, renders as nothing.
    const output = await capture(`printf 'visible\\363\\240\\200\\211 text\\n'`)

    expect(output).not.toContain('\u{E0049}')
    expect(output).toContain('visible')
    expect(output).toContain('不可见字符')
  })

  it('leaves clean output alone, with no marker', async () => {
    const output = await capture(`printf 'all good\\nsecond line\\n'`)
    expect(output).toContain('all good')
    expect(output).toContain('second line')
    expect(output).toContain('[stdout]')
    expect(output).toContain('[stderr]')
    expect(output).not.toContain('ingress:')
  })

  it('keeps the split between stdout and stderr', async () => {
    const output = await capture(`printf 'out\\n'; printf 'err\\n' >&2`)
    expect(output).toContain('[stdout]')
    expect(output).toContain('[stderr]')
    expect(output).toContain('out')
    expect(output).toContain('err')
  })
})
