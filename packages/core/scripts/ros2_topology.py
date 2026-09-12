#!/usr/bin/env python3
"""One-process ROS2 topology snapshot.

Why this exists: every `ros2 <verb>` invocation starts a fresh Python process
and re-discovers the graph, so answering "what does this system look like?"
through the CLI costs N+1 process spawns and N+1 agent round-trips. This helper
does the whole survey in a single rclpy process (graph API + one TF listen) and
prints one JSON document, so a complex topology costs the agent one call.

Usage:
    ros2_topology.py [--tf] [--tf-timeout S] [--params] [--params-limit N] [--discovery S]

Output: a single JSON object on stdout; diagnostics go to stderr.
"""
from __future__ import annotations

import argparse
import json
import sys
import time

ACTION_SUFFIXES = ('/_action/send_goal', '/_action/cancel_goal', '/_action/get_result')
ACTION_MSG_SUFFIXES = ('_SendGoal', '_GetResult', '_FeedbackMessage')

#: The probe node's own name — excluded so the report matches `ros2 node list`
#: (which, being a separate process, never lists the survey tool itself).
SELF_NODE_NAME = '/dsh_ros2_topology'


def is_hidden(name: str) -> bool:
    """Match the `ros2` CLI's hidden-name rule: any segment starting with `_`.

    The CLI omits `/_ros2cli_daemon_*`, `/fibonacci/_action/…` and friends from
    its default listings, so the snapshot does too — otherwise the report is
    noisier than `ros2 node list` and the extra names look like real nodes.
    """
    return any(segment.startswith('_') for segment in name.strip('/').split('/') if segment)


def _now_ms() -> int:
    return int(time.time() * 1000)


def derive_actions(services: list[dict], topics: list[dict]) -> list[dict]:
    """Derive action servers from the hidden `_action/*` services and topics.

    rclpy exposes the hidden entries (once discovery settles) but has no action
    API, so the action name and type are reconstructed from the send_goal
    service type: `pkg/action/Fibonacci_SendGoal` -> `pkg/action/Fibonacci`.
    """
    found: dict[str, dict] = {}
    for entry in services:
        name = entry['name']
        for suffix in ACTION_SUFFIXES:
            if not name.endswith(suffix):
                continue
            action = name[: -len(suffix)]
            types = entry.get('types') or []
            declared = [t for t in types if '/action/' in t]
            if not declared:
                continue
            action_type = declared[0]
            for tail in ACTION_MSG_SUFFIXES:
                if action_type.endswith(tail):
                    action_type = action_type[: -len(tail)]
                    break
            record = found.setdefault(action, {'name': action, 'types': [], 'topics': []})
            if action_type not in record['types']:
                record['types'].append(action_type)
    for entry in topics:
        name = entry['name']
        if '/_action/' not in name:
            continue
        action = name.split('/_action/')[0]
        if action in found:
            found[action]['topics'].append(name)
    return [found[k] for k in sorted(found)]


def build_snapshot(node, want_tf: bool, want_params: bool, params_limit: int, include_hidden: bool = False) -> dict:
    """Collect the whole topology from an already-discovered node."""
    topics: list[dict] = []
    for name, types in sorted(node.get_topic_names_and_types()):
        topics.append({
            'name': name,
            'types': sorted(types),
            'publishers': node.count_publishers(name),
            'subscribers': node.count_subscribers(name),
        })

    services: list[dict] = []
    for name, types in sorted(node.get_service_names_and_types()):
        services.append({'name': name, 'types': sorted(types)})

    nodes: list[dict] = []
    for name, namespace in sorted(node.get_node_names_and_namespaces()):
        full = f'{namespace.rstrip("/")}{name}' if namespace not in ('', '/') else f'/{name}'
        try:
            pubs = node.get_publisher_names_and_types_by_node(name, namespace)
            subs = node.get_subscriber_names_and_types_by_node(name, namespace)
            srvs = node.get_service_names_and_types_by_node(name, namespace)
        except Exception:  # node vanished mid-scan
            pubs, subs, srvs = [], [], []
        nodes.append({
            'name': full,
            'publishers': sorted(f'{t}: {",".join(sorted(ty))}' for t, ty in pubs),
            'subscribers': sorted(f'{t}: {",".join(sorted(ty))}' for t, ty in subs),
            'services': sorted(f'{s}: {",".join(sorted(ty))}' for s, ty in srvs),
        })

    # Actions are derived before filtering: their plumbing lives under the
    # hidden `_action/` namespace that the default report drops.
    actions = derive_actions(services, topics)

    hidden_names = {
        'nodes': [n['name'] for n in nodes if is_hidden(n['name']) or n['name'] == SELF_NODE_NAME],
        'topics': [t['name'] for t in topics if is_hidden(t['name'])],
        'services': [s['name'] for s in services if is_hidden(s['name'])],
    }
    if not include_hidden:
        nodes = [n for n in nodes if not is_hidden(n['name']) and n['name'] != SELF_NODE_NAME]
        topics = [t for t in topics if not is_hidden(t['name'])]
        services = [s for s in services if not is_hidden(s['name'])]
        for entry in actions:
            entry['topics'] = [t for t in entry.get('topics', []) if not is_hidden(t)]

    # Attach each action to the node serving it (mirrors `ros2 node info`).
    for entry in actions:
        entry['served_by'] = [
            node_entry['name']
            for node_entry in nodes
            if any(
                line.split(':')[0] == f"{entry['name']}/_action/send_goal"
                for line in node_entry['services']
            )
        ]

    snapshot: dict = {
        'ok': True,
        'nodes': nodes,
        'topics': topics,
        'services': services,
        'actions': actions,
    }
    if not include_hidden:
        snapshot['hidden'] = {k: v for k, v in hidden_names.items() if v}
    if want_tf:
        snapshot['tf'] = collect_tf(node)
    if want_params:
        snapshot['parameters'] = collect_parameters(node, nodes, params_limit)
    return snapshot


def collect_tf(node) -> dict:
    frames = getattr(node, '_tf_frames', {})
    ordered = [frames[k] for k in sorted(frames)]
    return {
        'frames': ordered,
        'count': len(ordered),
        'dynamic': sum(1 for f in ordered if not f['static']),
        'static': sum(1 for f in ordered if f['static']),
    }


def collect_parameters(node, nodes: list[dict], limit: int) -> dict:
    from rcl_interfaces.srv import GetParameters, ListParameters

    out: dict[str, dict] = {}
    for entry in nodes[:limit]:
        full = entry['name']
        namespace, _, name = full.rpartition('/')
        namespace = namespace or '/'
        try:
            lister = node.create_client(ListParameters, f'{full}/list_parameters')
            if not lister.wait_for_service(timeout_sec=0.4):
                continue
            future = lister.call_async(ListParameters.Request())
            _spin_until(node, future, 1.0)
            names = list(future.result().result.names) if future.result() else []
            if not names:
                continue
            getter = node.create_client(GetParameters, f'{full}/get_parameters')
            if not getter.wait_for_service(timeout_sec=0.4):
                continue
            request = GetParameters.Request()
            request.names = names
            future = getter.call_async(request)
            _spin_until(node, future, 1.0)
            if not future.result():
                continue
            values = {}
            for pname, value in zip(names, future.result().values):
                values[pname] = _param_value(value)
            out[full] = values
        except Exception:  # never let one node break the snapshot
            continue
    return out


def _param_value(value) -> object:
    from rcl_interfaces.msg import ParameterType

    kind = value.type
    if kind == ParameterType.PARAMETER_BOOL:
        return bool(value.bool_value)
    if kind == ParameterType.PARAMETER_INTEGER:
        return int(value.integer_value)
    if kind == ParameterType.PARAMETER_DOUBLE:
        return float(value.double_value)
    if kind == ParameterType.PARAMETER_STRING:
        return value.string_value
    if kind == ParameterType.PARAMETER_BOOL_ARRAY:
        return list(value.bool_array_value)
    if kind == ParameterType.PARAMETER_INTEGER_ARRAY:
        return list(value.integer_array_value)
    if kind == ParameterType.PARAMETER_DOUBLE_ARRAY:
        return list(value.double_array_value)
    if kind == ParameterType.PARAMETER_STRING_ARRAY:
        return list(value.string_array_value)
    return None


def _spin_until(node, future, timeout: float) -> None:
    import rclpy

    deadline = time.time() + timeout
    while not future.done() and time.time() < deadline:
        rclpy.spin_once(node, timeout_sec=0.05)


def selftest() -> int:
    """Pure-logic checks that need no ROS graph (run by the TS test suite)."""
    checks = 0

    def check(label: str, condition: bool) -> None:
        nonlocal checks
        checks += 1
        if not condition:
            raise AssertionError(label)

    check('root name not hidden', not is_hidden('/talker'))
    check('nested name not hidden', not is_hidden('/turtle1/cmd_vel'))
    check('parameter_events not hidden', not is_hidden('/parameter_events'))
    check('daemon node hidden', is_hidden('/_ros2cli_daemon_0_abc'))
    check('action plumbing hidden', is_hidden('/fibonacci/_action/send_goal'))

    services = [
        {'name': '/fibonacci/_action/send_goal', 'types': ['action_tutorials_interfaces/action/Fibonacci_SendGoal']},
        {'name': '/fibonacci/_action/cancel_goal', 'types': ['action_msgs/srv/CancelGoal']},
        {'name': '/fibonacci/_action/get_result', 'types': ['action_tutorials_interfaces/action/Fibonacci_GetResult']},
        {'name': '/spawn', 'types': ['turtlesim/srv/Spawn']},
    ]
    topics = [{'name': '/fibonacci/_action/feedback'}, {'name': '/chatter'}]
    actions = derive_actions(services, topics)
    check('one action derived', len(actions) == 1)
    check('action name', actions[0]['name'] == '/fibonacci')
    check('action type de-suffixed', actions[0]['types'] == ['action_tutorials_interfaces/action/Fibonacci'])
    check('action topics attached', actions[0]['topics'] == ['/fibonacci/_action/feedback'])

    check('non-action services ignored', derive_actions([{'name': '/spawn', 'types': ['turtlesim/srv/Spawn']}], []) == [])

    print(f'SELFTEST OK ({checks} checks)')
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--tf', action='store_true', help='include TF frames')
    parser.add_argument('--tf-timeout', type=float, default=3.0)
    parser.add_argument('--params', action='store_true')
    parser.add_argument('--params-limit', type=int, default=8)
    parser.add_argument('--include-hidden', action='store_true', help='also list hidden nodes/topics/services')
    parser.add_argument('--selftest', action='store_true', help='run pure-logic checks and exit')
    parser.add_argument('--discovery', type=float, default=1.5, help='seconds to let discovery settle')
    args = parser.parse_args()

    if args.selftest:
        return selftest()

    import rclpy
    from rclpy.node import Node
    from rclpy.qos import DurabilityPolicy, HistoryPolicy, QoSProfile, ReliabilityPolicy
    from tf2_msgs.msg import TFMessage

    rclpy.init(args=None)
    node = Node('dsh_ros2_topology')
    frames: dict = {}
    node._tf_frames = frames

    def record(msg, is_static: bool) -> None:
        for transform in msg.transforms:
            key = (transform.header.frame_id, transform.child_frame_id)
            frames[key] = {
                'parent': transform.header.frame_id,
                'child': transform.child_frame_id,
                'static': is_static,
                'translation': {
                    'x': transform.transform.translation.x,
                    'y': transform.transform.translation.y,
                    'z': transform.transform.translation.z,
                },
                'rotation': {
                    'x': transform.transform.rotation.x,
                    'y': transform.transform.rotation.y,
                    'z': transform.transform.rotation.z,
                    'w': transform.transform.rotation.w,
                },
            }

    if args.tf:
        static_qos = QoSProfile(
            depth=200,
            history=HistoryPolicy.KEEP_LAST,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
        )
        node.create_subscription(TFMessage, '/tf_static', lambda m: record(m, True), static_qos)
        node.create_subscription(TFMessage, '/tf', lambda m: record(m, False), 200)

    started = _now_ms()
    # Let discovery settle (and pick up latched /tf_static) before sampling.
    deadline = time.time() + max(args.discovery, args.tf_timeout if args.tf else 0.0)
    while time.time() < deadline:
        rclpy.spin_once(node, timeout_sec=0.1)

    snapshot = build_snapshot(node, args.tf, args.params, args.params_limit, args.include_hidden)
    snapshot['counts'] = {
        'nodes': len(snapshot['nodes']),
        'topics': len(snapshot['topics']),
        'services': len(snapshot['services']),
        'actions': len(snapshot['actions']),
        'tf_frames': snapshot.get('tf', {}).get('count', 0),
    }
    snapshot['elapsed_ms'] = _now_ms() - started

    json.dump(snapshot, sys.stdout, ensure_ascii=False)
    sys.stdout.write('\n')
    node.destroy_node()
    rclpy.shutdown()
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:  # keep stdout JSON-only
        message = f'{type(exc).__name__}: {exc}'
        if 'rclpy' in message:
            message += (
                ' — this helper needs a sourced ROS2 environment; run it through the'
                ' dsh-ros2 tools (which source rosSetup for you) or prefix the call with'
                " `source /opt/ros/<distro>/setup.bash && `."
            )
        json.dump({'ok': False, 'error': message}, sys.stdout)
        sys.stdout.write('\n')
        raise SystemExit(1)
