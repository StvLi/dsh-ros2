#!/usr/bin/env python3
"""moveit_common.py — shared helpers for the generic MoveIt tools.

Loads SRDF data (groups, named states, planning frame) and drives the
standard moveit_msgs interfaces (/move_action, /execute_trajectory,
/compute_cartesian_path) — never imports a specific MoveIt package.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET

import rclpy
from rclpy.action import ActionClient
from rclpy.node import Node

from moveit_msgs.action import ExecuteTrajectory, MoveGroup
from moveit_msgs.msg import Constraints, JointConstraint, MoveItErrorCodes, RobotState

SUCCESS = MoveItErrorCodes.SUCCESS


def load_srdf(srdf_path: str) -> ET.Element:
    return ET.parse(srdf_path).getroot()


def group_chain(root: ET.Element, group: str) -> dict:
    for g in root.findall('group'):
        if g.get('name') != group:
            continue
        chain = g.find('chain')
        return {'tip': chain.get('tip_link', '') if chain is not None else ''}
    return {}


def named_state(root: ET.Element, group: str, pose: str) -> dict[str, float]:
    for gs in root.findall('group_state'):
        if gs.get('group') == group and gs.get('name') == pose:
            joints = {
                j.get('name'): float(j.get('value'))
                for j in gs.findall('joint')
                if j.get('name') is not None and j.get('value') is not None
            }
            if joints:
                return joints
    known = sorted(gs.get('name') for gs in root.findall('group_state') if gs.get('group') == group)
    raise ValueError(f"Unknown pose '{pose}' for group '{group}'. Known: {known}")


def planning_frame(root: ET.Element) -> str:
    for vj in root.findall('virtual_joint'):
        parent = vj.get('parent_frame', '')
        if parent:
            return parent
    return 'world'


def build_joint_goal(
    group: str,
    joints: dict[str, float],
    *,
    plan_only: bool = False,
    max_velocity: float = 0.2,
    max_acceleration: float = 0.2,
    planning_time: float = 5.0,
) -> MoveGroup.Goal:
    goal = MoveGroup.Goal()
    goal.planning_options.plan_only = plan_only
    goal.planning_options.replan = True
    goal.planning_options.replan_attempts = 3
    req = goal.request
    req.group_name = group
    req.num_planning_attempts = 5
    req.allowed_planning_time = planning_time
    req.max_velocity_scaling_factor = max_velocity
    req.max_acceleration_scaling_factor = max_acceleration
    req.start_state = RobotState()
    req.start_state.is_diff = True
    constraints = Constraints()
    for joint_name, position in joints.items():
        jc = JointConstraint()
        jc.joint_name = joint_name
        jc.position = position
        jc.tolerance_above = 0.001
        jc.tolerance_below = 0.001
        jc.weight = 1.0
        constraints.joint_constraints.append(jc)
    req.goal_constraints.append(constraints)
    return goal


class MoveGroupClient:
    """Thin generic client over the standard move_group interfaces."""

    def __init__(self, node: Node):
        self._node = node
        self._move = ActionClient(node, MoveGroup, '/move_action')
        self._execute = ActionClient(node, ExecuteTrajectory, '/execute_trajectory')

    def wait(self, timeout: float = 10.0) -> bool:
        return self._move.wait_for_server(timeout_sec=timeout)

    def move(self, goal: MoveGroup.Goal, timeout: float = 60.0):
        """Plan (and execute unless plan_only). Returns (ok, result, trajectory)."""
        send = self._move.send_goal_async(goal)
        rclpy.spin_until_future_complete(self._node, send, timeout_sec=timeout)
        if not send.done() or send.result() is None:
            raise RuntimeError('move_group send_goal timed out')
        gh = send.result()
        if not gh.accepted:
            raise RuntimeError('move_group rejected the goal')
        res_f = gh.get_result_async()
        rclpy.spin_until_future_complete(self._node, res_f, timeout_sec=timeout)
        if not res_f.done() or res_f.result() is None:
            raise RuntimeError('move_group result timed out')
        result = res_f.result().result
        ok = result.error_code.val == SUCCESS
        return ok, result

    def execute_trajectory(self, trajectory, timeout: float = 60.0):
        goal = ExecuteTrajectory.Goal()
        goal.trajectory = trajectory
        send = self._execute.send_goal_async(goal)
        rclpy.spin_until_future_complete(self._node, send, timeout_sec=timeout)
        gh = send.result() if send.done() else None
        if gh is None or not gh.accepted:
            raise RuntimeError('ExecuteTrajectory goal rejected')
        res_f = gh.get_result_async()
        rclpy.spin_until_future_complete(self._node, res_f, timeout_sec=timeout)
        res = res_f.result().result if res_f.done() else None
        if res is None or res.error_code.val != SUCCESS:
            raise RuntimeError('ExecuteTrajectory failed')
