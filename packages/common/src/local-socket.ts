/**
 * Local IPC peer identity — is the process on the other end of this path OURS?
 *
 * Every socket this plugin opens is a *channel to a data plane the agent then
 * trusts*: `dsh-ros2-state` reads reduced robot state (is there an obstacle, is
 * the battery ok, is the robot locked) from `dsh-ros2-sidecar` over a Unix
 * domain socket and hands it to the model as fact.
 *
 * Until round 27 that channel was `createConnection(socketPath)` and nothing
 * else, with a DEFAULT path in a 1777 directory (`/tmp/dsh-ros2-sidecar.sock`).
 * Measured before the fix: any local user who bound that path first became the
 * data plane — the client connected and returned attacker-authored robot state
 * (`obstacle_front = false`), and a symlink planted at the path was followed to
 * a socket anywhere on disk. A unix socket can be connect()ed by anyone who has
 * write permission on the inode, and this protocol has no authentication, so
 * "whoever owns the inode" is the whole of the identity check that is possible
 * without SO_PEERCRED (which Node does not expose).
 *
 * The criterion, therefore, is the ownership of the coordinate itself, checked
 * immediately before `connect`:
 *
 *   1. absent              -> refuse (PEER_ABSENT): nothing to prove, and the
 *                             caller reports "sidecar not running" honestly.
 *   2. symlink             -> refuse (PEER_SYMLINK): the link sits in a shared
 *                             directory and can be swapped; judge the inode.
 *   3. not a socket        -> refuse (PEER_NOT_SOCKET).
 *   4. owned by someone else -> refuse (PEER_NOT_OWNED).
 *   5. group/other WRITABLE  -> refuse (PEER_WORLD_WRITABLE): connect() needs
 *                             write permission, so those bits are exactly the
 *                             "anyone may be the sidecar" grant.
 *   6. parent group/other-writable and NOT sticky -> refuse
 *                             (PEER_SHARED_PARENT): anyone could unlink our
 *                             inode and bind their own between check and
 *                             connect. A sticky parent (the temp root, 1777)
 *                             keeps that window shut, which is why a `/tmp`
 *                             socket still works when it is ours and 0600.
 *
 * The residual race is documented, not hidden: steps 2–6 run just before
 * `connect`, and the only way another user can displace the inode inside that
 * window is to be able to unlink it — which is what step 6 removes.
 *
 * TCP mode has the same problem in a different shape: a socket protocol with no
 * authentication cannot bound the peer by host, so only a LOOPBACK target is
 * accepted (PEER_REMOTE_HOST otherwise). Round 27 also measured that the
 * documented `"host:port"` form never worked at all
 * (`Number("127.0.0.1:9000")` is NaN -> ERR_SOCKET_BAD_PORT), so the parsing
 * lives here and is tested.
 */
import { lstatSync } from 'node:fs'
import path from 'node:path'

export interface SocketPeerOptions {
  /** Owning uid the socket must have; defaults to this process (test seam). */
  uid?: number
}

export type SocketPeerResult =
  | { ok: true; path: string }
  | { ok: false; code: string; reason: string }

export type TcpTargetResult =
  | { ok: true; host: string; port: number }
  | { ok: false; code: string; reason: string }

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])

/** Extract a Node errno without widening to `any`. */
function errnoOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
}

/** `0o022` is the group/other WRITE mask; `0o1000` is the sticky bit. */
const OTHERS_WRITE = 0o022
const STICKY = 0o1000

/**
 * Prove the socket at `sockPath` belongs to this user before connecting to it.
 *
 * Synchronous on purpose: the checks and `createConnection` must not be
 * separated by an `await`, because that is exactly the window an attacker
 * needs. Nothing here creates or repairs anything — a coordinate we do not own
 * is a refusal, never something this plugin patches up.
 */
export function checkLocalSocketPeer(sockPath: string, opts: SocketPeerOptions = {}): SocketPeerResult {
  const target = path.resolve(sockPath)
  const uid = opts.uid ?? (typeof process.getuid === 'function' ? process.getuid() : undefined)
  const refuse = (code: string, why: string): SocketPeerResult => ({
    ok: false,
    code,
    reason: `refusing to connect to the sidecar socket ${target}: ${why}`,
  })
  if (uid === undefined) return refuse('PEER_NO_UID', 'cannot verify ownership on this platform')

  let info
  try {
    info = lstatSync(target)
  } catch (error) {
    if (errnoOf(error) === 'ENOENT') {
      return refuse('PEER_ABSENT', 'it does not exist (is the sidecar running, and is socketPath right?)')
    }
    return refuse('PEER_UNREADABLE', `lstat failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  // `lstat`, never `stat`: a link is judged as a link instead of as whatever it
  // points at, and this call is the LAST thing before `createConnection`.
  if (info.isSymbolicLink()) return refuse('PEER_SYMLINK', 'it is a symlink (point socketPath at the real socket)')
  if (!info.isSocket()) return refuse('PEER_NOT_SOCKET', 'it is not a unix socket')
  if (info.uid !== uid) return refuse('PEER_NOT_OWNED', `it is owned by uid ${info.uid}, not you (uid ${uid})`)
  if ((info.mode & OTHERS_WRITE) !== 0) {
    return refuse(
      'PEER_WORLD_WRITABLE',
      `its mode is ${(info.mode & 0o777).toString(8).padStart(3, '0')}; group/other write lets anyone on this host be the sidecar`,
    )
  }

  const parent = path.dirname(target)
  let parentInfo
  try {
    parentInfo = lstatSync(parent)
  } catch (error) {
    return refuse('PEER_UNREADABLE', `cannot stat the parent ${parent}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (parentInfo.isSymbolicLink()) return refuse('PEER_SYMLINK', `its directory ${parent} is a symlink`)
  if (!parentInfo.isDirectory()) return refuse('PEER_BAD_PARENT', `its directory ${parent} is not a directory`)
  if ((parentInfo.mode & OTHERS_WRITE) !== 0 && (parentInfo.mode & STICKY) === 0) {
    return refuse(
      'PEER_SHARED_PARENT',
      `its directory ${parent} is group/other-writable and not sticky, so another user could replace the socket`,
    )
  }

  return { ok: true, path: target }
}

/**
 * Parse a TCP target for the sidecar.
 *
 * Accepts `"9000"` (loopback port, the form the old code half-supported) and
 * `"127.0.0.1:9000"` / `"[::1]:9000"` (the form config.ts documents). Anything
 * that is not loopback is refused: this protocol has no authentication, so a
 * remote peer can be neither verified nor distinguished from an impostor.
 */
export function parseTcpTarget(spec: string): TcpTargetResult {
  const refuse = (code: string, why: string): TcpTargetResult => ({
    ok: false,
    code,
    reason: `refusing the sidecar TCP target ${JSON.stringify(spec)}: ${why}`,
  })
  const text = spec.trim()
  if (text.length === 0) return refuse('PEER_BAD_TARGET', 'it is empty')

  let host = '127.0.0.1'
  let portText = text
  const bracketed = /^\[(.+)\]:(\d+)$/.exec(text)
  if (bracketed) {
    host = String(bracketed[1] ?? '')
    portText = String(bracketed[2] ?? '')
  } else if (text.includes(':')) {
    const idx = text.lastIndexOf(':')
    host = text.slice(0, idx)
    portText = text.slice(idx + 1)
  }
  if (!/^\d+$/.test(portText)) {
    return refuse('PEER_BAD_TARGET', `"${portText}" is not a port number (expected "port" or "host:port")`)
  }
  const port = Number(portText)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return refuse('PEER_BAD_PORT', `port ${portText} is outside 1..65535`)
  }
  if (!LOOPBACK.has(host)) {
    return refuse('PEER_REMOTE_HOST', `host "${host}" is not loopback; this protocol cannot verify a remote peer`)
  }
  return { ok: true, host, port }
}

/**
 * The default sidecar socket: a PRIVATE directory this user owns.
 *
 * `$XDG_RUNTIME_DIR` is 0700 by definition when the session manager sets it;
 * otherwise the plugin writes under its own 0700 home directory. The previous
 * default (`/tmp/dsh-ros2-sidecar.sock`) is still *accepted* when it passes
 * `checkLocalSocketPeer` (ours, 0600, sticky parent), but it is no longer what
 * this project chooses: a predictable name in a shared directory is a
 * first-come-first-served identity.
 *
 * `packages/sidecar/sidecar/node.py` computes the same path; a test
 * (`peer-identity.spec.ts`) spawns the Python side and compares, so the two
 * cannot drift.
 */
export function defaultStateSocketPath(): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR
  if (runtimeDir && runtimeDir.length > 0) return path.join(runtimeDir, 'dsh-ros2', 'sidecar.sock')
  const home = process.env.HOME ?? ''
  return path.join(home, '.dsh-ros2', 'run', 'sidecar.sock')
}
