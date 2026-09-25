/**
 * Transport security of the configured VLM gateway.
 *
 * Every provider in this package puts the API key on the wire:
 *   - `OpenAiVisionProvider` sends `Authorization: Bearer <key>`;
 *   - the Gemini provider puts it in the `?key=` query string.
 * Both are only as private as the hop they travel over. A `https://` base URL
 * encrypts that hop; a plain `http://` base URL to a NON-loopback host hands the
 * key to anything on the path (switch, proxy, ISP, or anyone on the same LAN).
 *
 * A loopback `http://` gateway is deliberately NOT flagged: the traffic never
 * leaves the machine, which is the normal shape of a locally-run model server
 * (vLLM / Ollama / llama.cpp). Flagging that would train the reader to ignore
 * the warning that matters.
 */

export interface VisionTransport {
  /** Lower-cased URL scheme ('http', 'https', …); '' when unset/unparseable. */
  scheme: string
  /** Lower-cased hostname; '' when unset/unparseable. */
  host: string
  /** Whether the host is loopback, so a cleartext hop cannot leave the machine. */
  loopback: boolean
  /**
   * Whether the API key would cross the network in the clear: an `http://`
   * base URL whose host is not loopback.
   */
  cleartext: boolean
}

const CLEAR: VisionTransport = { scheme: '', host: '', loopback: false, cleartext: false }

/** Loopback hostnames that a URL parser may hand back verbatim. */
function isLoopbackHost(host: string): boolean {
  if (host === '') return false
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  // `URL.hostname` keeps IPv6 literals bracketed (`[::1]`).
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (bare === '::1') return true
  // 127.0.0.0/8 — the whole block is loopback, not just 127.0.0.1.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare)
}

/**
 * Classify the transport of a configured base URL. Pure and total: an empty or
 * malformed URL yields the permissive-but-honest "no scheme, no risk" shape
 * rather than throwing, because the doctor must never fail on bad config.
 */
export function classifyVisionTransport(baseUrl: string | undefined | null): VisionTransport {
  const raw = (baseUrl ?? '').trim()
  if (raw === '') return { ...CLEAR }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ...CLEAR }
  }
  const scheme = url.protocol.replace(/:$/, '').toLowerCase()
  const host = url.hostname.toLowerCase()
  const loopback = isLoopbackHost(host)
  return { scheme, host, loopback, cleartext: scheme === 'http' && !loopback }
}
