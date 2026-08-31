/**
 * dsh-ros2-state tools — read reduced, fresh robot state from the sidecar
 * data plane (no ROS2 subprocess per read). Read-only (L1-style).
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { type ToolResult, okResult, toolError, renderResult, resultSchema, type JsonValue } from 'dsh-ros2-common'
import type { StateClient } from './state-client.js'

export type StateDeps = { state?: StateClient }

function noState(tool: string, command: string): ToolResult {
  return toolError(tool, command, 'STATE_UNAVAILABLE',
    'sidecar 未连接（dsh-ros2-state 未配置 socketPath，或 sidecar 未运行）——请启动 dsh_ros2_sidecar 或配置 state.socketPath')
}

export function createRos2StateTools(deps: StateDeps) {
  return [
    defineTool({
      name: 'state_get',
      description:
        'Read one reduced/fresh robot state entry from the sidecar data plane (milliseconds, no ROS2 subprocess): e.g. obstacle_front, cup_pose, safety_lock. Returns {value, text, stamp_ms, ttl_ms} — value for logic, text for the LLM. STALE (=cache not refreshed in time) and DOWN (sidecar offline) are structured errors; safety-relevant reads should fail closed.',
      parameters: {
        name: { type: 'string', description: 'Reducer name registered in the sidecar (e.g. "obstacle_front").' },
        timeoutMs: { type: 'number', default: 1000, description: 'Query timeout in ms (cache read is ~instant; this guards the UDS round-trip).' },
      },
      output: { schema: resultSchema, render: renderResult },
      async execute(args) {
        const params = args as Record<string, unknown>
        const name = String(params.name ?? '')
        const command = `state_get name=${name}`
        if (!deps.state) return noState('state_get', command)
        try {
          const entry = await deps.state.get(name, { timeoutMs: Number(params.timeoutMs ?? 1000) })
          return okResult('state_get', command, entry as unknown as JsonValue)
        } catch (e) {
          const code = (e as { code?: string })?.code ?? 'STATE_ERROR'
          return toolError('state_get', command, code, e instanceof Error ? e.message : String(e))
        }
      },
    }),
    defineTool({
      name: 'state_snapshot',
      description:
        'Read ALL reduced states as one semantic summary (one call instead of many state_get): the agent sees "how the world is now" from the sidecar cache. Read-only, milliseconds.',
      parameters: {
        timeoutMs: { type: 'number', default: 1000, description: 'Query timeout in ms.' },
      },
      output: { schema: resultSchema, render: renderResult },
      async execute(args) {
        const params = args as Record<string, unknown>
        const command = 'state_snapshot'
        if (!deps.state) return noState('state_snapshot', command)
        try {
          const entries = await deps.state.snapshot({ timeoutMs: Number(params.timeoutMs ?? 1000) })
          return okResult('state_snapshot', command, { count: entries.length, entries: entries as unknown as JsonValue[] })
        } catch (e) {
          const code = (e as { code?: string })?.code ?? 'STATE_ERROR'
          return toolError('state_snapshot', command, code, e instanceof Error ? e.message : String(e))
        }
      },
    }),
  ]
}
