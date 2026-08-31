import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server, type Socket } from 'node:net'
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StateClientError, UdsStateClient } from '../src/state-client.js'

// Fake UDS server mirroring the sidecar protocol (newline-JSON).
let sock: string
let server: Server
let conns: Socket[] = []
let handler: (msg: any) => any = () => ({ ok: false, error: { code: 'BOO', message: 'no handler' } })

beforeEach(async () => {
  handler = () => ({ ok: false, error: { code: 'BOO', message: 'no handler' } })
  sock = path.join(mkdtempSync(path.join(os.tmpdir(), 'dsh-state-')), 's.sock')
  server = createServer((c) => {
    conns.push(c)
    let buf = ''
    c.on('data', (chunk) => {
      buf += chunk.toString()
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        try {
          const msg = JSON.parse(line)
          const resp = handler(msg)
          c.write(JSON.stringify(resp) + '\n')
        } catch (e) {
          c.write(JSON.stringify({ id: null, ok: false, error: { code: 'BAD_REQUEST', message: String(e) } }) + '\n')
        }
      }
    })
  })
  await new Promise<void>((res) => server.listen(sock, res))
})
afterEach(async () => {
  await new Promise<void>((res) => server.close(() => res()))
  conns.forEach((c) => c.destroy())
  conns = []
  rmSync(path.dirname(sock), { recursive: true, force: true })
})

it('get returns a fresh CacheEntry', async () => {
  handler = (m) => ({ id: m.id, ok: true, data: { name: 'obstacle_front', value: true, text: '前方0.5m障碍物', stamp_ms: 1, ttl_ms: 150 } })
  const client = new UdsStateClient(sock, 1000)
  const e = await client.get('obstacle_front')
  expect(e).toMatchObject({ name: 'obstacle_front', value: true })
  expect(e.text).toContain('障碍物')
  client.close()
})

it('maps error codes (STALE / DOWN / UNKNOWN)', async () => {
  handler = (m) => (m.cmd === 'get' ? { id: m.id, ok: false, error: { code: 'STALE', message: 'x stale' } } : { id: m.id, ok: true, data: { summary: [] } })
  const client = new UdsStateClient(sock, 1000)
  await expect(client.get('t')).rejects.toMatchObject({ code: 'STALE' })
  client.close()
})

it('snapshot returns the summary list', async () => {
  handler = (m) => ({ id: m.id, ok: true, data: { summary: [{ name: 'a', value: 1, text: 'A', stamp_ms: 1, ttl_ms: 100 }, { name: 'b', value: 2, text: 'B', stamp_ms: 2, ttl_ms: 100 }] } })
  const client = new UdsStateClient(sock, 1000)
  const list = await client.snapshot()
  expect(list).toHaveLength(2)
  client.close()
})

it('times out a hung request', async () => {
  handler = () => ({ ok: false, error: { code: 'NONE' } }) // never returns a matching id
  const client = new UdsStateClient(sock, 100)
  await expect(client.get('t')).rejects.toMatchObject({ code: 'TIMEOUT' })
  client.close()
})
