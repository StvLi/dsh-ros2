import { describe, expect, it } from 'vitest'
import {
  foldGraph,
  parseJsonOrRaw,
  parseLines,
  parseNodeInfo,
  parseTopicList,
  parseTransforms,
} from '../src/parse.js'

describe('parseLines', () => {
  it('splits and trims non-empty lines', () => {
    expect(parseLines('  a\n\nb \n')).toEqual(['a', 'b'])
  })
})

describe('parseTopicList', () => {
  it('parses names with types', () => {
    const out = parseTopicList('/a [std_msgs/msg/String]\n/b\n')
    expect(out).toEqual([
      { name: '/a', type: 'std_msgs/msg/String' },
      { name: '/b' },
    ])
  })
})

describe('parseNodeInfo', () => {
  const fixture = [
    '/controller_manager',
    '  Subscribers:',
    '    /parameter_events: rcl_interfaces/msg/ParameterEvent',
    '  Publishers:',
    '    /joint_states: sensor_msgs/msg/JointState',
    '    /rosout: rcl_interfaces/msg/Log',
    '  Service Servers:',
    '    /controller_manager/change_controller_state: controller_manager_msgs/srv/ChangeControllerState',
    '  Service Clients:',
    '    /parameter_events: rcl_interfaces/srv/DescribeParameters',
    '  Action Servers:',
    '    /controller_manager/list_controllers: controller_manager_msgs/action/ListControllers',
    '  Action Clients:',
    '',
  ].join('\n')

  it('parses sections into structured info', () => {
    const info = parseNodeInfo(fixture, '/controller_manager')
    expect(info.node).toBe('/controller_manager')
    expect(info.subscribers).toEqual([{ name: '/parameter_events', type: 'rcl_interfaces/msg/ParameterEvent' }])
    expect(info.publishers).toEqual([
      { name: '/joint_states', type: 'sensor_msgs/msg/JointState' },
      { name: '/rosout', type: 'rcl_interfaces/msg/Log' },
    ])
    expect(info.serviceServers).toHaveLength(1)
    expect(info.actionServers).toHaveLength(1)
    expect(info.actionClients).toEqual([])
  })
})

describe('foldGraph', () => {
  it('folds node info into a graph with unique topics', () => {
    const a = parseNodeInfo('/a\n  Publishers:\n    /t1: std_msgs/msg/String\n', '/a')
    const b = parseNodeInfo('/b\n  Subscribers:\n    /t1: std_msgs/msg/String\n', '/b')
    const graph = foldGraph([a, b])
    expect(graph.nodes).toHaveLength(2)
    expect(graph.nodes[0]?.publishers).toEqual(['/t1'])
    expect(graph.nodes[1]?.subscribers).toEqual(['/t1'])
    expect(graph.topics).toEqual(['/t1'])
  })
})

describe('parseJsonOrRaw', () => {
  it('parses JSON', () => {
    expect(parseJsonOrRaw('{"a": 1}')).toEqual({ a: 1 })
  })
  it('falls back to raw text', () => {
    const out = parseJsonOrRaw('not json')
    expect(out).toEqual({ raw: 'not json' })
  })
  it('keeps a parsed JSON null instead of treating it as a failure', () => {
    expect(parseJsonOrRaw('null')).toBeNull()
  })

  // FastDDS writes shared-memory transport errors to *stdout*; without this the
  // whole buffer failed to parse and every helper-backed tool silently returned
  // `{ raw }` (observed as `nodes: 0` from ros2_topology).
  it('parses the JSON document when the middleware printed log lines before it', () => {
    const noisy = '2026-09-14 20:57:55.234 [RTPS_TRANSPORT_SHM Error] Failed to create segment: Permission denied\n' +
      '  -> Function compute_per_allocation_extra_size\n' +
      '{"ok": true, "nodes": [{"name": "/talker"}]}\n'
    expect(parseJsonOrRaw(noisy)).toEqual({ ok: true, nodes: [{ name: '/talker' }] })
  })

  it('parses the JSON document when log lines follow it', () => {
    const noisy = '{"ok": true}\n' +
      '2026-09-14 20:57:55.234 [RTPS_TRANSPORT_SHM Error] something went wrong\n'
    expect(parseJsonOrRaw(noisy)).toEqual({ ok: true })
  })

  it('still falls back to raw for text with no JSON value at all', () => {
    const out = parseJsonOrRaw('header:\n  stamp: 1\n[RTPS Error] noise without a document')
    expect(out).toEqual({ raw: 'header:\n  stamp: 1\n[RTPS Error] noise without a document' })
  })
})

describe('parseTransforms', () => {
  it('extracts unique frame pairs', () => {
    const value = [
      { header: { frame_id: 'map' }, child_frame_id: 'odom' },
      { header: { frame_id: 'odom' }, child_frame_id: 'base_link' },
      { header: { frame_id: 'map' }, child_frame_id: 'odom' },
    ]
    expect(parseTransforms(value)).toEqual([
      { parent: 'map', child: 'odom' },
      { parent: 'odom', child: 'base_link' },
    ])
  })
})
