/**
 * The criterion "is the process on the other end of this socket OURS?".
 *
 * Round 27 started from a measurement, not a theory (see
 * `packages/common/src/local-socket.ts`): the state client connected to
 * `/tmp/dsh-ros2-sidecar.sock` with no check at all, so a socket created by
 * anyone at that path was accepted as the robot's data plane, and a symlink
 * there was followed.
 *
 * These cases feed the same on-disk shapes the PoC used. Every one of them is
 * falsifiable: delete the corresponding branch in `checkLocalSocketPeer` and the
 * matching case fails (the assertion names the refusal code, not just "false").
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:net'
import { lstatSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { checkLocalSocketPeer, defaultStateSocketPath, parseTcpTarget } from '../src/local-socket.js'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()!
    try {
      await fn()
    } catch {
      /* the temp dirs go away with the process anyway */
    }
  }
})

async function privateDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-lsock-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** A real unix socket at `sockPath`, listening, with whatever umask produced it. */
async function listenAt(sockPath: string, umaskValue?: number): Promise<Server> {
  const server = createServer(() => undefined)
  const saved = umaskValue === undefined ? undefined : process.umask(umaskValue)
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(sockPath, () => resolve())
    })
  } finally {
    if (saved !== undefined) process.umask(saved)
  }
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return server
}

describe('checkLocalSocketPeer', () => {
  it('accepts our own socket in a private directory (the normal case)', async () => {
    const sock = path.join(await privateDir(), 'sidecar.sock')
    // The sidecar now binds under umask 0o077 (an unix socket's mode is
    // 0777 & ~umask, so an ambient umask 002 makes it group-writable).
    await listenAt(sock, 0o077)
    expect(checkLocalSocketPeer(sock)).toMatchObject({ ok: true })
  })

  it('refuses a missing path with PEER_ABSENT (sidecar not running)', async () => {
    const sock = path.join(await privateDir(), 'nobody.sock')
    expect(checkLocalSocketPeer(sock)).toMatchObject({ ok: false, code: 'PEER_ABSENT' })
  })

  it('refuses a symlink at the path instead of following it', async () => {
    const dir = await privateDir()
    const real = path.join(dir, 'real.sock')
    await listenAt(real, 0o077)
    const link = path.join(dir, 'link.sock')
    symlinkSync(real, link)
    // The PoC defect: the old client followed this link to a socket anywhere.
    expect(checkLocalSocketPeer(link)).toMatchObject({ ok: false, code: 'PEER_SYMLINK' })
  })

  it('refuses a path that is not a socket', async () => {
    const file = path.join(await privateDir(), 'plain.txt')
    writeFileSync(file, 'not a socket\n')
    expect(checkLocalSocketPeer(file)).toMatchObject({ ok: false, code: 'PEER_NOT_SOCKET' })
  })

  it('refuses a socket owned by another account (uid seam)', async () => {
    const sock = path.join(await privateDir(), 'theirs.sock')
    await listenAt(sock, 0o077)
    // A second account's uid stands in for "someone else bound it first", the
    // same seam runtime-dir.ts exposes to its own tests.
    expect(checkLocalSocketPeer(sock, { uid: process.getuid!() + 4242 })).toMatchObject({
      ok: false,
      code: 'PEER_NOT_OWNED',
    })
  })

  it('refuses a socket other local users may connect to', async () => {
    const sock = path.join(await privateDir(), 'wide.sock')
    // Produced through the umask, not a literal chmod: that is how the ambient
    // mode arises in the first place (round 26's fixture lesson).
    await listenAt(sock, 0o000)
    expect(lstatSync(sock).mode & 0o022).not.toBe(0)
    expect(checkLocalSocketPeer(sock)).toMatchObject({ ok: false, code: 'PEER_WORLD_WRITABLE' })
  })

  it('refuses a world-writable NON-sticky parent (the inode can be replaced)', async () => {
    const root = await privateDir()
    const shared = path.join(root, 'shared')
    const saved = process.umask(0o000)
    try {
      mkdirSync(shared, { recursive: true })
    } finally {
      process.umask(saved)
    }
    const sock = path.join(shared, 'sidecar.sock')
    // Tight socket, shared PARENT: only step 6 can catch this one.
    await listenAt(sock, 0o077)
    expect(checkLocalSocketPeer(sock)).toMatchObject({ ok: false, code: 'PEER_SHARED_PARENT' })
  })

  it('accepts an ours-and-not-writable socket in the STICKY temp root', async () => {
    // The compatibility promise: the old `/tmp` deployment keeps working, but
    // only because it passes the same identity test — not because it is assumed.
    const sock = path.join(os.tmpdir(), `dsh-lsock-sticky-${process.pid}.sock`)
    await listenAt(sock, 0o022)
    cleanups.push(() => rm(sock, { force: true }))
    expect(checkLocalSocketPeer(sock)).toMatchObject({ ok: true })
  })
})

describe('parseTcpTarget', () => {
  it('accepts a bare port as loopback (the shape the old code half-supported)', () => {
    expect(parseTcpTarget('9000')).toEqual({ ok: true, host: '127.0.0.1', port: 9000 })
  })

  it('accepts host:port on loopback', () => {
    expect(parseTcpTarget('127.0.0.1:9000')).toEqual({ ok: true, host: '127.0.0.1', port: 9000 })
    expect(parseTcpTarget('localhost:9000')).toEqual({ ok: true, host: 'localhost', port: 9000 })
    expect(parseTcpTarget('[::1]:9000')).toEqual({ ok: true, host: '::1', port: 9000 })
  })

  it('refuses a remote host: this protocol cannot verify a peer off-host', () => {
    expect(parseTcpTarget('10.0.0.5:9000')).toMatchObject({ ok: false, code: 'PEER_REMOTE_HOST' })
    expect(parseTcpTarget('0.0.0.0:9000')).toMatchObject({ ok: false, code: 'PEER_REMOTE_HOST' })
  })

  it('refuses the documented-but-broken case: `host:port` fed to Number()', () => {
    // The old code did `Number("127.0.0.1:9000")` -> NaN -> ERR_SOCKET_BAD_PORT.
    // The documented form must WORK now, and a genuinely bad port must be named.
    expect(parseTcpTarget('127.0.0.1:0')).toMatchObject({ ok: false, code: 'PEER_BAD_PORT' })
    expect(parseTcpTarget('127.0.0.1:not-a-port')).toMatchObject({ ok: false, code: 'PEER_BAD_TARGET' })
    expect(parseTcpTarget('')).toMatchObject({ ok: false, code: 'PEER_BAD_TARGET' })
  })
})

describe('defaultStateSocketPath', () => {
  it('is a private coordinate, not the old predictable /tmp path', () => {
    const original = process.env.XDG_RUNTIME_DIR
    delete process.env.XDG_RUNTIME_DIR
    try {
      const p = defaultStateSocketPath()
      expect(p.startsWith('/tmp/')).toBe(false)
      expect(path.basename(path.dirname(p))).toBe('run')
    } finally {
      if (original !== undefined) process.env.XDG_RUNTIME_DIR = original
    }
  })

  it('uses $XDG_RUNTIME_DIR when the session manager provides one (0700 by definition)', () => {
    const original = process.env.XDG_RUNTIME_DIR
    process.env.XDG_RUNTIME_DIR = '/run/user/1000'
    try {
      expect(defaultStateSocketPath()).toBe('/run/user/1000/dsh-ros2/sidecar.sock')
    } finally {
      if (original === undefined) delete process.env.XDG_RUNTIME_DIR
      else process.env.XDG_RUNTIME_DIR = original
    }
  })
})
