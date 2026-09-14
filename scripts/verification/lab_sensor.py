#!/usr/bin/env python3
"""Verification rig — sensor node (dynamic TF + two publishers + parameters).

Part of the hand-built system used by `docs/verification-toolchain-efficiency.md`
and by the journey acceptance measurement (issue #19). Publishes
`sensor_msgs/Imu` and `geometry_msgs/Twist` at a parameterised rate and
broadcasts a dynamic `base_link -> imu_link` transform.
"""
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Imu
from geometry_msgs.msg import Twist, TransformStamped
from tf2_ros import TransformBroadcaster


class LabSensor(Node):
    def __init__(self):
        super().__init__('lab_sensor')
        self.declare_parameter('rate_hz', 10.0)
        self.declare_parameter('frame_id', 'imu_link')
        self.declare_parameter('noise_sigma', 0.01)
        self.imu_pub = self.create_publisher(Imu, '/lab/imu', 10)
        self.cmd_pub = self.create_publisher(Twist, '/lab/cmd', 10)
        self.tf = TransformBroadcaster(self)

        # frame_id drives the TF child frame; noise_sigma scales the Imu reading
        self._frame = str(self.get_parameter('frame_id').value)
        self._sigma = float(self.get_parameter('noise_sigma').value)
        rate = float(self.get_parameter('rate_hz').value)
        self.create_timer(1.0 / max(rate, 1e-3), self.tick)

    def tick(self):
        now = self.get_clock().now().to_msg()

        imu = Imu()
        imu.header.stamp = now
        imu.header.frame_id = self._frame
        imu.linear_acceleration.x = self._sigma
        imu.angular_velocity.z = 0.1
        self.imu_pub.publish(imu)

        cmd = Twist()
        cmd.linear.x = 0.2
        self.cmd_pub.publish(cmd)

        t = TransformStamped()
        t.header.stamp = now
        t.header.frame_id = 'base_link'
        t.child_frame_id = self._frame
        t.transform.translation.z = 0.12
        t.transform.rotation.w = 1.0
        self.tf.sendTransform(t)


def main():
    rclpy.init()
    node = LabSensor()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
