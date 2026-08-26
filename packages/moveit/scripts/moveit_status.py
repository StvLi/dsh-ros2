#!/usr/bin/env python3
"""moveit_status.py — runtime status of the MoveIt stack (generic).

Probes the standard move_group interfaces and samples the current joint
state. Never binds to a specific MoveIt package.

Usage:
  python3 moveit_status.py [--srdf <path>]
Output: JSON {"online": {...}, "joint_state": {name: position}, "planning_frame": str}
"""
import argparse
import json
import sys

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import JointState


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--srdf', default='')
    args = ap.parse_args()

    rclpy.init()
    node = Node('moveit_status')

    online = {'move_action': False, 'execute_trajectory': False,
              'compute_cartesian_path': False, 'controller_manager': False}
    import subprocess
    try:
        actions = subprocess.run(['ros2', 'action', 'list', '-t'],
                                 capture_output=True, text=True, timeout=15).stdout
        online['move_action'] = '/move_action' in actions
        online['execute_trajectory'] = '/execute_trajectory' in actions
    except Exception:  # noqa: BLE001
        pass
    try:
        services = subprocess.run(['ros2', 'service', 'list'],
                                  capture_output=True, text=True, timeout=15).stdout
        online['compute_cartesian_path'] = '/compute_cartesian_path' in services
        online['controller_manager'] = '/controller_manager/list_controllers' in services
    except Exception:  # noqa: BLE001
        pass

    joints = {}
    got = [False]

    def cb(msg):
        for name, pos in zip(msg.name, msg.position):
            joints[name] = float(pos)
        got[0] = True

    node.create_subscription(JointState, '/joint_states', cb, 10)
    for _ in range(50):
        rclpy.spin_once(node, timeout_sec=0.1)
        if got[0]:
            break

    planning_frame = 'world'
    if args.srdf:
        try:
            import moveit_common
            root = moveit_common.load_srdf(args.srdf)
            planning_frame = moveit_common.planning_frame(root)
        except Exception:  # noqa: BLE001
            pass

    print(json.dumps({'online': online, 'joint_state': joints,
                      'planning_frame': planning_frame}, ensure_ascii=False))
    node.destroy_node()
    rclpy.shutdown()
    return 0


if __name__ == '__main__':
    sys.exit(main())
