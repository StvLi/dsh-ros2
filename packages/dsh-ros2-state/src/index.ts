/**
 * dsh-ros2-state — control-plane: connects to the dsh-ros2-sidecar data plane
 * over a long-lived UDS, exposing state_get / state_snapshot so the Agent
 * reads reduced/fresh robot state in milliseconds. Cordis bundle.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Config, type StateConfig } from './config.js'
import { readOwnVersion, registerLoadedBundle } from 'dsh-ros2-common'
import { createRos2StateTools } from './tools.js'
import { UdsStateClient } from './state-client.js'

export const name = 'dsh-ros2-state'

export const inject = ['tools', 'skills'] as const

export { Config }

export type { StateConfig }

/** The package.json this process actually loaded (issue #22: stale detection). */
const BUNDLE_INFO = readOwnVersion(import.meta.url)

export function apply(ctx: Context, config: StateConfig): void {
  ctx.effect(() => registerLoadedBundle({ name: 'dsh-ros2-state', ...BUNDLE_INFO }))
  ctx.logger.info(`dsh-ros2: loaded bundle dsh-ros2-state@${BUNDLE_INFO.version}`)

  const client = new UdsStateClient(config.state.socketPath, config.state.timeoutMs, config.state.tcp)
  const tools = createRos2StateTools({ state: client })

  ctx.effect(() => {
    const disposers = tools.map((tool) => ctx.tools.register(tool))
    return () => disposers.forEach((dispose) => dispose())
  })

  // Close the socket when the plugin is disposed.
  ctx.effect(() => () => client.close())
}
