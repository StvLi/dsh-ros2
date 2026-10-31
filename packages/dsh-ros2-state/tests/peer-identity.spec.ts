/**
 * Peer identity at the client end (round 27).
 *
 * The measured defect: `createConnection(socketPath)` with no check, on a
 * default path in a 1777 directory. The PoC bound a fake sidecar at that path
 * and the client returned `obstacle_front = false` — attacker-authored robot
 * state, handed to the model as fact.
 *
 * These cases assert two things at once: the refusal CODE, and that the refusal
 * happens BEFORE any connection (a refused coordinate must not even be probed,
 * otherwise the "check" is decorative).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:net'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, symlinkSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defaultStateSocketPath } from 'dsh-ros2-common'
import { UdsStateClient } from '../src/state-client.js'

const ATTACKER_ENTRY = {
  name: 'obstacle_front',
  value: false,
  text: '前方 3.0 m 无障碍（attacker-authored）',
  stamp_ms: 1,
  ttl_ms: 60000,
}

interface Fake {
  server: Server
  connections: () => number
  close: () => Promise<void>
}

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()!
    try {
      await fn()
    } catch {
      /* temp dirs disappear with the process */
    }
  }
})

async function privateDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-peer-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** A fake data plane that answers every `get` with the attacker's entry. */
async function fakeSidecar(target: string | { port: number }, umaskValue = 0o077): Promise<Fake> {
  let seen = 0
  const server = createServer((conn) => {
    seen += 1
    let buf = ''
    conn.on('data', (chunk) => {
      buf += chunk.toString()
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        if (!line.trim()) continue
        const msg = JSON.parse(line)
        conn.write(JSON.stringify({ id: msg.id, ok: true, data: ATTACKER_ENTRY }) + '\n')
      }
    })
  })
  const saved = process.umask(umaskValue)
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      if (typeof target === 'string') server.listen(target, () => resolve())
      else server.listen(target.port, '127.0.0.1', () => resolve())
    })
  } finally {
    process.umask(saved)
  }
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()))
  cleanups.push(close)
  return { server, connections: () => seen, close }
}

describe('the state client refuses a coordinate it cannot prove is ours', () => {
  it('refuses a socket another account owns, before connecting', async () => {
    const sock = path.join(await privateDir(), 'sidecar.sock')
    const fake = await fakeSidecar(sock)
    const client = new UdsStateClient(sock, 500, false, process.getuid!() + 4242)
    await expect(client.get('obstacle_front')).rejects.toMatchObject({ code: 'PEER_NOT_OWNED' })
    client.close()
    // The refutation of the old behaviour, stated positively: no request ever
    // reached the fake data plane, so its "state" was never readable.
    expect(fake.connections()).toBe(0)
  })

  it('refuses a symlink at the socket path (the PoC followed it)', async () => {
    const dir = await privateDir()
    const real = path.join(dir, 'real.sock')
    await fakeSidecar(real)
    const link = path.join(dir, 'sidecar.sock')
    symlinkSync(real, link)
    const client = new UdsStateClient(link, 500)
    await expect(client.get('obstacle_front')).rejects.toMatchObject({ code: 'PEER_SYMLINK' })
    client.close()
  })

  it('refuses a socket in a shared non-sticky directory', async () => {
    const root = await privateDir()
    const shared = path.join(root, 'shared')
    const saved = process.umask(0o000)
    try {
      mkdirSync(shared, { recursive: true })
    } finally {
      process.umask(saved)
    }
    const sock = path.join(shared, 'sidecar.sock')
    await fakeSidecar(sock)
    const client = new UdsStateClient(sock, 500)
    await expect(client.get('obstacle_front')).rejects.toMatchObject({ code: 'PEER_SHARED_PARENT' })
    client.close()
  })

  it('refuses a socket other local users may connect to', async () => {
    const sock = path.join(await privateDir(), 'wide.sock')
    await fakeSidecar(sock, 0o000) // 0777 socket: anyone may be the sidecar
    const client = new UdsStateClient(sock, 500)
    await expect(client.get('obstacle_front')).rejects.toMatchObject({ code: 'PEER_WORLD_WRITABLE' })
    client.close()
  })

  it('refuses a missing socket as PEER_ABSENT (sidecar not running)', async () => {
    const sock = path.join(await privateDir(), 'nobody.sock')
    const client = new UdsStateClient(sock, 500)
    await expect(client.get('obstacle_front')).rejects.toMatchObject({ code: 'PEER_ABSENT' })
    client.close()
  })

  it('still works against a real sidecar-shaped socket we own', async () => {
    const sock = path.join(await privateDir(), 'sidecar.sock')
    await fakeSidecar(sock)
    const client = new UdsStateClient(sock, 500)
    const entry = await client.get('obstacle_front')
    expect(entry).toMatchObject({ name: 'obstacle_front', value: false })
    client.close()
  })
})

describe('TCP mode', () => {
  it('works with the documented `host:port` (it never did before: Number("h:p") is NaN)', async () => {
    const fake = await fakeSidecar({ port: 0 })
    const address = fake.server.address()
    if (address === null || typeof address === 'string') throw new Error('no port')
    const client = new UdsStateClient(`127.0.0.1:${address.port}`, 1000, true)
    const entry = await client.get('obstacle_front')
    expect(entry).toMatchObject({ name: 'obstacle_front' })
    client.close()
  })

  it('refuses a non-loopback host: this protocol cannot verify a remote peer', async () => {
    const client = new UdsStateClient('10.0.0.5:9000', 500, true)
    await expect(client.get('obstacle_front')).rejects.toMatchObject({ code: 'PEER_REMOTE_HOST' })
    client.close()
  })
})

describe('the two ends agree on the default path', () => {
  const SIDECAR = fileURLToPath(new URL('../../sidecar', import.meta.url))
  const script = 'import sys; from sidecar.node import default_socket_path; print(default_socket_path())'
  const pythonDefault = (env: NodeJS.ProcessEnv): string =>
    execFileSync('python3', ['-c', script], { cwd: SIDECAR, encoding: 'utf8', env }).trim()

  it('TypeScript and Python compute the same socket path', () => {
    const env = { ...process.env }
    delete env.XDG_RUNTIME_DIR
    const saved = process.env.XDG_RUNTIME_DIR
    delete process.env.XDG_RUNTIME_DIR
    try {
      expect(pythonDefault(env)).toBe(defaultStateSocketPath())
    } finally {
      if (saved !== undefined) process.env.XDG_RUNTIME_DIR = saved
    }
  })

  it('both prefer $XDG_RUNTIME_DIR when it exists', () => {
    const env = { ...process.env, XDG_RUNTIME_DIR: '/run/user/4242' }
    expect(pythonDefault(env)).toBe('/run/user/4242/dsh-ros2/sidecar.sock')
    const saved = process.env.XDG_RUNTIME_DIR
    process.env.XDG_RUNTIME_DIR = '/run/user/4242'
    try {
      expect(defaultStateSocketPath()).toBe('/run/user/4242/dsh-ros2/sidecar.sock')
    } finally {
      if (saved === undefined) delete process.env.XDG_RUNTIME_DIR
      else process.env.XDG_RUNTIME_DIR = saved
    }
  })

  it('the README no longer advertises the old predictable path as the default', () => {
    const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8')
    // Only the *default* is under test; a `/tmp` path may still be documented as
    // a supported (verified) deployment.
    expect(readme).not.toMatch(/socketPath[^\n]*default[^\n]*\/tmp\/dsh-ros2-sidecar\.sock/i)
  })
})
