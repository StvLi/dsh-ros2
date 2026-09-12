#!/usr/bin/env python3
"""One-process ROS2 topology snapshot.

Why this exists: every `ros2 <verb>` invocation starts a fresh Python process
and re-discovers the graph, so answering "what does this system look like?"
through the CLI costs N+1 process spawns and N+1 agent round-trips. This helper
does the whole survey in a single rclpy process — graph API plus one listen
window that covers TF and topic liveness — and prints one JSON document, so a
complex topology costs the agent one call.

Usage:
    ros2_topology.py [--tf] [--tf-timeout S] [--rates] [--rates-window S]
                     [--params] [--params-limit N] [--node a,b] [--include-hidden]
                     [--discovery S] [--selftest]

Output: a single JSON object on stdout; diagnostics go to stderr.
"""
from __future__ import annotations

import argparse
import importlib
import json
import sys
import time

ACTION_SUFFIXES = ('/_action/send_goal', '/_action/cancel_goal', '/_action/get_result')
ACTION_MSG_SUFFIXES = ('_SendGoal', '_GetResult', '_FeedbackMessage')

#: The probe node's own name — excluded so the report matches `ros2 node list`
#: (which, being a separate process, never lists the survey tool itself).
SELF_NODE_NAME = '/dsh_ros2_topology'


def _now_ms() -> int:
    return int(time.time() * 1000)


def is_hidden(name: str) -> bool:
    """Match the `ros2` CLI's hidden-name rule: any segment starting with `_`.

    The CLI omits `/_ros2cli_daemon_*`, `/fibonacci/_action/…` and friends from
    its default listings, so the snapshot does too — otherwise the report is
    noisier than `ros2 node list` and the extra names look like real nodes.
    """
    return any(segment.startswith('_') for segment in name.strip('/').split('/') if segment)


def normalise(name: str) -> str:
    return name.strip().lstrip('/')


def resolve_msg_type(type_str: str):
    """`std_msgs/msg/String` -> the Python message class, or None if unknown."""
    package, _, kind = type_str.partition('/msg/')
    if not kind:
        return None
    try:
        module = importlib.import_module(f'{package}.msg')
        return getattr(module, kind)
    except Exception:
        return None


def message_to_dict(msg) -> dict:
    """A ROS message as plain JSON data, with a repr fallback."""
    try:
        from rosidl_runtime_py.convert import message_to_ordereddict

        return dict(message_to_ordereddict(msg))
    except Exception:
        return {'repr': str(msg)[:2000]}


def sample_callback(record: dict):
    """Count messages, keeping the first and the most recent sample."""

    def callback(msg) -> None:
        record['count'] += 1
        if record['first'] is None:
            record['first'] = message_to_dict(msg)
        record['last'] = message_to_dict(msg)

    return callback


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


def build_snapshot(
    node,
    want_tf: bool,
    want_params: bool,
    params_limit: int,
    include_hidden: bool = False,
    want_rates: bool = False,
    want_samples: bool = False,
    only_nodes: tuple[str, ...] = (),
) -> dict:
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

    not_found: list[str] = []
    if only_nodes:
        wanted = {normalise(n) for n in only_nodes if n.strip()}
        nodes = [n for n in nodes if normalise(n['name']) in wanted]
        not_found = sorted(wanted - {normalise(n['name']) for n in nodes})

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
    if only_nodes:
        actions = [a for a in actions if a['served_by']]

    snapshot: dict = {
        'ok': True,
        'nodes': nodes,
        'topics': topics,
        'services': services,
        'actions': actions,
    }
    if not_found:
        snapshot['not_found'] = not_found
    if not include_hidden:
        snapshot['hidden'] = {k: v for k, v in hidden_names.items() if v}
    if want_rates:
        snapshot['rates'] = getattr(node, '_rates', {})
    if want_samples:
        snapshot['samples'] = getattr(node, '_samples', {})
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
    check('normalise strips slash', normalise('/talker') == 'talker')

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
    parser.add_argument('--rates', action='store_true', help='measure publish rates for live topics')
    parser.add_argument('--rates-window', type=float, default=3.0)
    parser.add_argument('--rate-topics-limit', type=int, default=40)
    parser.add_argument('--sample', default='', help='comma-separated topics to sample (message + rate together)')
    parser.add_argument('--sample-window', type=float, default=4.0)
    parser.add_argument('--params', action='store_true')
    parser.add_argument('--params-limit', type=int, default=8)
    parser.add_argument('--node', default='', help='comma-separated node names to report (default: all)')
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
    node._rates = {}
    node._samples = {}

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

    started = _now_ms()

    # 1) let discovery settle (this also collects the latched /tf_static)
    settle = time.time() + max(args.discovery, 0.5)
    while time.time() < settle:
        rclpy.spin_once(node, timeout_sec=0.1)

    if args.tf:
        static_qos = QoSProfile(
            depth=200,
            history=HistoryPolicy.KEEP_LAST,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
        )
        node.create_subscription(TFMessage, '/tf_static', lambda m: record(m, True), static_qos)
        node.create_subscription(TFMessage, '/tf', lambda m: record(m, False), 200)

    # 2) liveness comes from the same process and the same wait: subscribe to
    #    the topics that actually have publishers, then count during the window.
    counts: dict[str, int] = {}
    if args.rates:
        candidates = [
            (name, types)
            for name, types in node.get_topic_names_and_types()
            if node.count_publishers(name) > 0 and types and not is_hidden(name)
        ][: args.rate_topics_limit]
        for name, types in candidates:
            message_type = resolve_msg_type(types[0])
            if message_type is None:
                continue
            counts[name] = 0
            node.create_subscription(
                message_type, name,
                (lambda topic: lambda _msg: counts.__setitem__(topic, counts[topic] + 1))(name),
                10,
            )

    # 3) explicit sampling: one subscription yields the message AND its rate,
    #    which is what `topic echo` plus `topic hz` would take two calls for.
    samples: dict[str, dict] = {}
    sample_topics = [t.strip() for t in (args.sample or '').split(',') if t.strip()]
    if sample_topics:
        types_by_topic = dict(node.get_topic_names_and_types())
        for topic in sample_topics:
            types = types_by_topic.get(topic)
            if not types:
                samples[topic] = {'topic': topic, 'found': False, 'reason': 'topic not in the graph'}
                continue
            message_type = resolve_msg_type(types[0])
            if message_type is None:
                samples[topic] = {
                    'topic': topic, 'found': False, 'types': sorted(types),
                    'reason': f'unsupported message type {types[0]}',
                }
                continue
            record = {
                'topic': topic,
                'found': True,
                'types': sorted(types),
                'publishers': node.count_publishers(topic),
                'subscribers': node.count_subscribers(topic),
                'count': 0,
                'first': None,
                'last': None,
            }
            samples[topic] = record
            node.create_subscription(message_type, topic, sample_callback(record), 10)

    # 4) one listen window serves TF, rates and samples
    window = max(
        args.tf_timeout if args.tf else 0.0,
        args.rates_window if args.rates else 0.0,
        args.sample_window if sample_topics else 0.0,
    )
    window_started = time.time()
    deadline = window_started + window
    while time.time() < deadline:
        rclpy.spin_once(node, timeout_sec=0.1)

    elapsed = max(time.time() - window_started, 1e-6)
    node._rates = {
        name: {'count': count, 'hz': round(count / elapsed, 2)}
        for name, count in counts.items()
    }
    for record in samples.values():
        if record.get('found'):
            record['hz'] = round(record['count'] / elapsed, 2)
            record['window_s'] = round(elapsed, 2)
    node._samples = samples

    only = tuple(part for part in (args.node or '').split(',') if part.strip())
    snapshot = build_snapshot(
        node, args.tf, args.params, args.params_limit, args.include_hidden, args.rates,
        bool(sample_topics), only,
    )
    snapshot['counts'] = {
        'nodes': len(snapshot['nodes']),
        'topics': len(snapshot['topics']),
        'services': len(snapshot['services']),
        'actions': len(snapshot['actions']),
        'tf_frames': snapshot.get('tf', {}).get('count', 0),
        'live_topics': sum(1 for r in snapshot.get('rates', {}).values() if (r.get('hz') or 0) > 0),
    }
    snapshot['elapsed_ms'] = _now_ms() - started

    json.dump(snapshot, sys.stdout, ensure_ascii=False, default=str)
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
