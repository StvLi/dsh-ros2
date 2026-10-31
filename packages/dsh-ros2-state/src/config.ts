import z from '@deepseek-ai/schemastery'
import { defaultStateSocketPath } from 'dsh-ros2-common'

/**
 * The default is a PRIVATE coordinate, not a predictable one.
 *
 * Round 27 measured what the old default cost: `/tmp/dsh-ros2-sidecar.sock` is
 * a first-come address in a 1777 directory, so whoever binds it first IS the
 * data plane — and the client had no check at all, so the agent read
 * attacker-authored robot state. A path under `$XDG_RUNTIME_DIR` or
 * `~/.dsh-ros2/run` (both 0700) is one no other user can create first.
 *
 * An explicit `socketPath` is still honoured, but the criterion now lives in
 * `checkLocalSocketPeer` (ours · not a symlink · not group/other-writable ·
 * safe parent), so an existing `/tmp` deployment keeps working while its
 * identity is actually verified instead of assumed.
 */
const DEFAULT_SOCKET_PATH = defaultStateSocketPath()

/** dsh-ros2-state plugin configuration (cordis Config). */
export const Config = z.object({
  state: z.object({
    /** Sidecar UDS path, or a TCP `host:port` when `tcp` (loopback only; remote peers cannot be verified). */
    socketPath: z.string().default(DEFAULT_SOCKET_PATH),
    /** Default query timeout (ms). A cache read is ~instant; this guards the UDS round-trip. */
    timeoutMs: z.number().default(1000),
    /** Use TCP (loopback `host:port` / `port`) instead of a Unix socket. */
    tcp: z.boolean().default(false),
  }).default({ socketPath: DEFAULT_SOCKET_PATH, timeoutMs: 1000, tcp: false }),
})

export interface StateConfig {
  state: { socketPath: string; timeoutMs: number; tcp: boolean }
}
