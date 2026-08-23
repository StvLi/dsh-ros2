#!/usr/bin/env python3
"""robot_profile.py — register and load robot body profiles (generic).

Collects a new robot's body information into a structured YAML profile
(register) and reads it back as JSON (load / list) so skills can quickly
bring up renders/diagnostics for a known robot without re-discovery.

Profile location: ~/.dsh-ros2/robots/<name>.yaml (--dir overridable).

register collects:
  - URDF: explicit --urdf path, or extracted from the live /robot_description
  - links / joints (parsed from the URDF)
  - image topics (camera list from the graph)
  - MoveIt SRDF: explicit --srdf, or resolved via the package scan
  - zero-pose semantics: read from ~/.dsh-ros2/zero-pose.yaml if calibrated

Usage:
  python3 robot_profile.py register --name <robot> [--urdf <path>] [--srdf <path>] [--description "..."]
  python3 robot_profile.py load --name <robot>
  python3 robot_profile.py list
Output: JSON
"""
import argparse
import glob
import json
import os
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

DEFAULT_DIR = os.path.expanduser("~/.dsh-ros2/robots")
ZERO_POSE = os.path.expanduser("~/.dsh-ros2/zero-pose.yaml")


def ros2(*args, timeout=20):
    try:
        p = subprocess.run(["ros2", *args], capture_output=True, text=True, timeout=timeout)
        return p.returncode == 0, p.stdout, p.stderr
    except Exception:  # noqa: BLE001
        return False, "", ""


def get_live_urdf():
    """Extract the URDF from the live /robot_description topic."""
    import rclpy
    from rclpy.node import Node
    from std_msgs.msg import String
    from rclpy.qos import QoSProfile, DurabilityPolicy
    rclpy.init()
    n = Node("robot_profile_fetch")
    q = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL, reliability=1)
    got = [None]

    def cb(msg):
        got[0] = msg.data

    n.create_subscription(String, "/robot_description", cb, q)
    for _ in range(50):
        rclpy.spin_once(n, timeout_sec=0.1)
        if got[0] is not None:
            break
    n.destroy_node()
    rclpy.shutdown()
    return got[0]


def parse_urdf(urdf_xml: str) -> dict:
    root = ET.fromstring(urdf_xml)
    links = [l.get("name") for l in root.findall("link") if l.get("name")]
    joints = []
    for j in root.findall("joint"):
        name = j.get("name")
        if not name:
            continue
        joints.append({
            "name": name, "type": j.get("type", ""),
            "parent": (j.find("parent").get("link") if j.find("parent") is not None else ""),
            "child": (j.find("child").get("link") if j.find("child") is not None else ""),
        })
    return {"links": links, "joints": joints}


def find_tf_root():
    """Best-effort TF root from tf_static sample (child of the first edge)."""
    ok, out, _ = ros2("topic", "echo", "/tf_static", "--once", "--field", "transforms")
    if ok and out.strip():
        for line in out.splitlines():
            line = line.strip()
            if "child_frame_id" in line:
                return line.split(":", 1)[1].strip().strip("'\"")
    return ""


def list_image_topics():
    ok, out, _ = ros2("topic", "list", "-t")
    if not ok:
        return []
    topics = []
    for line in out.splitlines():
        if "sensor_msgs/msg/Image" in line or "sensor_msgs/msg/CompressedImage" in line:
            topics.append(line.split()[0])
    return sorted(topics)


def resolve_srdf(srdf: str):
    """Resolve an SRDF by path or package scan (reuse of moveit_discover logic)."""
    if srdf:
        return srdf
    ok, out, _ = ros2("pkg", "list")
    if not ok:
        return ""
    for pkg in sorted(out.split()):
        ok2, prefix, _ = ros2("pkg", "prefix", pkg)
        if not ok2:
            continue
        share = os.path.join(prefix.strip(), "share", pkg)
        cands = sorted(glob.glob(os.path.join(share, "config", "*.srdf")))
        if cands:
            return cands[0]
    return ""


def parse_srdf_groups(srdf_path: str) -> dict:
    root = ET.parse(srdf_path).getroot()
    groups = {}
    for g in root.findall("group"):
        name = g.get("name")
        if not name:
            continue
        chain = g.find("chain")
        groups[name] = {
            "type": g.get("type", ""),
            "joints": [j.get("name") for j in g.findall("joint") if j.get("name")],
            "chain_tip": chain.get("tip_link", "") if chain is not None else "",
        }
    return groups


def read_zero_pose() -> dict:
    try:
        import yaml as pyyaml
        with open(ZERO_POSE) as f:
            data = pyyaml.safe_load(f) or {}
        return data.get("zero_pose_semantics", {})
    except Exception:  # noqa: BLE001
        return {}


def register(name: str, urdf: str, srdf: str, description: str) -> dict:
    profile_dir = os.path.dirname(os.path.join(DEFAULT_DIR, name + ".yaml"))
    os.makedirs(profile_dir, exist_ok=True)

    urdf_xml = ""
    if urdf:
        try:
            with open(urdf) as f:
                urdf_xml = f.read()
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": f"cannot read URDF {urdf}: {e}"}
    else:
        urdf_xml = get_live_urdf() or ""
        if not urdf_xml:
            return {"ok": False, "error": "no URDF: pass --urdf or have a live /robot_description"}

    body = parse_urdf(urdf_xml)
    srdf_resolved = resolve_srdf(srdf)
    groups = parse_srdf_groups(srdf_resolved) if srdf_resolved else {}
    zero = read_zero_pose()

    profile = {
        "robot": {
            "name": name,
            "description": description,
            "registered_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "urdf": urdf or "/robot_description (live)",
            "urdf_links": body["links"],
            "joints": body["joints"],
            "tf_root": find_tf_root(),
            "cameras": list_image_topics(),
            "moveit": {
                "srdf": srdf_resolved,
                "groups": groups,
            },
            "zero_pose": zero or {"note": "未校准；可用 ros2_zero_pose_semantics 校准"},
        }
    }
    path = os.path.join(DEFAULT_DIR, f"{name}.yaml")
    with open(path, "w") as f:
        def yaml_str(v):
            return json.dumps(v, ensure_ascii=False)
        f.write(f"# robot body profile (written by dsh-ros2 robot_profile)\n")
        f.write(f"robot:\n")
        f.write(f"  name: {name}\n")
        f.write(f"  description: {yaml_str(description)}\n")
        f.write(f"  registered_at: {profile['robot']['registered_at']}\n")
        f.write(f"  urdf: {yaml_str(profile['robot']['urdf'])}\n")
        f.write(f"  tf_root: {yaml_str(profile['robot']['tf_root'])}\n")
        f.write(f"  cameras: {yaml_str(profile['robot']['cameras'])}\n")
        f.write(f"  urdf_links: {yaml_str(body['links'])}\n")
        f.write(f"  joints: {yaml_str(body['joints'])}\n")
        f.write(f"  moveit:\n")
        f.write(f"    srdf: {yaml_str(srdf_resolved)}\n")
        f.write(f"    groups: {yaml_str(groups)}\n")
        f.write(f"  zero_pose: {yaml_str(zero)}\n")
    return {"ok": True, "written": path, "robot": profile["robot"]}


def load(name: str):
    path = os.path.join(DEFAULT_DIR, f"{name}.yaml")
    if not os.path.exists(path):
        return {"ok": False, "error": f"未找到机器人档案 {name}（可用 robot_profile.py list 查看，或先 register）"}
    try:
        import yaml as pyyaml
        with open(path) as f:
            data = pyyaml.safe_load(f) or {}
        robot = data.get("robot", {})
        # normalise counts for convenience
        if "urdf_links" in robot:
            robot["link_count"] = len(robot["urdf_links"])
        if "joints" in robot:
            robot["joint_count"] = len(robot["joints"])
        return {"ok": True, "robot": robot, "profile_path": path}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"解析档案失败: {e}"}


def list_profiles():
    files = sorted(glob.glob(os.path.join(DEFAULT_DIR, "*.yaml")))
    names = [os.path.basename(f)[: -len(".yaml")] for f in files]
    return {"ok": True, "robots": names, "dir": DEFAULT_DIR}


def main():
    global DEFAULT_DIR
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["register", "load", "list"])
    ap.add_argument("--name", default="")
    ap.add_argument("--urdf", default="")
    ap.add_argument("--srdf", default="")
    ap.add_argument("--description", default="")
    ap.add_argument("--dir", default=DEFAULT_DIR)
    args = ap.parse_args()
    DEFAULT_DIR = args.dir

    if args.action == "register":
        if not args.name:
            print(json.dumps({"ok": False, "error": "register 需要 --name"}))
            return 1
        out = register(args.name, args.urdf, args.srdf, args.description)
    elif args.action == "load":
        if not args.name:
            print(json.dumps({"ok": False, "error": "load 需要 --name"}))
            return 1
        out = load(args.name)
    else:
        out = list_profiles()
    print(json.dumps(out, ensure_ascii=False, default=str))
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
