#!/usr/bin/env python3
"""moveit_move.py — unified MoveIt motion interface (5 modes, generic).

Abstracts the five essential motion modes behind one tool:
  joint_abs   关节角绝对位置模式规划执行  --joints "j1:=v1 j2:=v2"
  joint_rel   关节角相对增量模式规划执行  --delta-joints "j1:=dv1 ..." (current + delta)
  pose_abs    末端位姿绝对模式规划执行    --pose "x y z rx ry rz" (planning frame, RPY)
  pose_rel    末端位姿相对增量规划执行    --delta-pose "dx dy dz drx dry drz" --frame ee|world
  trajectory 轨迹执行                    --trajectory <path.json> (from joint_abs/rel planOnly+trajectoryOut)

Uses only standard moveit_msgs (/move_action + /execute_trajectory) + the
SRDF (planning frame from virtual_joint, EE link from the group chain tip) —
never a specific MoveIt package.

Output: JSON {"ok", "planned", "planning_time", "executed", "mode", ...}
"""
import argparse
import json
import sys

import rclpy
from rclpy.node import Node

import moveit_common
from moveit_msgs.msg import MoveItErrorCodes

SUCCESS = MoveItErrorCodes.SUCCESS


def parse_joint_pairs(text: str) -> dict:
    pairs = {}
    for token in text.split():
        name, _, value = token.partition(":=")
        if not value:
            raise ValueError(f"bad joint token '{token}' (expected name:=value)")
        pairs[name.strip()] = float(value)
    return pairs


def parse_rpy_vector(text: str, n: int, what: str) -> list:
    parts = text.split()
    if len(parts) != n:
        raise ValueError(f"{what} 需要 {n} 个数值，收到 '{text}'")
    return [float(v) for v in parts]


def read_current_joints(node: Node, timeout: float = 8.0) -> dict:
    """Sample /joint_states for the current joint positions."""
    from sensor_msgs.msg import JointState
    current = {}
    got = [False]

    def cb(msg):
        for name, pos in zip(msg.name, msg.position):
            current[name] = float(pos)
        got[0] = True

    node.create_subscription(JointState, '/joint_states', cb, 10)
    for _ in range(int(timeout / 0.1)):
        rclpy.spin_once(node, timeout_sec=0.1)
        if got[0]:
            break
    return current


def lookup_ee_pose(node, tf_buffer, planning_frame: str, link: str):
    """Current EE pose in the planning frame."""
    import time
    from geometry_msgs.msg import Pose
    deadline = time.monotonic() + 10.0
    while rclpy.ok() and time.monotonic() < deadline:
        if tf_buffer.can_transform(planning_frame, link, rclpy.time.Time()):
            t = tf_buffer.lookup_transform(planning_frame, link, rclpy.time.Time())
            p = Pose()
            p.position.x = t.transform.translation.x
            p.position.y = t.transform.translation.y
            p.position.z = t.transform.translation.z
            p.orientation.x = t.transform.rotation.x
            p.orientation.y = t.transform.rotation.y
            p.orientation.z = t.transform.rotation.z
            p.orientation.w = t.transform.rotation.w
            return p
        rclpy.spin_once(node, timeout_sec=0.1)
    raise RuntimeError(f'TF unavailable: {planning_frame} <- {link}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mode', required=True,
                    choices=['joint_abs', 'joint_rel', 'pose_abs', 'pose_rel', 'trajectory'])
    ap.add_argument('--srdf', required=True)
    ap.add_argument('--group', required=True)
    ap.add_argument('--joints', default='', help='joint_abs: "j:=v ..."')
    ap.add_argument('--delta-joints', default='', help='joint_rel: "j:=dv ..." (current + delta)')
    ap.add_argument('--pose', default='', help='pose_abs: "x y z rx ry rz" in the planning frame')
    ap.add_argument('--delta-pose', default='', help='pose_rel: "dx dy dz drx dry drz"')
    ap.add_argument('--frame', default='ee', help="pose_rel reference: 'ee' (default) or 'world'")
    ap.add_argument('--link', default='', help='EE link (default: group chain tip from SRDF).')
    ap.add_argument('--trajectory', default='', help='trajectory: path to a trajectory JSON.')
    ap.add_argument('--plan-only', action='store_true')
    ap.add_argument('--out', default='', help='With plan-only, write the planned trajectory JSON here.')
    ap.add_argument('--timeout', type=float, default=60.0)
    ap.add_argument('--max-velocity', type=float, default=0.2)
    ap.add_argument('--max-acceleration', type=float, default=0.2)
    args = ap.parse_args()

    mode = args.mode
    try:
        root = moveit_common.load_srdf(args.srdf)
        planning_frame = moveit_common.planning_frame(root)
        chain = moveit_common.group_chain(root, args.group)
        link = args.link or chain.get('tip', '')
    except Exception as e:  # noqa: BLE001
        print(json.dumps({'ok': False, 'error': str(e), 'mode': mode}))
        return 1

    if mode == 'trajectory':
        try:
            with open(args.trajectory) as f:
                payload = json.load(f)
            joint_names = payload['joint_names']
            points = payload['points']
        except Exception as e:  # noqa: BLE001
            print(json.dumps({'ok': False, 'executed': False, 'error': f'bad trajectory file: {e}', 'mode': mode}))
            return 1
        rclpy.init()
        node = Node('moveit_move_traj')
        try:
            client = moveit_common.MoveGroupClient(node)
            if not client.wait():
                print(json.dumps({'ok': False, 'executed': False,
                                  'error': 'action /execute_trajectory not available', 'mode': mode}))
                return 2
            from trajectory_msgs.msg import JointTrajectory, JointTrajectoryPoint
            from moveit_msgs.msg import RobotTrajectory, RobotState
            jt = JointTrajectory()
            jt.joint_names = joint_names
            for p in points:
                pt = JointTrajectoryPoint()
                pt.positions = [float(v) for v in p['positions']]
                tfs = float(p.get('time_from_start', 0.0))
                pt.time_from_start.sec = int(tfs)
                pt.time_from_start.nanosec = int((tfs % 1) * 1e9)
                jt.points.append(pt)
            traj = RobotTrajectory()
            traj.joint_trajectory = jt
            traj.robot_state = RobotState()
            client.execute_trajectory(traj, timeout=args.timeout)
            print(json.dumps({'ok': True, 'executed': True, 'mode': mode, 'trajectory': args.trajectory}))
            return 0
        except Exception as e:  # noqa: BLE001
            print(json.dumps({'ok': False, 'executed': False, 'error': str(e), 'mode': mode}))
            return 3
        finally:
            node.destroy_node()
            rclpy.shutdown()

    # planning modes need the EE link for pose modes
    if mode in ('pose_abs', 'pose_rel') and not link:
        print(json.dumps({'ok': False, 'error': f"no EE link for group '{args.group}' (SRDF chain tip); pass --link",
                          'mode': mode}))
        return 1

    rclpy.init()
    node = Node('moveit_move')
    try:
        client = moveit_common.MoveGroupClient(node)
        if not client.wait():
            print(json.dumps({'ok': False, 'planned': False, 'executed': False,
                              'error': 'move_group action /move_action not available', 'mode': mode}))
            return 2

        if mode == 'joint_abs':
            target = parse_joint_pairs(args.joints)
            goal = moveit_common.build_joint_goal(
                args.group, target, plan_only=args.plan_only,
                max_velocity=args.max_velocity, max_acceleration=args.max_acceleration)
        elif mode == 'joint_rel':
            deltas = parse_joint_pairs(args.delta_joints)
            current = read_current_joints(node)
            target = {name: current.get(name, 0.0) + dv for name, dv in deltas.items()}
            goal = moveit_common.build_joint_goal(
                args.group, target, plan_only=args.plan_only,
                max_velocity=args.max_velocity, max_acceleration=args.max_acceleration)
        else:  # pose_abs / pose_rel
            from tf2_ros import Buffer, TransformListener
            if mode == 'pose_abs':
                x, y, z, rx, ry, rz = parse_rpy_vector(args.pose, 6, 'pose')
                quat = moveit_common.rpy_to_quat(rx, ry, rz)
            else:  # pose_rel
                dx, dy, dz, drx, dry, drz = parse_rpy_vector(args.delta_pose, 6, 'delta-pose')
                tf_buffer = Buffer()
                tf_listener = TransformListener(tf_buffer, node)
                current = lookup_ee_pose(node, tf_buffer, planning_frame, link)
                x = current.position.x + dx
                y = current.position.y + dy
                z = current.position.z + dz
                base_q = (current.orientation.x, current.orientation.y,
                          current.orientation.z, current.orientation.w)
                delta_q = moveit_common.rpy_to_quat(drx, dry, drz)
                if args.frame.strip().lower() in ('ee', 'eef', 'tool'):
                    quat = moveit_common.quat_multiply(base_q, delta_q)
                else:  # world
                    quat = moveit_common.quat_multiply(delta_q, base_q)
            goal = moveit_common.build_pose_goal(
                args.group, link, (x, y, z), quat, plan_only=args.plan_only,
                max_velocity=args.max_velocity, max_acceleration=args.max_acceleration)

        ok, result = client.move(goal, timeout=args.timeout)
        out = {'ok': bool(ok), 'planned': True, 'mode': mode,
               'planning_time': getattr(result, 'planning_time', 0.0),
               'executed': (not args.plan_only) and bool(ok),
               'error_code': result.error_code.val,
               'error': '' if ok else f'MoveItErrorCode {result.error_code.val}'}
        if ok and args.plan_only and args.out:
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
