#!/usr/bin/env python3
"""zero_pose_semantics.py — calibrate a robot's zero-pose semantics interactively.

Generic (not bound to any robot): publishes the all-zero joint angles, renders
the URDF offscreen, asks the VLM what posture that is, and (on confirm) records
the user-approved semantics for later use by skills (e.g.
robot-state-vision-analysis).

Flow:
  1. analyze: ensure a URDF is available (--urdf file, or the live
     /robot_description_abs topic), publish all-zero joint_states for
     --duration seconds, capture a frame from /rviz/scene (an offscreen
     renderer must already be publishing it), ask the VLM to describe the
     posture, and print a JSON with the description + candidate semantics
     (lateral_raise / arms_hanging / other) for the user to confirm.
  2. confirm: write the user's choice (+ description) to a YAML file
     (~/.dsh-ros2/zero-pose.yaml by default, or --out), which skills/agents
     can read back.

Requires: robot_state_publisher + the offscreen renderer publishing
/rviz/scene + vlm_node (VLM provider). No robot-specific names anywhere.
"""

import argparse
import json
import os
import subprocess
import sys
import threading
import time

CANDIDATES = {
    "lateral_raise": "双臂侧平举、肘窝向前（zero = lateral raise, elbows forward）",
    "arms_hanging": "双臂自然下垂（zero = arms hanging down）",
    "other": "其他（请在描述中说明）",
}


def ros2(*args, timeout=30):
    try:
        p = subprocess.run(["ros2", *args], capture_output=True, text=True, timeout=timeout)
        return p.returncode == 0, p.stdout, p.stderr
    except Exception:  # noqa: BLE001
        return False, "", ""


def ensure_rsp(urdf: str):
    """Ensure a robot_state_publisher is publishing an SRDF-agnostic description."""
    ok, out, _ = ros2("topic", "info", "/robot_description_abs")
    if ok and "Publisher count: 1" in out:
        return True, "/robot_description_abs (already live)"
    if not urdf:
        return False, "no live /robot_description_abs publisher and no --urdf given"
    # spawn a transient-local publisher on a dedicated topic (mirrors the
    # renderer's expectation; stays alive for the calibration duration)
    script = f"""
import rclpy, threading
from rclpy.node import Node
from std_msgs.msg import String
from rclpy.qos import QoSProfile, DurabilityPolicy
rclpy.init(); n = Node('zero_pose_rsp')
q = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL, reliability=1)
p = n.create_publisher(String, '/robot_description_abs', q)
data = open('{urdf}').read()
msg = String(); msg.data = data
def tick():
    p.publish(msg); threading.Timer(1.0, tick).start()
tick(); rclpy.spin(n)
"""
    path = "/tmp/zero_pose_rsp.py"
    with open(path, "w") as f:
        f.write(script)
    subprocess.Popen(["python3", path],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    return True, f"spawned description publisher for {urdf}"


def load_joint_names(urdf: str) -> list[str]:
    """Extract non-fixed joint names from a URDF (used to publish zero joints)."""
    import xml.etree.ElementTree as ET
    try:
        root = ET.parse(urdf).getroot()
        names = []
        for j in root.findall('joint'):
            jtype = j.get('type', '')
            if jtype not in ('fixed', 'floating', 'planar'):
                name = j.get('name')
                if name:
                    names.append(name)
        return names
    except Exception:  # noqa: BLE001
        return []


def publish_zero_joints(duration: float, joint_names: list[str]):
    """Publish all-zero joint_states for `duration` seconds so the renderer
    shows the zero pose (RSP maps missing joints to URDF defaults anyway;
    publishing explicit zeros is the clearest)."""
    names_json = json.dumps(joint_names)
    script = f"""
import rclpy, threading, json
from rclpy.node import Node
from sensor_msgs.msg import JointState
rclpy.init(); n = Node('zero_pose_joints')
p = n.create_publisher(JointState, '/joint_states', 10)
names = json.loads('''{names_json}''')
def tick():
    m = JointState(); m.header.stamp = n.get_clock().now().to_msg()
    m.name = names; m.position = [0.0] * len(names)
    p.publish(m); threading.Timer(0.5, tick).start()
tick()
threading.Timer({duration}, rclpy.shutdown).start()
rclpy.spin(n)
"""
    path = "/tmp/zero_pose_joints.py"
    with open(path, "w") as f:
        f.write(script)
    proc = subprocess.Popen(["python3", path],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return proc


def capture_scene() -> str:
    """Grab the latest /rviz/scene frame to a JPEG via image_snapshot."""
    out_path = f"/tmp/zero_pose_scene_{int(time.time())}.jpg"
    try:
        p = subprocess.run(
            ["ros2", "run", "dsh_ros2_vlm", "image_snapshot", "--ros-args",
             "-p", "topic:=/rviz/scene", "-p", "compressed:=false", "-p", f"output:={out_path}"],
            capture_output=True, text=True, timeout=20,
        )
        # image_snapshot may print a JSON with the path; fall back to the default glob
        if os.path.exists(out_path):
            return out_path
        import glob
        cands = sorted(glob.glob("/tmp/dsh-ros2/snapshot_*.jpg"))
        return cands[-1] if cands else ""
    except Exception:  # noqa: BLE001
        return ""


def ask_vlm(image_path: str) -> str:
    prompt = ("Describe the posture of this robot in one sentence. "
              "Are the arms raised horizontally to the sides (lateral raise), "
              "hanging down, or in some other pose?")
    try:
        p = subprocess.run(
            ["ros2", "run", "dsh_ros2_vlm", "vlm_call", "--ros-args",
             "-p", f"image_path:={image_path}", "-p", f"prompt:={prompt}"],
            capture_output=True, text=True, timeout=90,
        )
        for line in p.stdout.splitlines():
            line = line.strip()
            if line.startswith("{"):
                try:
                    return json.loads(line).get("description", "")
                except Exception:  # noqa: BLE001
                    return line
        return p.stdout.strip()
    except Exception as e:  # noqa: BLE001
        return f"(VLM unavailable: {e})"


def infer_candidate(description: str) -> str:
    d = description.lower()
    if "lateral" in d or "raise" in d or "horizontal" in d or "侧平举" in d:
        return "lateral_raise"
    if "hang" in d or "down" in d and "arm" in d or "下垂" in d:
        return "arms_hanging"
    return "other"


def write_config(choice: str, description: str, out: str) -> str:
    os.makedirs(os.path.dirname(out), exist_ok=True)
    lines = [
        "# zero-pose semantics calibration (written by ros2_zero_pose_semantics)",
        "zero_pose_semantics:",
        f"  choice: {choice}",
        f"  description: \"{description}\"",
        "  method: vlm-render-confirm",
    ]
    with open(out, "w") as f:
        f.write("\n".join(lines) + "\n")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--action", choices=["analyze", "confirm"], required=True)
    ap.add_argument("--urdf", default="", help="URDF file path for the description publisher (if no live one).")
    ap.add_argument("--duration", type=float, default=8.0, help="Seconds to publish all-zero joints.")
    ap.add_argument("--choice", default="", help="confirm: lateral_raise | arms_hanging | other")
    ap.add_argument("--description", default="", help="confirm: description recorded alongside the choice.")
    ap.add_argument("--out", default=os.path.expanduser("~/.dsh-ros2/zero-pose.yaml"), help="confirm: output YAML path.")
    args = ap.parse_args()

    if args.action == "analyze":
        ok, note = ensure_rsp(args.urdf)
        if not ok:
            print(json.dumps({"ok": False, "error": note, "candidates": list(CANDIDATES)}))
            return 1
        # verify an offscreen renderer is publishing /rviz/scene
        ok2, out2, _ = ros2("topic", "info", "/rviz/scene")
        if not (ok2 and "Publisher count: 1" in out2):
            print(json.dumps({"ok": False,
                              "error": "no /rviz/scene publisher (start rviz_offscreen_node first)",
                              "candidates": list(CANDIDATES)}))
            return 1
        proc = publish_zero_joints(args.duration, load_joint_names(args.urdf) if args.urdf else [])
        time.sleep(2.0)  # let TF settle at zero
        image = capture_scene()
        description = ask_vlm(image) if image else "(no frame captured)"
        if proc is not None:
            proc.terminate()
        print(json.dumps({
            "ok": bool(image),
            "description": description,
            "candidate": infer_candidate(description),
            "candidates": list(CANDIDATES),
            "image": image,
            "note": "请与使用者确认后调用 action=confirm 记录语义（choice + description）。",
        }, ensure_ascii=False))
        return 0 if image else 2

    if args.action == "confirm":
        choice = args.choice.strip().lower()
        if choice not in CANDIDATES:
            print(json.dumps({"ok": False, "error": f"choice 必须为 {list(CANDIDATES)}，收到 '{choice}'"}))
            return 1
        path = write_config(choice, args.description or CANDIDATES[choice], args.out)
        print(json.dumps({"ok": True, "written": path, "choice": choice,
                          "description": args.description or CANDIDATES[choice],
                          "candidates": list(CANDIDATES)}))
        return 0


if __name__ == "__main__":
    sys.exit(main())
