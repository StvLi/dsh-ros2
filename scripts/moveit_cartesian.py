#!/usr/bin/env python3
"""moveit_cartesian.py — translate a MoveIt group's end-effector along a Cartesian path.

Generic move_group client: uses only standard moveit_msgs
(/compute_cartesian_path service + /execute_trajectory action) and a parsed
SRDF — never imports a specific MoveIt config package. The planning frame and
the EE link come from the SRDF (virtual_joint parent + group chain tip), with
CLI overrides for robots that do not declare them.

Moves in segments (max CARTESIAN_SEGMENT_M per step) so long translations
succeed: each step looks up the current EE pose, offsets it by the remaining
delta (in 'ee' frame by default, or 'world'), plans a Cartesian path and
executes it if the achieved fraction meets --min-fraction.

Usage:
  python3 moveit_cartesian.py --srdf <path> --group <g> --dx 0.05 --dy 0 --dz 0
                              [--link <ee-link>] [--frame ee|world]
                              [--eef-step 0.005] [--jump-threshold 0.0]
                              [--avoid-collisions false] [--min-fraction 0.95]
                              [--segment 0.02] [--plan-only] [--timeout 60]
Output: JSON {"ok": bool, "executed_segments": int, "total_fraction": float,
              "error": str?, "planning_frame": str, "link": str}
"""
import argparse
import json
import sys
import time
import xml.etree.ElementTree as ET

import rclpy
from rclpy.action import ActionClient
from rclpy.node import Node

from geometry_msgs.msg import Pose, PoseStamped
from moveit_msgs.action import ExecuteTrajectory
from moveit_msgs.msg import MoveItErrorCodes, RobotState
from moveit_msgs.srv import GetCartesianPath
from tf2_ros import Buffer, TransformListener

SUCCESS = MoveItErrorCodes.SUCCESS
CARTESIAN_SEGMENT_M = 0.02


def load_group(srdf_path, group):
    root = ET.parse(srdf_path).getroot()
    for g in root.findall('group'):
        if g.get('name') != group:
            continue
        chain = g.find('chain')
        return {
            'tip': chain.get('tip_link', '') if chain is not None else '',
        }
    raise ValueError(f"Unknown planning group '{group}'")


def load_planning_frame(srdf_path):
    root = ET.parse(srdf_path).getroot()
    for vj in root.findall('virtual_joint'):
        parent = vj.get('parent_frame', '')
        if parent:
            return parent
    return 'world'


def quat_to_rot(q):
    x, y, z, w = q.x, q.y, q.z, q.w
    return [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]


def offset_pose(start, dx, dy, dz, frame):
    if frame in ('ee', 'eef', 'tool'):
        rot = quat_to_rot(start.orientation)
        local = [dx, dy, dz]
        wdelta = [
            rot[0][0] * local[0] + rot[0][1] * local[1] + rot[0][2] * local[2],
            rot[1][0] * local[0] + rot[1][1] * local[1] + rot[1][2] * local[2],
            rot[2][0] * local[0] + rot[2][1] * local[1] + rot[2][2] * local[2],
        ]
    else:  # world / base / planning frame
        wdelta = [dx, dy, dz]
    target = Pose()
    target.orientation = start.orientation
    target.position.x = start.position.x + wdelta[0]
    target.position.y = start.position.y + wdelta[1]
    target.position.z = start.position.z + wdelta[2]
    return target


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--srdf', required=True)
    ap.add_argument('--group', required=True)
    ap.add_argument('--dx', type=float, default=0.0)
    ap.add_argument('--dy', type=float, default=0.0)
    ap.add_argument('--dz', type=float, default=0.0)
    ap.add_argument('--link', default='', help='EE link (default: group chain tip from SRDF).')
    ap.add_argument('--frame', default='ee', help="Offset frame: 'ee' (default) or 'world'.")
    ap.add_argument('--eef-step', type=float, default=0.005)
    ap.add_argument('--jump-threshold', type=float, default=0.0)
    ap.add_argument('--avoid-collisions', action='store_true')
    ap.add_argument('--min-fraction', type=float, default=0.95)
    ap.add_argument('--segment', type=float, default=CARTESIAN_SEGMENT_M)
    ap.add_argument('--plan-only', action='store_true')
    ap.add_argument('--timeout', type=float, default=60.0)
    args = ap.parse_args()

    frame = args.frame.strip().lower()
    if frame not in ('ee', 'eef', 'tool', 'world', 'base'):
        print(json.dumps({'ok': False, 'error': f"frame must be 'ee' or 'world', got '{frame}'"}))
        return 1
    if abs(args.dx) + abs(args.dy) + abs(args.dz) < 1e-9:
        print(json.dumps({'ok': False, 'error': 'dx/dy/dz are all zero'}))
        return 1

    try:
        info = load_group(args.srdf, args.group)
        planning_frame = load_planning_frame(args.srdf)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({'ok': False, 'error': str(e)}))
        return 1
    link = args.link or info['tip']
    if not link:
        print(json.dumps({'ok': False, 'error': f"no EE link for group '{args.group}' (SRDF chain tip); pass --link"}))
        return 1

    rclpy.init()
    node = Node('moveit_cartesian')
    try:
        cartesian_client = node.create_client(GetCartesianPath, '/compute_cartesian_path')
        execute_client = ActionClient(node, ExecuteTrajectory, '/execute_trajectory')
        if not cartesian_client.wait_for_service(timeout_sec=10.0):
            print(json.dumps({'ok': False, 'error': 'service /compute_cartesian_path not available',
                              'planning_frame': planning_frame, 'link': link}))
            return 2

        tf_buffer = Buffer()
        tf_listener = TransformListener(tf_buffer, node)

        def lookup_pose():
            deadline = time.monotonic() + 10.0
            while rclpy.ok() and time.monotonic() < deadline:
                if tf_buffer.can_transform(planning_frame, link, rclpy.time.Time()):
                    t = tf_buffer.lookup_transform(planning_frame, link, rclpy.time.Time())
                    p = Pose()
                    p.position.x = t.transform.translation.x
                    p.position.y = t.transform.translation.y
                    p.position.z = t.transform.translation.z
                    p.orientation = t.transform.rotation
                    return p
                rclpy.spin_once(node, timeout_sec=0.1)
            raise RuntimeError(f'TF unavailable: {planning_frame} <- {link}')

        max_delta = max(abs(args.dx), abs(args.dy), abs(args.dz))
        steps = max(1, int(math.ceil(max_delta / args.segment)))
        sdx, sdy, sdz = args.dx / steps, args.dy / steps, args.dz / steps
        executed = 0
        min_fraction = 1.0
        for _ in range(steps):
            start_pose = lookup_pose()
            target = offset_pose(start_pose, sdx, sdy, sdz, frame)
            wp = PoseStamped()
            wp.header.frame_id = planning_frame
            wp.pose = target

            request = GetCartesianPath.Request()
            request.header.frame_id = planning_frame
            request.group_name = args.group
            request.link_name = link
            request.waypoints = [wp]
            request.max_step = args.eef_step
            request.jump_threshold = args.jump_threshold
            request.avoid_collisions = args.avoid_collisions
            request.start_state = RobotState()
            request.start_state.is_diff = True

            future = cartesian_client.call_async(request)
            rclpy.spin_until_future_complete(node, future, timeout_sec=args.timeout)
            if future.done() and future.result() is not None:
                response = future.result()
                fraction = response.fraction
                min_fraction = min(min_fraction, fraction)
                if response.error_code.val != SUCCESS or fraction < args.min_fraction:
                    print(json.dumps({'ok': False, 'executed_segments': executed,
                                      'total_fraction': min_fraction,
                                      'error': f'cartesian path fraction {fraction:.2%} < {args.min_fraction:.0%}',
                                      'planning_frame': planning_frame, 'link': link}))
                    return 3
                if not args.plan_only:
                    goal = ExecuteTrajectory.Goal()
                    goal.trajectory = response.solution
                    send_f = execute_client.send_goal_async(goal)
                    rclpy.spin_until_future_complete(node, send_f, timeout_sec=args.timeout)
                    gh = send_f.result() if send_f.done() else None
                    if gh is None or not gh.accepted:
                        print(json.dumps({'ok': False, 'executed_segments': executed,
                                          'total_fraction': min_fraction,
                                          'error': 'ExecuteTrajectory goal rejected',
                                          'planning_frame': planning_frame, 'link': link}))
                        return 4
                    res_f = gh.get_result_async()
                    rclpy.spin_until_future_complete(node, res_f, timeout_sec=args.timeout)
                    res = res_f.result().result if res_f.done() else None
                    if res is None or res.error_code.val != SUCCESS:
                        print(json.dumps({'ok': False, 'executed_segments': executed,
                                          'total_fraction': min_fraction,
                                          'error': 'ExecuteTrajectory failed',
                                          'planning_frame': planning_frame, 'link': link}))
                        return 5
                executed += 1
            else:
                print(json.dumps({'ok': False, 'executed_segments': executed,
                                  'total_fraction': min_fraction,
                                  'error': 'GetCartesianPath call timed out',
                                  'planning_frame': planning_frame, 'link': link}))
                return 6

        print(json.dumps({'ok': True, 'executed_segments': executed,
                          'total_fraction': min_fraction,
                          'planning_frame': planning_frame, 'link': link,
                          'plan_only': args.plan_only}))
        return 0
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    import math  # noqa: PLC0415 (imported here to keep the header clean)

    sys.exit(main())
