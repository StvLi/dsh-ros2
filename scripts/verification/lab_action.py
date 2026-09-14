#!/usr/bin/env python3
"""Verification rig — action server (`Fibonacci`) with feedback.

Part of the hand-built system used by the journey acceptance measurement
(issue #19): a second action server beside `action_tutorials_cpp`'s, so
`ros2_action_list` has more than one entry to report.
"""
import rclpy
from rclpy.action import ActionServer
from rclpy.duration import Duration
from rclpy.node import Node
from example_interfaces.action import Fibonacci


class LabAction(Node):
    def __init__(self):
        super().__init__('lab_action')
        self.declare_parameter('step_delay', 0.05)
        self.server = ActionServer(self, Fibonacci, '/lab/fibonacci', self.execute)

    def execute(self, goal_handle):
        delay = float(self.get_parameter('step_delay').value)
        seq = [0, 1]
        feedback = Fibonacci.Feedback()
        for i in range(1, max(int(goal_handle.request.order), 1)):
            seq.append(seq[i] + seq[i - 1])
            feedback.sequence = seq
            goal_handle.publish_feedback(feedback)
            self.get_clock().sleep_for(Duration(seconds=delay))
        goal_handle.succeed()
        result = Fibonacci.Result()
        result.sequence = seq
        return result


def main():
    rclpy.init()
    node = LabAction()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
