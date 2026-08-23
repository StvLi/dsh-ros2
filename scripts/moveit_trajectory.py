#!/usr/bin/env python3
"""moveit_trajectory.py — execute a saved joint trajectory JSON (generic).

Executes a trajectory previously produced by moveit_plan.py --plan-only
--out via the standard /execute_trajectory action.

Usage:
  python3 moveit_trajectory.py --trajectory <trajectory.json> [--timeout 60]
Output: JSON {"ok", "executed": true}
"""
import argparse
import json
import sys

import rclpy
from rclpy.node import Node
from trajectory_msgs.msg import JointTrajectory, JointTrajectoryPoint

from moveit_msgs.action import ExecuteTrajectory
from moveit_msgs.msg import MoveItErrorCodes, RobotTrajectory
from moveit_msgs.msg import RobotState

SUCCESS = MoveItErrorCodes.SUCCESS


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--trajectory', required=True)
    ap.add_argument('--timeout', type=float, default=60.0)
    args = ap.parse_args()

    try:
        with open(args.trajectory) as f:
            payload = json.load(f)
        joint_names = payload['joint_names']
        points = payload['points']
    except Exception as e:  # noqa: BLE001
        print(json.dumps({'ok': False, 'executed': False, 'error': f'bad trajectory file: {e}'}))
        return 1
    if not joint_names or not points:
        print(json.dumps({'ok': False, 'executed': False, 'error': 'empty trajectory'}))
        return 1

    rclpy.init()
    node = Node('moveit_trajectory')
    try:
        client = node.create_client  # placeholder to avoid unused import noise
        from rclpy.action import ActionClient
        execute_client = ActionClient(node, ExecuteTrajectory, '/execute_trajectory')
        if not execute_client.wait_for_server(timeout_sec=10.0):
            print(json.dumps({'ok': False, 'executed': False,
                              'error': 'action /execute_trajectory not available'}))
            return 2

        jt = JointTrajectory()
        jt.joint_names = joint_names
        for p in points:
            pt = JointTrajectoryPoint()
            pt.positions = [float(v) for v in p['positions']]
            pt.time_from_start.sec = int(p.get('time_from_start', 0.0))
            pt.time_from_start.nanosec = int((p.get('time_from_start', 0.0) % 1) * 1e9)
            jt.points.append(pt)
        traj = RobotTrajectory()
        traj.joint_trajectory = jt
        traj.robot_state = RobotState()

        goal = ExecuteTrajectory.Goal()
        goal.trajectory = traj
        send = execute_client.send_goal_async(goal)
        rclpy.spin_until_future_complete(node, send, timeout_sec=args.timeout)
        gh = send.result() if send.done() else None
        if gh is None or not gh.accepted:
            print(json.dumps({'ok': False, 'executed': False, 'error': 'ExecuteTrajectory goal rejected'}))
            return 3
        res_f = gh.get_result_async()
        rclpy.spin_until_future_complete(node, res_f, timeout_sec=args.timeout)
        res = res_f.result().result if res_f.done() else None
        if res is None:
            print(json.dumps({'ok': False, 'executed': False, 'error': 'ExecuteTrajectory result timed out'}))
            return 4
        ok = res.error_code.val == SUCCESS
        print(json.dumps({'ok': bool(ok), 'executed': bool(ok),
                          'error_code': res.error_code.val,
                          'error': '' if ok else f'MoveItErrorCode {res.error_code.val}'}))
        return 0 if ok else 5
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    sys.exit(main())
