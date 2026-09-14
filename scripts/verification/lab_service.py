#!/usr/bin/env python3
"""Verification rig — parameterised service node (`AddTwoInts`).

Part of the hand-built system used by the journey acceptance measurement
(issue #19): gives the graph a hand-written service with its own parameter,
next to the `demo_nodes_cpp` ones.
"""
import rclpy
from rclpy.node import Node
from example_interfaces.srv import AddTwoInts


class LabService(Node):
    def __init__(self):
        super().__init__('lab_service')
        self.declare_parameter('offset', 0)
        # NB: do not name this method `handle` — it would shadow Node.handle
        self.create_service(AddTwoInts, '/lab/add_two_ints', self.handle_request)

    def handle_request(self, request, response):
        response.sum = request.a + request.b + int(self.get_parameter('offset').value)
        return response


def main():
    rclpy.init()
    node = LabService()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
