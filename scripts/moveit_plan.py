#!/usr/bin/env python3
"""moveit_plan.py — plan (optionally execute) an arbitrary joint goal (generic).

Uses only standard moveit_msgs (/move_action + /execute_trajectory) and an
SRDF; the target joints are given directly as "j1:=v1 j2:=v2 ...". With
--plan-only and --out, the planned trajectory is written as JSON so it can
be executed later with moveit_trajectory.py.

Usage:
  python3 moveit_plan.py --srdf <path> --group <g> --joints "a:=0.1 b:=-0.2"
                         [--plan-only] [--out <trajectory.json>] [--timeout 60]
Output: JSON {"ok", "planned", "planning_time", "executed", "trajectory_out"?}
"""
import argparse
import json
import sys

import rclpy
from rclpy.node import Node

import moveit_common


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--srdf', required=True)
    ap.add_argument('--group', required=True)
    ap.add_argument('--joints', required=True, help='Space-separated "joint:=value" pairs.')
    ap.add_argument('--plan-only', action='store_true')
    ap.add_argument('--out', default='', help='Write the planned trajectory JSON to this path.')
    ap.add_argument('--timeout', type=float, default=60.0)
    ap.add_argument('--max-velocity', type=float, default=0.2)
    ap.add_argument('--max-acceleration', type=float, default=0.2)
    args = ap.parse_args()

    try:
        target = {}
        for token in args.joints.split():
            name, _, value = token.partition(':=')
            if not value:
                raise ValueError(f"bad joint token '{token}' (expected name:=value)")
            target[name.strip()] = float(value)
    except ValueError as e:
        print(json.dumps({'ok': False, 'planned': False, 'executed': False, 'error': str(e)}))
        return 1
    if not target:
        print(json.dumps({'ok': False, 'planned': False, 'executed': False, 'error': 'no joints given'}))
        return 1

    rclpy.init()
    node = Node('moveit_plan')
    try:
        client = moveit_common.MoveGroupClient(node)
        if not client.wait():
            print(json.dumps({'ok': False, 'planned': False, 'executed': False,
                              'error': 'move_group action /move_action not available'}))
            return 2
        goal = moveit_common.build_joint_goal(
            args.group, target,
            plan_only=args.plan_only,
            max_velocity=args.max_velocity,
            max_acceleration=args.max_acceleration,
        )
        ok, result = client.move(goal, timeout=args.timeout)
        out = {'ok': bool(ok), 'planned': True,
               'planning_time': getattr(result, 'planning_time', 0.0),
               'executed': (not args.plan_only) and bool(ok),
               'error_code': result.error_code.val,
               'error': '' if ok else f'MoveItErrorCode {result.error_code.val}'}
        if ok and args.plan_only and args.out:
            traj = result.trajectory_start if hasattr(result, 'trajectory_start') else None
            # MoveGroupResult carries planned_trajectory
            planned = getattr(result, 'planned_trajectory', None)
            if planned is not None:
                payload = {
                    'joint_names': list(planned.joint_trajectory.joint_names),
                    'points': [
                        {'positions': list(p.positions),
                         'time_from_start': p.time_from_start.sec + p.time_from_start.nanosec / 1e9}
                        for p in planned.joint_trajectory.points
                    ],
                }
                with open(args.out, 'w') as f:
                    json.dump(payload, f)
                out['trajectory_out'] = args.out
        print(json.dumps(out, ensure_ascii=False))
        return 0 if ok else 3
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    sys.exit(main())
