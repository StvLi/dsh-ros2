#!/usr/bin/env python3
"""Self-test for the L4 `vlm_node` — offline, no ROS2 and no real gateway.

Round 28 landed two fixes in `vlm/scripts/vlm_node`:

  1. `max_tokens` was hard-coded to 512. Gateways that count reasoning tokens
     inside `completion_tokens` spent the whole budget thinking and answered
     with `finish_reason: length`. It is now the `max_tokens` parameter
     (default from `VLM_MAX_TOKENS`, else 2048) and an unusable value falls
     back instead of killing the node at import time.
  2. The ROS_LOG_DIR fallback was `/tmp/ros-log-<uid>` — guessable, created with
     the ambient umask, pre-creatable by another local user (measured at
     `0775`). It is now `mkdtemp` (0700, unpredictable, removed on exit).

This script proves both against the shipped code, not against a paraphrase:
the node module is imported with stub `rclpy`/`dsh_ros2_vlm` modules (the
module-level imports are the only thing that needs them), and `call_vlm()` is
called against a loopback HTTP server that records what was actually sent.

Run: `python3 tests/vlm_node_selftest.py` (wired into the package's `test`).
"""

import http.server
import importlib.util
import json
import os
import shutil
import stat
import sys
import tempfile
import threading
import types

HERE = os.path.dirname(os.path.abspath(__file__))
NODE = os.path.join(HERE, "..", "vlm", "scripts", "vlm_node")

failures = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + name + (f"  [{detail}]" if detail and not ok else ""))
    if not ok:
        failures.append(name)


class _Any:
    """Accept any attribute/constructor call — enough shape for the class body."""

    def __init__(self, *args, **kwargs):
        pass

    def __call__(self, *args, **kwargs):
        return _Any()

    def __getattr__(self, name):
        return _Any()


def stub_ros_modules() -> dict:
    """Install the minimal module graph vlm_node imports, and nothing more."""
    rclpy = types.ModuleType("rclpy")
    rclpy.init = lambda *a, **k: None
    rclpy.shutdown = lambda *a, **k: None
    rclpy.node = types.ModuleType("rclpy.node")
    rclpy.node.Node = type("Node", (), {"__init__": lambda self, *a, **k: None})
    rclpy.executors = types.ModuleType("rclpy.executors")
    rclpy.executors.MultiThreadedExecutor = _Any
    rclpy.qos = types.ModuleType("rclpy.qos")
    for name in ("DurabilityPolicy", "HistoryPolicy", "ReliabilityPolicy"):
        setattr(rclpy.qos, name, _Any())
    rclpy.qos.QoSProfile = _Any

    pkg = types.ModuleType("dsh_ros2_vlm")
    srv = types.ModuleType("dsh_ros2_vlm.srv")
    srv.VlmDescribe = _Any
    msg = types.ModuleType("dsh_ros2_vlm.msg")
    msg.VlmDescription = _Any
    pkg.srv, pkg.msg = srv, msg

    for name, mod in {
        "rclpy": rclpy,
        "rclpy.node": rclpy.node,
        "rclpy.executors": rclpy.executors,
        "rclpy.qos": rclpy.qos,
        "dsh_ros2_vlm": pkg,
        "dsh_ros2_vlm.srv": srv,
        "dsh_ros2_vlm.msg": msg,
    }.items():
        sys.modules[name] = mod
    return sys.modules


def load_node():
    spec = importlib.util.spec_from_loader("vlm_node_under_test", loader=None)
    module = importlib.util.module_from_spec(spec)
    module.__file__ = NODE
    with open(NODE, "r", encoding="utf-8") as fh:
        code = fh.read()
    exec(compile(code, NODE, "exec"), module.__dict__)
    return module


class _Capture(http.server.BaseHTTPRequestHandler):
    body = b""

    def do_POST(self):  # noqa: N802 — http.server API
        length = int(self.headers.get("Content-Length", "0"))
        _Capture.body = self.rfile.read(length)
        _Capture.auth = self.headers.get("Authorization", "")
        payload = json.dumps({
            "choices": [{"message": {"content": "a chair"}}],
            "usage": {"completion_tokens": 12},
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):  # keep the output clean
        pass


def with_capture_server(fn):
    server = http.server.HTTPServer(("127.0.0.1", 0), _Capture)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        return fn(f"http://127.0.0.1:{server.server_address[1]}")
    finally:
        server.shutdown()
        server.server_close()


PNG = bytes.fromhex("89504e470d0a1a0a") + b"\x00\x00\x00\rIHDR" + b"\x00" * 16


def main() -> int:
    print("vlm_node selftest")
    stub_ros_modules()
    node = load_node()

    print(" max_tokens resolution")
    value, warning = node.resolve_max_tokens(None)
    check("default is 2048 (not the old 512)", value == 2048 and warning == "", f"{value!r}")
    check("VLM_MAX_TOKENS override is honoured", node.resolve_max_tokens("4096")[0] == 4096)
    check("blank falls back to the default", node.resolve_max_tokens("   ")[0] == 2048)
    bad, warning = node.resolve_max_tokens("bogus")
    check("a malformed value falls back instead of raising", bad == 2048)
    check("a malformed value is reported", "not an integer" in warning, warning)
    check("a non-positive value falls back", node.resolve_max_tokens("0")[0] == 2048)
    check("a non-positive value is reported", "not positive" in node.resolve_max_tokens("-5")[1])

    print(" what the gateway actually receives")
    def probe(base_url):
        text = node.call_vlm(base_url, "sk-test-key", "gemini-2.5-flash", PNG, "image/png",
                             "what is this?", 2048)
        body = json.loads(_Capture.body.decode("utf-8"))
        check("the answer comes back", text == "a chair")
        check("max_tokens=2048 is sent", body.get("max_tokens") == 2048, str(body.get("max_tokens")))
        check("the image is labelled by content (image/png)", body["messages"][0]["content"][1]["image_url"]["url"].startswith("data:image/png;base64,"))
        check("the key travels in the Authorization header", _Capture.auth == "Bearer sk-test-key")
        check("the key never appears in the body", "sk-test-key" not in _Capture.body.decode("utf-8"))
        # An explicit value still wins (the parameter path).
        node.call_vlm(base_url, "sk-test-key", "m", PNG, "image/png", "p", 64)
        check("an explicit max_tokens overrides the default",
              json.loads(_Capture.body.decode("utf-8")).get("max_tokens") == 64)
    with_capture_server(probe)

    print(" non-image payloads are still refused before any upload")
    tmp = tempfile.mkdtemp(prefix="vlm-selftest-")
    try:
        not_an_image = os.path.join(tmp, "payload.png")  # extension lies on purpose
        with open(not_an_image, "wb") as fh:
            fh.write(b"#!/bin/sh\necho not an image\n")
        mime = node.sniff_image_mime(open(not_an_image, "rb").read(12))
        check("a non-image sniffs as empty (no upload)", mime == "", repr(mime))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print(" ROS_LOG_DIR fallback is private and unpredictable")
    prev_home, prev_logdir, prev_umask = os.environ.get("HOME"), os.environ.get("ROS_LOG_DIR"), os.umask(0o002)
    scratch = tempfile.mkdtemp(prefix="vlm-selftest-home-")
    blocked = os.path.join(scratch, "home")
    os.makedirs(blocked)
    os.chmod(blocked, 0o500)  # an unwritable HOME, as on a locked-down host
    try:
        os.environ.pop("ROS_LOG_DIR", None)
        os.environ["HOME"] = blocked
        node._ensure_ros_log_dir()
        fallback = os.environ.get("ROS_LOG_DIR")
        check("a fallback dir is chosen", bool(fallback), repr(fallback))
        if fallback:
            mode = stat.S_IMODE(os.stat(fallback).st_mode)
            check("the fallback is 0700 even under umask 0002", mode == 0o700, oct(mode))
            check("the fallback is not the guessable /tmp/ros-log-<uid>",
                  fallback != f"/tmp/ros-log-{os.getuid()}", fallback)
            check("the fallback is not a fixed name",
                  "/ros-log-" in fallback and not fallback.endswith(f"ros-log-{os.getuid()}"), fallback)
            shutil.rmtree(fallback, ignore_errors=True)
    finally:
        os.chmod(blocked, 0o700)
        shutil.rmtree(scratch, ignore_errors=True)
        os.umask(prev_umask)
        if prev_home is None:
            os.environ.pop("HOME", None)
        else:
            os.environ["HOME"] = prev_home
        if prev_logdir is None:
            os.environ.pop("ROS_LOG_DIR", None)
        else:
            os.environ["ROS_LOG_DIR"] = prev_logdir

    print(" a configured ROS_LOG_DIR is respected (the plugin judges it TS-side)")
    os.environ["ROS_LOG_DIR"] = "/tmp/does-not-matter"
    before = os.environ["ROS_LOG_DIR"]
    node._ensure_ros_log_dir()
    check("an explicit ROS_LOG_DIR is never rewritten here", os.environ["ROS_LOG_DIR"] == before)
    os.environ.pop("ROS_LOG_DIR", None)

    if failures:
        print(f"SELFTEST FAILED ({len(failures)}): " + ", ".join(failures))
        return 1
    print("SELFTEST OK (vlm_node)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
