import z from '@deepseek-ai/schemastery'

/** dsh-ros2-state plugin configuration (cordis Config). */
export const Config = z.object({
  state: z.object({
    /** Path to the sidecar Unix Domain Socket (or a TCP host:port string when `tcp`). */
    socketPath: z.string().default('/tmp/dsh-ros2-sidecar.sock'),
    /** Default query timeout (ms). A cache read is ~instant; this guards the UDS round-trip. */
    timeoutMs: z.number().default(1000),
    /** Use TCP (host:port) instead of a Unix socket. */
    tcp: z.boolean().default(false),
  }).default({ socketPath: '/tmp/dsh-ros2-sidecar.sock', timeoutMs: 1000, tcp: false }),
})

export interface StateConfig {
  state: { socketPath: string; timeoutMs: number; tcp: boolean }
}
