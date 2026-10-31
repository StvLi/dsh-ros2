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

Privacy (round 27). This helper is also a standalone CLI, so it cannot lean on
the tool layer's guards (`ros2_image_snapshot` validates the directory and gates
any path outside it by approval). Both halves now use the SAME criterion
(`packages/common/scripts/private_paths.py`):

  * the DEFAULT output lives at a fixed coordinate under the temp root
    (`$TMPDIR/dsh-ros2/snapshot_<ms>.jpg`). Round 27 measured the old code:
    `os.makedirs` created that directory **0775** with the ambient umask and
    silently walked through a planted symlink — i.e. a predictable directory in
    a 1777 parent, written by a process that never asked whether it was ours.
    Now the default directory is created/tightened to 0700 and a symlink, a
    non-directory or a foreign owner is a refusal (exit code 3).
  * the bytes are written through `write_private_file` (0600, temp file +
    `os.replace`), so a symlink planted at the OUTPUT path is replaced instead
    of followed, and the frame is not left group-readable.
  * an explicit `--output` keeps the operator's own directory/mode, exactly like
    `runtime-dir.ts` treats a configured screenshot directory: judged for
    symlink/type/owner, never tightened.

Self-test (no ROS2, no network): `python3 image_snapshot.py --selftest`
"""

import argparse
import io
import json
import os
import subprocess
import sys
import tempfile
import time

try:
    import private_paths
except ImportError:  # pragma: no cover - run from an odd loader
    import importlib.util as _ilu
    _HERE = os.path.dirname(os.path.abspath(__file__))
    _PKGS = os.path.dirname(os.path.dirname(_HERE))  # <…>/packages or node_modules
    _found = None
    for _cand in (os.path.join(_PKGS, "common", "scripts"),
                  os.path.join(_PKGS, "dsh-ros2-common", "scripts")):
        _target = os.path.join(_cand, "private_paths.py")
        if os.path.isfile(_target):
            _found = _target
            break
    if _found is None:  # fail loud: the criterion must never silently vanish
        raise
    _SPEC = _ilu.spec_from_file_location("private_paths", _found)
    private_paths = _ilu.module_from_spec(_SPEC)
    _SPEC.loader.exec_module(private_paths)

EXIT_REFUSED = 3


def default_output() -> str:
    """The default frame coordinate: `$TMPDIR/dsh-ros2/snapshot_<ms>.jpg`."""
    return os.path.join(os.environ.get("TMPDIR", "/tmp"), "dsh-ros2",
                        "snapshot_{}.jpg".format(int(time.time() * 1000)))


def prepare_output(output: str, anchor: str = "") -> str:
    """Make the destination usable, or refuse (exit code 3) with a code on stderr.

    ONE rule, the same one `runtime-dir.ts` applies on the TypeScript side:
    the directory is judged always; it is TIGHTENED only under the shared temp
    root (`anchor`), because that is where a hostile pre-creation can happen. A
    directory the operator chose elsewhere keeps the mode they gave it — but a
    symlink, a non-directory or a foreign owner is still a refusal, for the
    default coordinate and for `--output` alike.
    """
    target = os.path.abspath(os.path.expanduser(output))
    parent = os.path.dirname(target)
    if not anchor:
        anchor = os.environ.get("TMPDIR", "/tmp")
    try:
        private_paths.ensure_private_dir(parent, label="取帧目录", anchor=anchor)
    except private_paths.PrivatePathError as error:
        sys.stderr.write(json.dumps({"ok": False, "code": error.code,
                                     "error": error.message}, ensure_ascii=False) + "\n")
        sys.exit(EXIT_REFUSED)
    return target


def jpeg_size(path):
    """Read (width, height) from a JPEG via Pillow; (0, 0) when unavailable."""
    try:
        from PIL import Image as PILImage
        with PILImage.open(path) as im:
            return im.size
    except Exception:  # noqa: BLE001
        return (0, 0)


def _save_bytes(output, data):
    """Write image bytes without following a symlink and without group/other bits."""
    private_paths.write_private_file(output, data)


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
            buf = io.BytesIO()
            PILImage.open(io.BytesIO(data)).save(buf, "JPEG")
            _save_bytes(output, buf.getvalue())
            return (output, *jpeg_size(output)), None
        _save_bytes(output, data)
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
            buf = io.BytesIO()
            PILImage.fromarray(frame).save(buf, "JPEG")
            _save_bytes(output, buf.getvalue())
            return (output, m.width, m.height), None
        _save_bytes(output, frame.tobytes())
        return (output, m.width, m.height), "Pillow 不可用——已保存原始像素数组"
    return None, "超时未收到帧（{}s；topic={}）——确认话题有发布者，或改用 --v4l".format(timeout, topic)


def v4l_frame(dev, output):
    """Grab one frame from a V4L2 device via ffmpeg (topic-free fallback).

    ffmpeg writes to a temp file NEXT TO the destination and the result is moved
    into place with `os.replace`, for the same reason every other writer in this
    repository does: the destination is a fixed coordinate, and `os.replace`
    swaps the directory entry instead of writing through whatever is there.
    """
    parent = os.path.dirname(os.path.abspath(output)) or "."
    fd, tmp = tempfile.mkstemp(prefix=".dsh-ros2-frame-", suffix=".jpg", dir=parent)
    os.close(fd)
    try:
        subprocess.run(
            ["ffmpeg", "-f", "v4l2", "-i", dev, "-frames:v", "1", "-y", tmp],
            capture_output=True, timeout=15)
        if os.path.getsize(tmp) > 0:
            with open(tmp, "rb") as handle:
                data = handle.read()
            _save_bytes(output, data)
            return (output, *jpeg_size(output)), None
        return None, "ffmpeg V4L 未产出文件（{}）——确认设备存在且未被占用".format(dev)
    except Exception as e:  # noqa: BLE001
        return None, "ffmpeg V4L 抓取失败：{}".format(e)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def selftest() -> int:
    """The write criterion, without ROS2, without a camera."""
    import stat as _stat

    failures = []

    def check(label, cond, detail=""):
        print("  {}  {}{}".format("PASS" if cond else "FAIL", label, "" if cond else "  " + str(detail)))
        if not cond:
            failures.append(label)

    saved_tmp = os.environ.get("TMPDIR")
    sandbox = tempfile.mkdtemp(prefix="dsh-image-snapshot-")
    try:
        # 1) the default coordinate is created 0700 and does not depend on umask.
        os.environ["TMPDIR"] = sandbox
        saved_umask = os.umask(0)
        try:
            out = prepare_output(default_output())
        finally:
            os.umask(saved_umask)
        parent = os.path.dirname(out)
        check("default output directory is created 0700 even under umask 000",
              _stat.S_IMODE(os.lstat(parent).st_mode) == 0o700,
              oct(_stat.S_IMODE(os.lstat(parent).st_mode)))
        check("default output path is inside $TMPDIR/dsh-ros2",
              os.path.basename(parent) == "dsh-ros2" and out.endswith(".jpg"), out)

        # 2) a symlink where that directory belongs is REFUSED, not walked through.
        #    (Measured before the fix: os.makedirs(exist_ok=True) followed it.)
        victim = os.path.join(sandbox, "attacker-chosen-dir")
        os.mkdir(victim)
        os.rmdir(parent)
        os.symlink(victim, parent)
        refused = ""
        try:
            prepare_output(default_output())
        except SystemExit as exit_error:
            refused = "exit %s" % exit_error.code
        check("refuses a symlinked default directory (exit 3)", refused == "exit %s" % EXIT_REFUSED, refused)
        os.unlink(parent)
        os.mkdir(parent, 0o700)

        # 3) the bytes land 0600 and never through a planted symlink.
        target_file = os.path.join(parent, "frame.jpg")
        real = os.path.join(sandbox, "ORIGINAL")
        with open(real, "w") as handle:
            handle.write("ORIGINAL")
        os.symlink(real, target_file)
        _save_bytes(target_file, b"JPEGBYTES")
        check("a planted symlink at the output path is replaced, not followed",
              open(real).read() == "ORIGINAL" and not os.path.islink(target_file))
        check("the written frame is 0600",
              _stat.S_IMODE(os.lstat(target_file).st_mode) == 0o600,
              oct(_stat.S_IMODE(os.lstat(target_file).st_mode)))

        # 4) a directory OUTSIDE the anchor keeps the operator's mode (the rule
        #    runtime-dir.ts uses for a configured screenshot directory).
        operator_dir = os.path.join(sandbox, "operator")
        os.mkdir(operator_dir, 0o755)
        explicit_out = prepare_output(os.path.join(operator_dir, "shot.jpg"),
                                     anchor=os.path.join(sandbox, "elsewhere"))
        check("a directory outside the anchor keeps the operator's mode",
              _stat.S_IMODE(os.lstat(operator_dir).st_mode) == 0o755,
              oct(_stat.S_IMODE(os.lstat(operator_dir).st_mode)))
        check("the output path is resolved to an absolute path",
              os.path.isabs(explicit_out), explicit_out)
    finally:
        if saved_tmp is None:
            os.environ.pop("TMPDIR", None)
        else:
            os.environ["TMPDIR"] = saved_tmp
        import shutil
        shutil.rmtree(sandbox, ignore_errors=True)

    print("")
    if failures:
        print("SELFTEST FAILED: " + ", ".join(failures))
        return 1
    print("SELFTEST OK (image_snapshot)")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="grab one frame from a ROS2 image topic")
    ap.add_argument("--topic", default="/camera/image")
    ap.add_argument("--output", default="")
    ap.add_argument("--timeout", type=float, default=5.0)
    ap.add_argument("--compressed", action="store_true")
    ap.add_argument("--v4l", default="")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args(argv)
    if args.selftest:
        return selftest()

    output = prepare_output(args.output or default_output())

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
