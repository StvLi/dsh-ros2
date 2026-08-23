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
        entry = {
            "name": name, "type": j.get("type", ""),
            "parent": (j.find("parent").get("link") if j.find("parent") is not None else ""),
            "child": (j.find("child").get("link") if j.find("child") is not None else ""),
        }
        # per-joint limits from the URDF <limit> element — the source of
        # truth for motion_validator (position/velocity/effort bounds)
        lim = j.find("limit")
        if lim is not None:
            def _num(key):
                try:
                    v = float(lim.get(key))
                    return v
                except (TypeError, ValueError):
                    return None
            entry["limits"] = {
                "lower": _num("lower"), "upper": _num("upper"),
                "velocity": _num("velocity"), "effort": _num("effort"),
                "continuous": j.get("type") == "continuous",
            }
        joints.append(entry)
    return {"links": links, "joints": joints}


def parse_urdf_limits(urdf_xml: str) -> dict:
    """Per-joint velocity/effort limits from the URDF (seed values for the
    `safety` section; downstream may recalibrate)."""
    root = ET.fromstring(urdf_xml)
    limits = {"max_velocity": {}, "max_effort": {}}
    for j in root.findall("joint"):
        name = j.get("name")
        lim = j.find("limit")
        if not name or lim is None:
            continue
        try:
            vel = float(lim.get("velocity"))
            if vel > 0:
                limits["max_velocity"][name] = vel
        except (TypeError, ValueError):
            pass
        try:
            eff = float(lim.get("effort"))
            if eff > 0:
                limits["max_effort"][name] = eff
        except (TypeError, ValueError):
            pass
    return limits


def default_safety(limits: dict) -> dict:
    """Generic minimal `safety` section written at registration. All values
    are overridable afterwards via `safety set` (L2 approval at tool layer).
    See docs/safety-handover.md §4.1 for the full schema."""
    return {
        "enabled": True,
        "control_frequency": 200,
        "checkers": ["motion", "feedback_loss", "watchdog"],
        "lock_action": "zero_velocity",  # minimal; robots may register damping/compliant
        "lock_topic": "/safety/lock_active",
        "feedback": {
            "joint_state_topic": "/joint_states",
            "torque_topic": "",          # empty = torque disabled until configured
            "timeout_ms": 100,
        },
        "motion": {
            "command_topic": "",         # empty = tracking/stall disabled (no command stream)
            "tracking_error_rad": 0.05,
            "stall": {"window_ms": 200, "min_cmd_vel": 0.02, "max_actual_vel": 0.005},
            "hysteresis": {"min_frames": 3, "window": 5},
            "max_velocity": limits.get("max_velocity", {}),
            "max_acceleration": {},
        },
        "torque": {
            "enabled": True,
            "abs_limit": limits.get("max_effort", {}),
            "dtau_limit": {},
            "overload_ms": 500,
            "feedforward_topic": "",     # 预留：计算力矩前馈（下游接入）
        },
        "watchdog": {
            "critical_topics": [],       # 例: [{"topic": "/controller/status", "timeout_ms": 1000}]
            "observed_topics": [],       # 非关键：掉线仅 WARNING，不锁
            "critical_nodes": [],        # 例: ["controller_manager"]
            "observed_nodes": [],
            "node_scan_sec": 5.0,
        },
        "semantic": {
            "enabled": True,
            "trigger_on": ["plan_change", "tracking_error", "stall", "feedback_loss",
                           "watchdog_critical", "torque_spike", "torque_overload"],
        },
        "forensics": {
            "ring_buffer_s": 5,
            "dump_dir": "~/.dsh-ros2/safety-events",
        },
        # pre-execution motion validation (motion_validator, see safety-todo.md)
        "max_state_age_ms": 500,
        "validation_ttl_ms": 2000,
        "workspace": {},              # 可选策略边界: {x:[lo,hi], y:[...], z:[...]}（pose 目标）
        "execution": {"max_duration_ms": 30000},
        "require_controller_ready": True,
        "require_post_execution_verification": True,
        "require_limits": False,      # 未注册/无限位时：False=警告跳过；True=fail-closed
        "estop": {"enabled": False, "path": ""},  # 仅接口，不实现（后续定义）
    }


KNOWN_LOCK_ACTIONS = {"zero_velocity", "damping"}
KNOWN_CAUSES = {"plan_change", "tracking_error", "stall", "feedback_loss",
                "watchdog_critical", "watchdog_observed", "torque_spike",
                "torque_overload", "semantic_unsafe"}


def validate_safety(cfg) -> list:
    """Schema sanity check; returns a list of human-readable problems
    (empty = OK). Does not enforce policy — just shape."""
    problems = []
    if not isinstance(cfg, dict):
        return ["safety 段必须是对象"]
    if cfg.get("lock_action") not in KNOWN_LOCK_ACTIONS:
        problems.append("lock_action 应为 zero_velocity|damping，实际 {}".format(cfg.get("lock_action")))
    try:
        float(cfg.get("control_frequency", 200))
    except (TypeError, ValueError):
        problems.append("control_frequency 必须是数字")
    fb = cfg.get("feedback") or {}
    if not isinstance(fb.get("joint_state_topic", ""), str) or not fb.get("joint_state_topic"):
        problems.append("feedback.joint_state_topic 必填")
    for cause in cfg.get("semantic", {}).get("trigger_on", []):
        if cause not in KNOWN_CAUSES:
            problems.append("未知触发原因: {}".format(cause))
    for key in ("critical_topics", "observed_topics"):
        for e in cfg.get("watchdog", {}).get(key, []):
            if not e.get("topic"):
                problems.append("watchdog.{} 条目缺少 topic".format(key))
    # pre-execution validation fields (motion_validator)
    for num_key in ("max_state_age_ms", "validation_ttl_ms"):
        try:
            float(cfg.get(num_key, 0))
        except (TypeError, ValueError):
            problems.append("{} 必须是数字".format(num_key))
    try:
        float((cfg.get("execution") or {}).get("max_duration_ms", 0))
    except (TypeError, ValueError):
        problems.append("execution.max_duration_ms 必须是数字")
    ws = cfg.get("workspace") or {}
    if ws and not isinstance(ws, dict):
        problems.append("workspace 必须是 {x:[lo,hi], y:[...], z:[...]}")
    for axis, bounds in (ws or {}).items():
        if not (isinstance(bounds, (list, tuple)) and len(bounds) == 2):
            problems.append("workspace.{} 需为 [lo, hi]".format(axis))
    return problems


def read_profile_yaml(name: str):
    """Read a profile file and return (raw dict, path) or raise."""
    path = os.path.join(DEFAULT_DIR, f"{name}.yaml")
    if not os.path.exists(path):
        raise FileNotFoundError(f"未找到机器人档案 {name}")
    import yaml as pyyaml
    with open(path) as f:
        data = pyyaml.safe_load(f) or {}
    return data, path


def safety_show(name: str) -> dict:
    data, path = read_profile_yaml(name)
    robot = data.get("robot", {})
    safety = robot.get("safety", {})
    problems = validate_safety(safety) if safety else ["safety 段缺失（可用 register 或 safety set 补齐）"]
    return {"ok": True, "robot": name, "safety": safety, "problems": problems,
            "profile_path": path}


def safety_set(name: str, key: str, value_json: str) -> dict:
    """Set one dotted safety key, e.g. key=feedback.torque_topic value='"..."'
    or key=watchdog.critical_nodes value='[{"topic": "/x", "timeout_ms": 1000}]'.
    Validates the result before writing (same merge pattern as topo_learn)."""
    import yaml as pyyaml
    data, path = read_profile_yaml(name)
    robot = data.setdefault("robot", {})
    safety = robot.setdefault("safety", default_safety({"max_velocity": {}, "max_effort": {}}))
    try:
        value = json.loads(value_json)
    except json.JSONDecodeError as e:
        return {"ok": False, "error": f"value 必须是合法 JSON: {e}"}
    parts = key.split(".")
    node = safety
    for p in parts[:-1]:
        node = node.setdefault(p, {})
    node[parts[-1]] = value
    problems = validate_safety(safety)
    if problems:
        return {"ok": False, "error": "safety 校验失败: " + "; ".join(problems)}
    with open(path, "w") as f:
        f.write(f"# robot body profile (written by dsh-ros2 robot_profile)\n")
        pyyaml.safe_dump(data, f, allow_unicode=True, sort_keys=False)
    return {"ok": True, "robot": name, "key": key, "value": value,
            "problems": validate_safety(safety), "profile_path": path}


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


# ── topology: 聚合层快照 + 渐进式重要节点学习（严格结构化）───────────────
# Trade-off: 不全量深挖（机器人复杂后冗杂），也不一无所知——snapshot 记录聚合层
# （节点/话题/服务清单），learn 使用中逐步记录"重要节点"的功能与连接（固定 schema）。

TOPO_SCHEMA_NODE = ["name", "role", "description", "pub", "sub", "srv", "act", "learned_at"]


def _profile_path(name):
    return os.path.join(DEFAULT_DIR, f"{name}.yaml")


def _read_profile(name):
    import yaml as pyyaml
    path = _profile_path(name)
    if not os.path.exists(path):
        return None, None
    with open(path) as f:
        data = pyyaml.safe_load(f) or {}
    return data, path


def topo_snapshot(name: str) -> dict:
    """聚合层快照：节点/话题/服务清单（轻量，不逐节点深挖）。"""
    data, path = _read_profile(name)
    if data is None:
        return {"ok": False, "error": f"未找到档案 {name}（先 register）"}
    nodes = []
    ok, out, _ = ros2("node", "list")
    if ok:
        nodes = [l.strip() for l in out.splitlines() if l.strip()]
    topics = []
    ok2, out2, _ = ros2("topic", "list", "-t")
    if ok2:
        topics = sorted({l.split()[0] for l in out2.splitlines() if l.strip()})
    services = []
    ok3, out3, _ = ros2("service", "list")
    if ok3:
        services = sorted({l.strip() for l in out3.splitlines() if l.strip()})
    snapshot = {
        "nodes": nodes,
        "topics": topics,
        "services": services,
        "snapshot_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    robot = data.setdefault("robot", {})
    robot.setdefault("topology", {})["snapshot"] = snapshot
    # 保留已学习节点
    robot["topology"].setdefault("nodes", {})
    with open(path, "w") as f:
        f.write(f"# robot body profile (written by dsh-ros2 robot_profile)\n")
        import yaml as pyyaml
        pyyaml.safe_dump(data, f, allow_unicode=True, sort_keys=False)
    return {"ok": True, "snapshot": snapshot, "learned_nodes": len(robot["topology"]["nodes"])}


def topo_learn(name: str, node: str, role: str, description: str,
               pub: str = "", sub: str = "", srv: str = "", act: str = "") -> dict:
    """记录/更新一个重要节点的功能与拓扑连接（严格 schema，幂等合并）。"""
    data, path = _read_profile(name)
    if data is None:
        return {"ok": False, "error": f"未找到档案 {name}（先 register）"}
    robot = data.setdefault("robot", {})
    topo = robot.setdefault("topology", {})
    nodes = topo.setdefault("nodes", {})
    entry = {
        "name": node,
        "role": role,
        "description": description,
        "pub": [t for t in pub.split(",") if t.strip()],
        "sub": [t for t in sub.split(",") if t.strip()],
        "srv": [t for t in srv.split(",") if t.strip()],
        "act": [t for t in act.split(",") if t.strip()],
        "learned_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    nodes[node] = entry
    with open(path, "w") as f:
        f.write(f"# robot body profile (written by dsh-ros2 robot_profile)\n")
        import yaml as pyyaml
        pyyaml.safe_dump(data, f, allow_unicode=True, sort_keys=False)
    return {"ok": True, "node": entry, "learned_nodes": len(nodes)}


def topo_show(name: str) -> dict:
    """输出档案拓扑：已学习节点（含功能）+ 最近聚合快照概要。"""
    data, path = _read_profile(name)
    if data is None:
        return {"ok": False, "error": f"未找到档案 {name}（先 register）"}
    topo = data.get("robot", {}).get("topology", {})
    snapshot = topo.get("snapshot", {})
    return {
        "ok": True,
        "learned_nodes": topo.get("nodes", {}),
        "snapshot_summary": {
            "nodes": len(snapshot.get("nodes", [])),
            "topics": len(snapshot.get("topics", [])),
            "services": len(snapshot.get("services", [])),
            "snapshot_at": snapshot.get("snapshot_at", ""),
        },
        "profile_path": path,
    }


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
    limits = parse_urdf_limits(urdf_xml)
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
            "safety": default_safety(limits),
        }
    }
    path = os.path.join(DEFAULT_DIR, f"{name}.yaml")
    with open(path, "w") as f:
        import yaml as pyyaml
        f.write(f"# robot body profile (written by dsh-ros2 robot_profile)\n")
        pyyaml.safe_dump(profile, f, allow_unicode=True, sort_keys=False)
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
    ap.add_argument("action", choices=["register", "load", "list", "topology", "safety"])
    ap.add_argument("--name", default="")
    ap.add_argument("--urdf", default="")
    ap.add_argument("--srdf", default="")
    ap.add_argument("--topology-action", default="show", choices=["snapshot", "learn", "show"])
    ap.add_argument("--safety-action", default="show", choices=["show", "set"])
    ap.add_argument("--key", default="")
    ap.add_argument("--value", default="")
    ap.add_argument("--node", default="")
    ap.add_argument("--role", default="")
    ap.add_argument("--pub", default="")
    ap.add_argument("--sub", default="")
    ap.add_argument("--srv", default="")
    ap.add_argument("--act", default="")
    ap.add_argument("--description", default="")
    ap.add_argument("--dir", default=DEFAULT_DIR)
    args = ap.parse_args()
    DEFAULT_DIR = args.dir

    if args.action == "safety":
        if not args.name:
            print(json.dumps({"ok": False, "error": "safety 需要 --name"}))
            return 1
        if args.safety_action == "set":
            if not args.key or not args.value:
                print(json.dumps({"ok": False, "error": "safety set 需要 --key 与 --value（value 为 JSON）"}))
                return 1
            out = safety_set(args.name, args.key, args.value)
        else:
            out = safety_show(args.name)
    elif args.action == "topology":
        topo_action = args.topology_action
        if topo_action == "snapshot":
            out = topo_snapshot(args.name)
        elif topo_action == "learn":
            if not (args.name and args.node):
                print(json.dumps({"ok": False, "error": "topology learn 需要 --name 与 --node"}))
                return 1
            out = topo_learn(args.name, args.node, args.role, args.description,
                             args.pub, args.sub, args.srv, args.act)
        else:  # show
            out = topo_show(args.name)
    elif args.action == "register":
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
