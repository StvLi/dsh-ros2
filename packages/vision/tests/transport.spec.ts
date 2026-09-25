import { describe, expect, it } from 'vitest'
import { classifyVisionTransport } from '../src/transport.js'

/**
 * The VLM API key rides on every request, so whether the gateway hop is
 * encrypted decides whether the key stays private. These cases pin the rule:
 * `http://` to a NON-loopback host is cleartext; a local model server on
 * `http://127.0.0.1:…` is not a finding and must stay quiet.
 */
describe('classifyVisionTransport', () => {
  it('flags http:// to a non-loopback host as cleartext', () => {
    const t = classifyVisionTransport('http://121.9.219.138:8888/v1')
    expect(t.scheme).toBe('http')
    expect(t.host).toBe('121.9.219.138')
    expect(t.loopback).toBe(false)
    expect(t.cleartext).toBe(true)
  })

  it('flags a named http host too', () => {
    const t = classifyVisionTransport('http://gateway.example.com/v1')
    expect(t.host).toBe('gateway.example.com')
    expect(t.cleartext).toBe(true)
  })

  it('does not flag https', () => {
    const t = classifyVisionTransport('https://api.openai.com/v1')
    expect(t.scheme).toBe('https')
    expect(t.cleartext).toBe(false)
  })

  it('does not flag loopback http — a local model server is the normal shape', () => {
    for (const url of [
      'http://127.0.0.1:8000/v1',
      'http://127.0.0.53:8000/v1',
      'http://localhost:11434/v1',
      'http://[::1]:8080/v1',
    ]) {
      const t = classifyVisionTransport(url)
      expect(t.loopback, url).toBe(true)
      expect(t.cleartext, url).toBe(false)
    }
  })

  it('treats the whole 127.0.0.0/8 block as loopback, not just 127.0.0.1', () => {
    expect(classifyVisionTransport('http://127.9.9.9:1/v1').loopback).toBe(true)
    // …but a similar-looking non-loopback address is still cleartext.
    expect(classifyVisionTransport('http://128.0.0.1:1/v1').cleartext).toBe(true)
  })

  it('never throws on unset or malformed config (the doctor must not fail on bad config)', () => {
    for (const value of ['', '   ', undefined, null, 'not a url', '://missing-scheme']) {
      const t = classifyVisionTransport(value as string)
      expect(t.scheme).toBe('')
      expect(t.cleartext).toBe(false)
    }
  })

  it('errs toward flagging when an http URL is unusual', () => {
    // `new URL('http:///v1')` normalises the empty authority away and yields
    // host "v1" (measured, not assumed) — still http, still non-loopback, so it
    // is reported rather than silently passed.
    const t = classifyVisionTransport('http:///v1')
    expect(t.scheme).toBe('http')
    expect(t.host).toBe('v1')
    expect(t.cleartext).toBe(true)
  })
})
