#!/usr/bin/env python3
"""moveit_move.py — move a MoveIt planning group to a named SRDF pose.

Generic move_group client: uses only standard moveit_msgs interfaces
(/move_action + /execute_trajectory) and a parsed SRDF — never imports a
specific MoveIt config package. The (group, pose) named state comes from the
SRDF; the current joint state is taken from /joint_states (start_state is_diff).

Usage:
  python3 moveit_move.py --srdf <path> --group <g> --pose <p>
                         [--plan-only] [--timeout 60] [--max-velocity 0.2]
Output: JSON {"ok": bool, "planned": bool, "planning_time": float,
              "executed": bool, "error": str?, "planning_frame": str?}
"""
import argparse
import json
import sys
import xml.etree.ElementTree as ET

import rclpy
from rclpy.action import ActionClient
from rclpy.node import Node

from moveit_msgs.action import ExecuteTrajectory, MoveGroup
from moveit_msgs.msg import Constraints, JointConstraint, MoveItErrorCodes, RobotState
from sensor_msgs.msg import JointState

SUCCESS = MoveItErrorCodes.SUCCESS


def load_named_state(srdf_path, group, pose_name):
    root = ET.parse(srdf_path).getroot()
    for gs in root.findall('group_state'):
        if gs.get('group') == group and gs.get('name') == pose_name:
            joints = {
                j.get('name'): float(j.get('value'))
                for j in gs.findall('joint')
                if j.get('name') is not None and j.get('value') is not None
            }
            if not joints:
                raise ValueError(f"pose '{pose_name}' for group '{group}' has no joints")
            return joints
    known = sorted(gs.get('name') for gs in root.findall('group_state') if gs.get('group') == group)
    raise ValueError(f"Unknown pose '{pose_name}' for group '{group}'. Known: {known}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--srdf', required=True)
    ap.add_argument('--group', required=True)
    ap.add_argument('--pose', required=True)
    ap.add_argument('--plan-only', action='store_true')
    ap.add_argument('--timeout', type=float, default=60.0)
    ap.add_argument('--max-velocity', type=float, default=0.2)
    ap.add_argument('--max-acceleration', type=float, default=0.2)
    args = ap.parse_args()

    try:
        target = load_named_state(args.srdf, args.group, args.pose)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({'ok': False, 'planned': False, 'executed': False, 'error': str(e)}))
        return 1

    rclpy.init()
    node = Node('moveit_move')
    try:
        move_client = ActionClient(node, MoveGroup, '/move_action')
        execute_client = ActionClient(node, ExecuteTrajectory, '/execute_trajectory')
        if not move_client.wait_for_server(timeout_sec=10.0):
            print(json.dumps({'ok': False, 'planned': False, 'executed': False,
                              'error': 'move_group action /move_action not available'}))
            return 2

        # current joint state (start_state)
        joint_state = None
        got = [False]

        def cb(msg):
            joint_state = msg
            got[0] = True

        sub = node.create_subscription(JointState, '/joint_states', cb, 10)
        for _ in range(50):
            rclpy.spin_once(node, timeout_sec=0.1)
            if got[0]:
                break

        goal = MoveGroup.Goal()
        goal.planning_options.plan_only = args.plan_only
        goal.planning_options.replan = True
        goal.planning_options.replan_attempts = 3
        req = goal.request
        req.group_name = args.group
        req.num_planning_attempts = 5
        req.allowed_planning_time = 5.0
        req.max_velocity_scaling_factor = args.max_velocity
        req.max_acceleration_scaling_factor = args.max_acceleration
        req.start_state = RobotState()
        req.start_state.is_diff = True
        constraints = Constraints()
        for joint_name, position in target.items():
            jc = JointConstraint()
            jc.joint_name = joint_name
            jc.position = position
            jc.tolerance_above = 0.001
            jc.tolerance_below = 0.001
            jc.weight = 1.0
            constraints.joint_constraints.append(jc)
        req.goal_constraints.append(constraints)

        send_future = move_client.send_goal_async(goal)
        rclpy.spin_until_future_complete(node, send_future, timeout_sec=args.timeout)
        if not send_future.done() or send_future.result() is None:
            print(json.dumps({'ok': False, 'planned': False, 'executed': False,
                              'error': 'move_group send_goal timed out'}))
            return 3
        goal_handle = send_future.result()
        if not goal_handle.accepted:
            print(json.dumps({'ok': False, 'planned': False, 'executed': False,
                              'error': 'move_group rejected the goal'}))
            return 4
        result_future = goal_handle.get_result_async()
        rclpy.spin_until_future_complete(node, result_future, timeout_sec=args.timeout)
        if not result_future.done() or result_future.result() is None:
            print(json.dumps({'ok': False, 'planned': False, 'executed': False,
                              'error': 'move_group result timed out'}))
            return 5
        result = result_future.result().result
        code = result.error_code.val
        ok = code == SUCCESS
        out = {
            'ok': bool(ok),
            'planned': True,
            'planning_time': getattr(result, 'planning_time', 0.0),
            'executed': (not args.plan_only) and bool(ok),
            'error_code': code,
            'error': '' if ok else f'MoveItErrorCode {code} ({MoveItErrorCodes.SUCCESS=})',
        }
        print(json.dumps(out, ensure_ascii=False))
        return 0 if ok else 6
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    sys.exit(main())
