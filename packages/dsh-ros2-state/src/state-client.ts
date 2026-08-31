/**
 * dsh-ros2-state — control-plane StateClient.
 *
 * A long-lived Unix Domain Socket connection (newline-delimited JSON) to the
 * dsh-ros2-sidecar data plane. Reads reduced, fresh robot state in
 * milliseconds (logic-direct / physically-separated): the sidecar continuously
 * reduces high-frequency topics into a semantic cache; this client queries
 * that cache — no ROS2 subprocess per read.
 *
 * Protocol (mirrors sidecar/server.py):
 *   send  { "id", "cmd": "get|snapshot|subscribe", "name"? }
 *   recv  { "id", "ok", "data"? } | { "id", "ok":false, "error": { "code", "message", "data"? } }
 *         { "type":"heartbeat" } | { "type":"event", "name", ... }
 */
import { createConnection, type Socket } from 'node:net'

export interface CacheEntry {
  name: string
  value: unknown
  text: string
  stamp_ms: number
  ttl_ms: number
}

export class StateClientError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'StateClientError'
  }
}

export interface StateClient {
  get(name: string, opts?: { timeoutMs?: number }): Promise<CacheEntry>
  snapshot(opts?: { timeoutMs?: number }): Promise<CacheEntry[]>
  subscribe(name: string, cb: (entry: CacheEntry) => void): { dispose(): void }
  close(): void
}

interface Pending {
  resolve: (v: CacheEntry | CacheEntry[]) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

export class UdsStateClient implements StateClient {
  private sock: Socket | null = null
  private buf = ''
  private nextId = 1
  private pending = new Map<string, Pending>()
  private subs = new Map<string, (entry: CacheEntry) => void>()

  constructor(private socketPath: string, private defaultTimeoutMs = 1000, private tcp?: boolean) {}

  private ensure(): Socket {
    if (this.sock) return this.sock
    const sock = this.tcp
      ? createConnection({ host: '127.0.0.1', port: Number(this.socketPath) })
      : createConnection(this.socketPath)
    this.sock = sock
    sock.setEncoding('utf8')
    sock.on('data', (chunk) => this.onData(String(chunk)))
    sock.on('error', () => this.rejectAll(new StateClientError('DOWN', 'sidecar 连接断开')))
    sock.on('close', () => this.rejectAll(new StateClientError('DOWN', 'sidecar 连接关闭')))
    return sock
  }

  private onData(chunk: string) {
    this.buf += chunk
    let idx: number
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim()
      this.buf = this.buf.slice(idx + 1)
      if (!line) continue
      this.handleFrame(line)
    }
  }

  private handleFrame(line: string) {
    let msg: any
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.type === 'heartbeat') return
    if (msg.type === 'event') {
      const cb = this.subs.get(String(msg.name))
      if (cb && msg.data) cb(msg.data as CacheEntry)
      return
    }
    const id = String(msg.id ?? '')
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    clearTimeout(p.timer)
    if (msg.ok) {
      p.resolve(msg.data)
    } else {
      p.reject(new StateClientError(String(msg.error?.code ?? 'ERROR'), String(msg.error?.message ?? 'sidecar 调用失败')))
    }
  }

  private rejectAll(err: Error) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }

  private request<T>(cmd: string, extra: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const id = `r${this.nextId++}`
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new StateClientError('TIMEOUT', `sidecar ${cmd} 超时`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      try {
        this.ensure().write(JSON.stringify({ id, cmd, ...extra }) + '\n')
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  async get(name: string, opts: { timeoutMs?: number } = {}): Promise<CacheEntry> {
    const r = await this.request<CacheEntry>('get', { name }, opts.timeoutMs ?? this.defaultTimeoutMs)
    return r
  }

  async snapshot(opts: { timeoutMs?: number } = {}): Promise<CacheEntry[]> {
    const r = await this.request<{ summary: CacheEntry[] }>('snapshot', {}, opts.timeoutMs ?? this.defaultTimeoutMs)
    return r.summary ?? []
  }

  subscribe(name: string, cb: (entry: CacheEntry) => void): { dispose(): void } {
    this.subs.set(name, cb)
    this.request('subscribe', { name }, this.defaultTimeoutMs).catch(() => undefined)
    return { dispose: () => this.subs.delete(name) }
  }

  close() {
    this.rejectAll(new StateClientError('DOWN', 'client closed'))
    this.sock?.destroy()
    this.sock = null
  }
}
