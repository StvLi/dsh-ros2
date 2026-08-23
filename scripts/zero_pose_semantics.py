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

# Structured zero-pose semantics: three orthogonal aspects whose combos
# cover the common descriptions, plus a free-text custom fallback.
ARMS = {"lateral_raise": "臂侧平举", "hanging": "臂自然下垂"}
ELBOWS = {"forward": "肘弯向前", "upward": "肘弯向上"}
PALMS = {"up": "手掌/相机支架向上", "forward": "手掌/相机支架向前", "down": "手掌/相机支架向下"}
COMBOS = [(a, e, p) for a in ARMS for e in ELBOWS for p in PALMS]  # 12 combos


def combo_label(arm, elbow, palm):
    return f"{ARMS[arm]} + {ELBOWS[elbow]} + {PALMS[palm]}"


def candidates_list():
    return [{"arm": a, "elbow": e, "palm": p, "label": combo_label(a, e, p)} for a, e, p in COMBOS]


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


def infer_combo(description: str) -> dict:
    d = description.lower()
    arm = "lateral_raise" if any(k in d for k in ("lateral", "raise", "horizontal", "out to the side", "侧平举")) else "hanging"
    elbow = "upward" if any(k in d for k in ("elbow up", "elbows up", "bent up", "肘弯向上", "肘向上")) else "forward"
    palm = "forward" if any(k in d for k in ("palm forward", "forward-facing", "手掌向前", "朝前")) else "up"
    if any(k in d for k in ("palm down", "palm facing down", "手掌向下", "朝下")):
        palm = "down"
    return {"arm": arm, "elbow": elbow, "palm": palm}


def write_config(spec: dict, out: str) -> str:
    os.makedirs(os.path.dirname(out), exist_ok=True)
    lines = [
        "# zero-pose semantics calibration (written by ros2_zero_pose_semantics)",
        "zero_pose_semantics:",
        f"  method: {spec.get('method', 'vlm-render-confirm')}",
    ]
    if spec.get("custom"):
        lines.append("  custom: true")
        lines.append(f"  description: \"{spec['description']}\"")
    else:
        lines.append("  custom: false")
        lines.append(f"  arm: {spec['arm']}    # {ARMS[spec['arm']]}")
        lines.append(f"  elbow: {spec['elbow']}  # {ELBOWS[spec['elbow']]}")
        lines.append(f"  palm: {spec['palm']}    # {PALMS[spec['palm']]}")
        lines.append(f"  description: \"{spec['description']}\"")
    with open(out, "w") as f:
        f.write("\n".join(lines) + "\n")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--action", choices=["analyze", "confirm"], required=True)
    ap.add_argument("--urdf", default="", help="URDF file path for the description publisher (if no live one).")
    ap.add_argument("--duration", type=float, default=8.0, help="Seconds to publish all-zero joints.")
    ap.add_argument("--arm", default="", choices=["lateral_raise", "hanging"],
                    help="confirm: arm aspect (lateral_raise | hanging).")
    ap.add_argument("--elbow", default="", choices=["forward", "upward"],
                    help="confirm: elbow aspect (forward | upward).")
    ap.add_argument("--palm", default="", choices=["up", "forward", "down"],
                    help="confirm: palm/camera-mount aspect (up | forward | down).")
    ap.add_argument("--custom-text", default="",
                    help="confirm: free-text custom description (ignores arm/elbow/palm).")
    ap.add_argument("--out", default=os.path.expanduser("~/.dsh-ros2/zero-pose.yaml"), help="confirm: output YAML path.")
    args = ap.parse_args()

    if args.action == "analyze":
        ok, note = ensure_rsp(args.urdf)
        if not ok:
            print(json.dumps({"ok": False, "error": note, "candidates": candidates_list()}))
            return 1
        # verify an offscreen renderer is publishing /rviz/scene
        ok2, out2, _ = ros2("topic", "info", "/rviz/scene")
        if not (ok2 and "Publisher count: 1" in out2):
            print(json.dumps({"ok": False,
                              "error": "no /rviz/scene publisher (start rviz_offscreen_node first)",
                              "candidates": candidates_list()}))
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
            "inferred": infer_combo(description),
            "candidates": candidates_list(),
            "image": image,
            "note": "请与使用者确认后调用 action=confirm 记录语义（choice + description）。",
        }, ensure_ascii=False))
        return 0 if image else 2

    if args.action == "confirm":
        if args.custom_text:
            spec = {"custom": True, "description": args.custom_text, "method": "vlm-render-confirm"}
        else:
            if not (args.arm and args.elbow and args.palm):
                print(json.dumps({"ok": False, "error": "confirm 需 arm + elbow + palm（或 custom-text 自定义描述）",
                                  "candidates": candidates_list()}))
                return 1
            spec = {
                "custom": False,
                "arm": args.arm, "elbow": args.elbow, "palm": args.palm,
                "description": combo_label(args.arm, args.elbow, args.palm),
                "method": "vlm-render-confirm",
            }
        path = write_config(spec, args.out)
        print(json.dumps({"ok": True, "written": path, **spec}))
        return 0


if __name__ == "__main__":
    sys.exit(main())
