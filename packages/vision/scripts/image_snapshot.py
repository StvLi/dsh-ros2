#!/usr/bin/env python3
"""image_snapshot.py — grab one frame from a ROS2 image topic and save as JPEG.

DECOUPLED: uses ONLY the ROS2 distro's rclpy (+ Pillow/numpy for conversion),
so it works on ANY host with a plain ROS2 install — no custom ROS2 package
(dsh_ros2_vlm) needs to be built. Optional --v4l <dev> fallback grabs a frame
from a V4L2 camera via ffmpeg when the topic yields nothing. The saved file
can be consumed by the Agent's own multimodal model directly (read_image).

Usage:
    python3 image_snapshot.py --topic /camera/image --output /tmp/f.jpg
                              [--timeout 5] [--compressed] [--v4l /dev/video0]
Prints one JSON line on success/failure.
"""

import argparse
import io
import json
import os
import subprocess
import sys
import time


def jpeg_size(path):
    """Read (width, height) from a JPEG via Pillow; (0, 0) when unavailable."""
    try:
        from PIL import Image as PILImage
        with PILImage.open(path) as im:
            return im.size
    except Exception:  # noqa: BLE001
        return (0, 0)


def topic_frame(topic, output, timeout, compressed):
    """Subscribe to the topic and save one frame. Returns ((path,w,h), note)."""
    try:
        import rclpy
        from rclpy.node import Node
        from rclpy.qos import QoSProfile, ReliabilityPolicy
        from sensor_msgs.msg import CompressedImage, Image
    except ImportError as e:
        return None, "rclpy 不可用（{}）——请确认 ROS2 已 source（source /opt/ros/<distro>/setup.bash）".format(e)
    try:
        import numpy as np
    except ImportError as e:
        return None, "numpy 不可用（{}）——无法转换 sensor_msgs/Image".format(e)
    try:
        from PIL import Image as PILImage
    except ImportError:
        PILImage = None

    rclpy.init()
    node = Node("dsh_image_snapshot")
    got = {}
    qos = QoSProfile(depth=1, reliability=ReliabilityPolicy.BEST_EFFORT)

    def cb_comp(msg):
        got.setdefault("comp", msg)

    def cb_raw(msg):
        got.setdefault("img", msg)

    if compressed:
        node.create_subscription(CompressedImage, topic, cb_comp, qos)
    else:
        node.create_subscription(Image, topic, cb_raw, qos)
    deadline = time.time() + timeout
    while time.time() < deadline and not got:
        rclpy.spin_once(node, timeout_sec=0.1)
    node.destroy_node()
    rclpy.shutdown()

    if "comp" in got:
        data = bytes(got["comp"].data)
        if PILImage is not None:
            PILImage.open(io.BytesIO(data)).save(output, "JPEG")
            return (output, *jpeg_size(output)), None
        with open(output, "wb") as f:
            f.write(data)
        return (output, *jpeg_size(output)), "Pillow 不可用——已保存压缩帧原始字节（非 JPEG）"
    if "img" in got:
        m = got["img"]
        arr = np.frombuffer(bytes(m.data), np.uint8)
        if m.encoding == "rgb8":
            frame = arr.reshape(m.height, m.width, 3)
        elif m.encoding == "bgr8":
            frame = arr.reshape(m.height, m.width, 3)[:, :, ::-1]  # BGR -> RGB
        elif m.encoding == "mono8":
            frame = arr.reshape(m.height, m.width)
        else:
            return None, "不支持的编码 {}".format(m.encoding)
        if PILImage is not None:
            PILImage.fromarray(frame).save(output, "JPEG")
            return (output, m.width, m.height), None
        frame.tofile(output)
        return (output, m.width, m.height), "Pillow 不可用——已保存原始像素数组"
    return None, "超时未收到帧（{}s；topic={}）——确认话题有发布者，或改用 --v4l".format(timeout, topic)


def v4l_frame(dev, output):
    """Grab one frame from a V4L2 device via ffmpeg (topic-free fallback)."""
    try:
        subprocess.run(
            ["ffmpeg", "-f", "v4l2", "-i", dev, "-frames:v", "1", "-y", output],
            capture_output=True, timeout=15)
    except Exception as e:  # noqa: BLE001
        return None, "ffmpeg V4L 抓取失败：{}".format(e)
    if os.path.exists(output) and os.path.getsize(output) > 0:
        return (output, *jpeg_size(output)), None
    return None, "ffmpeg V4L 未产出文件（{}）——确认设备存在且未被占用".format(dev)


def main(argv=None):
    ap = argparse.ArgumentParser(description="grab one frame from a ROS2 image topic")
    ap.add_argument("--topic", default="/camera/image")
    ap.add_argument("--output", default="")
    ap.add_argument("--timeout", type=float, default=5.0)
    ap.add_argument("--compressed", action="store_true")
    ap.add_argument("--v4l", default="")
    args = ap.parse_args(argv)

    output = args.output or os.path.join(
        os.environ.get("TMPDIR", "/tmp"), "dsh-ros2", "snapshot_{}.jpg".format(int(time.time() * 1000)))
    os.makedirs(os.path.dirname(output), exist_ok=True)

    saved, note = topic_frame(args.topic, output, args.timeout, args.compressed)
    source = "topic"
    if saved is None and args.v4l:
        saved, note = v4l_frame(args.v4l, output)
        source = "v4l"

    out = {"ok": saved is not None, "path": output, "source": source}
    if saved is not None:
        out["width"], out["height"] = saved[1], saved[2]
    if note:
        out["note"] = note
    if not saved:
        out["error"] = note
    print(json.dumps(out, ensure_ascii=False))
    return 0 if saved is not None else 1


if __name__ == "__main__":
    sys.exit(main())
