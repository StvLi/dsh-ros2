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
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import threading
import time


def _load_private_paths():
    """Import the shared owner-private criterion from dsh-ros2-common.

    A sibling package, so the path is resolved from this file. Deliberately NOT
    a silent fallback: if the module cannot be found the privacy criteria would
    quietly disappear, which is exactly the failure mode round 26 is about, so
    this fails loud instead.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    packages = os.path.dirname(os.path.dirname(here))  # <…>/packages or node_modules
    candidates = [
        here,  # co-located (defensive)
        os.path.join(packages, "common", "scripts"),          # monorepo
        os.path.join(packages, "dsh-ros2-common", "scripts"),  # installed tree
    ]
    for candidate in candidates:
        target = os.path.join(candidate, "private_paths.py")
        if os.path.isfile(target):
            spec = importlib.util.spec_from_file_location("private_paths", target)
            if spec is None or spec.loader is None:  # pragma: no cover
                continue
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
    raise ImportError("private_paths.py not found (looked in: %s)" % ", ".join(candidates))


private_paths = _load_private_paths()

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


def build_rsp_args(urdf_xml: str) -> list[str]:
    """argv for robot_state_publisher carrying the URDF description.

    Pure (no side effects) so the injection contract is testable: the URDF XML
    is ONE argv element and `bash`/`-lc` never appear. URDF content is
    user/agent-controlled, so it must never be interpolated into a shell string.
    """
    return ["ros2", "run", "robot_state_publisher", "robot_state_publisher",
            "--ros-args",
            "-p", f"robot_description:={urdf_xml}",
            "-r", "/robot_description:=/robot_description_abs"]


def ensure_rsp(urdf: str):
    """Ensure a robot_state_publisher is publishing the description + TF
    (TF is what places the meshes; the zero-pose joint states feed it)."""
    ok, out, _ = ros2("topic", "info", "/robot_description_abs")
    if ok and "Publisher count: 1" in out:
        return True, "/robot_description_abs (already live)"
    if not urdf:
        return False, "no live /robot_description_abs publisher and no --urdf given"
    # spawn robot_state_publisher with the URDF, remap description to the
    # topic the renderer reads; it subscribes /joint_states for the TF.
    try:
        urdf_xml = open(urdf).read()
    except Exception as e:  # noqa: BLE001
        return False, f"cannot read URDF '{urdf}': {e}"
    proc = subprocess.Popen(build_rsp_args(urdf_xml),
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.0)
    return True, f"spawned robot_state_publisher for {urdf} (pid {proc.pid})"


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


def build_zero_pose_joints_script(duration: float) -> str:
    """Source of the joint publisher child. Joint names are NOT part of it:
    they arrive as one argv element (JSON) and are parsed at runtime, so a
    name containing `'''` or newlines cannot break out of the generated code."""
    return f"""
import rclpy, threading, json, sys
from rclpy.node import Node
from sensor_msgs.msg import JointState
rclpy.init(); n = Node('zero_pose_joints')
p = n.create_publisher(JointState, '/joint_states', 10)
names = json.loads(sys.argv[1])
def tick():
    m = JointState(); m.header.stamp = n.get_clock().now().to_msg()
    m.name = names; m.position = [0.0] * len(names)
    p.publish(m); threading.Timer(0.5, tick).start()
tick()
threading.Timer({duration}, rclpy.shutdown).start()
rclpy.spin(n)
"""


def private_scratch_dir() -> str:
    """A fresh 0700 directory for this run's scratch files.

    `mkdtemp` is the answer to "a fixed path in a 1777 directory": it creates the
    directory atomically with a random name and mode 0700, so nobody can
    pre-create or predict it. Round 26 measured what a fixed path cost here: a
    symlink planted at `/tmp/zero_pose_joints.py` redirected the write below
    (the link target was overwritten) and the path was then handed to
    `python3` — i.e. the executed file was never proven to be the file just
    written.
    """
    return tempfile.mkdtemp(prefix="dsh-ros2-zero-pose-")


def publish_zero_joints(duration: float, joint_names: list[str], scratch_dir: str = ""):
    """Publish all-zero joint_states for `duration` seconds so the renderer
    shows the zero pose (RSP maps missing joints to URDF defaults anyway;
    publishing explicit zeros is the clearest).

    The helper script lives in a fresh private directory (0700) and is written
    through `write_private_file` (0600, atomic, does not follow a symlink)."""
    workdir = scratch_dir or private_scratch_dir()
    path = os.path.join(workdir, "zero_pose_joints.py")
    private_paths.write_private_file(path, build_zero_pose_joints_script(duration))
    proc = subprocess.Popen(["python3", path, json.dumps(joint_names)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return proc

def capture_scene(scratch_dir: str = "") -> str:
    """Grab the latest /rviz/scene frame to a JPEG via image_snapshot."""
    workdir = scratch_dir or private_scratch_dir()
    out_path = os.path.join(workdir, "zero_pose_scene.jpg")
    try:
        p = subprocess.run(
            ["ros2", "run", "dsh_ros2_vlm", "image_snapshot", "--ros-args",
             "-p", "topic:=/rviz/scene", "-p", "compressed:=false", "-p", f"output:={out_path}"],
            capture_output=True, text=True, timeout=20,
        )
        # image_snapshot may print a JSON with the path; fall back to the plugin's
        # own (0700, round-26) capture directory
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
    # The zero-pose file is read back by skills to decide what "all joints at 0"
    # means, so it gets the same treatment as a robot profile (round 26): prove
    # the directory is ours, then write 0600 atomically without following a link.
    parent = os.path.dirname(os.path.abspath(out))
    if parent:
        os.makedirs(parent, exist_ok=True)
        private_paths.ensure_private_dir(parent, label="零位语义目录")
    lines = [
        "# zero-pose semantics calibration (written by ros2_zero_pose_semantics)",
        "zero_pose_semantics:",
        f"  method: {spec.get('method', 'vlm-render-confirm')}",
    ]
    if spec.get("custom"):
        lines.append("  custom: true")
        lines.append(f"  description: {json.dumps(str(spec['description']), ensure_ascii=False)}")
    else:
        lines.append("  custom: false")
        lines.append(f"  arm: {spec['arm']}    # {ARMS[spec['arm']]}")
        lines.append(f"  elbow: {spec['elbow']}  # {ELBOWS[spec['elbow']]}")
        lines.append(f"  palm: {spec['palm']}    # {PALMS[spec['palm']]}")
        # JSON string is a valid double-quoted YAML scalar: quotes / newlines /
        # backslashes in a free-text description cannot inject extra YAML keys.
        lines.append(f"  description: {json.dumps(str(spec['description']), ensure_ascii=False)}")
    private_paths.write_private_file(out, "\n".join(lines) + "\n")
    return out

def selftest() -> int:
    """Pure-Python regression checks (no ROS): run in CI via the profile package
    `test` script. Guards the injection hardening applied in the 2026-09-11
    maintenance round (shell-free robot_state_publisher launch, argv-passed
    joint names, JSON-quoted YAML description)."""
    import stat as _stat
    import tempfile
    failures: list[str] = []

    def check(name: str, cond: bool, detail: str = "") -> None:
        print(f"  {'PASS' if cond else 'FAIL'}  {name}" + ("" if cond else f"  {detail}"))
        if not cond:
            failures.append(name)

    # 1) URDF XML stays ONE argv element; no shell wrapper is ever built.
    hostile_xml = '</robot><x>"; touch /tmp/zps_pwned; echo "</x>'
    args = build_rsp_args(hostile_xml)
    check("build_rsp_args never uses a shell", "bash" not in args and "-lc" not in args, repr(args))
    check("build_rsp_args keeps the URDF as one element",
          f"robot_description:={hostile_xml}" in args, repr(args))

    # 2) generated joint publisher carries no joint names in its source.
    script = build_zero_pose_joints_script(8.0)
    check("joint script reads names from argv", "sys.argv[1]" in script)
    check("joint script embeds no names", "'''" not in script)

    # 3) a hostile free-text description cannot inject YAML keys.
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "zero-pose.yaml")
        hostile = 'x"\n  injected: true\n#'
        write_config({"custom": True, "description": hostile, "method": "selftest"}, out)
        raw = open(out).read()
        desc_lines = [ln for ln in raw.splitlines() if ln.startswith("  description: ")]
        parsed = json.loads(desc_lines[0][len("  description: "):]) if len(desc_lines) == 1 else None
        injected = [ln for ln in raw.splitlines() if ln.strip().startswith("injected:")]
        check("write_config keeps the description on one escaped line",
              len(desc_lines) == 1 and parsed == hostile, raw)
        check("write_config cannot inject a YAML key", not injected, raw)
        # round 26: the file is read back by skills, so it must be owner-private.
        check("write_config writes 0600",
              _stat.S_IMODE(os.lstat(out).st_mode) == 0o600,
              oct(_stat.S_IMODE(os.lstat(out).st_mode)))

    # 4) round 26: the joints helper must not live at a predictable path in the
    #    world-writable temp root. Before the fix it was written to the FIXED
    #    `/tmp/zero_pose_joints.py` with `open(…, "w")` and then executed: a
    #    planted symlink redirected the write (measured) and `python3` was handed
    #    a path nobody had proven was the file just written.
    scratch = private_scratch_dir()
    try:
        check("the scratch dir is private (0700)",
              _stat.S_IMODE(os.lstat(scratch).st_mode) == 0o700)
        check("the scratch dir is unique per run (mkdtemp)", private_scratch_dir() != scratch)
        helper = os.path.join(scratch, "zero_pose_joints.py")
        private_paths.write_private_file(helper, build_zero_pose_joints_script(1.0))
        check("the joints helper is 0600",
              _stat.S_IMODE(os.lstat(helper).st_mode) == 0o600)
        # (No assertion about /tmp/zero_pose_joints.py itself: that is host
        # state left by an OLD version, not something this code controls. The
        # wiring assertions below are the ones that pin the behaviour.)
        # A symlink planted at the helper path is replaced, never followed.
        victim = os.path.join(scratch, "victim.txt")
        with open(victim, "w") as handle:
            handle.write("ORIGINAL")
        planted = os.path.join(scratch, "planted.py")
        os.symlink(victim, planted)
        private_paths.write_private_file(planted, "NEW CONTENT\n")
        check("a planted symlink cannot redirect the helper write",
              open(victim).read() == "ORIGINAL", open(victim).read())
    finally:
        import shutil
        shutil.rmtree(scratch, ignore_errors=True)

    # 5) round 26: the WIRING, not just the helpers. Stub `Popen` and look at the
    #    argv `publish_zero_joints` was about to execute: the path must not be a
    #    fixed coordinate in the temp root, must live in an owner-only directory,
    #    and must be the file that was just written (not a link to elsewhere).
    #    Reverting the wiring to `open("/tmp/zero_pose_joints.py", "w")` turns
    #    these red — that is why they assert on the real function.
    real_popen = subprocess.Popen
    seen: dict = {}

    class _FakeProc:  # minimal stand-in: publish_zero_joints only returns it
        pid = 0

        def terminate(self):
            seen["terminated"] = True

    def _fake_popen(argv, **_kwargs):
        seen["argv"] = list(argv)
        return _FakeProc()

    subprocess.Popen = _fake_popen
    try:
        proc = publish_zero_joints(0.5, ["j1"])
    finally:
        subprocess.Popen = real_popen
    argv = seen.get("argv", [])
    executed = argv[1] if len(argv) > 1 else ""
    check("publish_zero_joints does not execute the old fixed /tmp path",
          executed != "/tmp/zero_pose_joints.py", executed)
    check("publish_zero_joints executes a file inside an owner-only directory",
          bool(executed)
          and _stat.S_IMODE(os.lstat(os.path.dirname(executed)).st_mode) == 0o700,
          executed)
    check("the executed helper is a 0600 regular file",
          bool(executed) and os.path.isfile(executed) and not os.path.islink(executed)
          and _stat.S_IMODE(os.lstat(executed).st_mode) == 0o600)
    check("the executed path is already resolved (no link to rewrite)",
          bool(executed) and os.path.realpath(executed) == executed, executed)
    if proc is not None:
        proc.terminate()
    # Only ever remove a scratch directory THIS module created. During the
    # gate-removal run the reverted wiring reported `/tmp/zero_pose_joints.py`,
    # whose parent is `/tmp` — a cleanup that trusts that path deletes the temp
    # root. Guard on the mkdtemp prefix instead of trusting the path under test.
    if executed:
        parent = os.path.dirname(executed)
        if os.path.basename(parent).startswith("dsh-ros2-zero-pose-"):
            import shutil as _shutil
            _shutil.rmtree(parent, ignore_errors=True)

    if failures:
        print(f"SELFTEST FAILED: {len(failures)} check(s): {', '.join(failures)}")
        return 1
    print("SELFTEST OK (zero_pose_semantics)")
    return 0


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
        # One 0700 scratch directory per run (mkdtemp): the helper script and the
        # rendered frame live in it, so no fixed coordinate in the 1777 temp root
        # is ever written or executed. Kept afterwards for diagnosis, like the
        # frame this tool has always left behind — the path is reported below.
        scratch = private_scratch_dir()
        proc = publish_zero_joints(args.duration,
                                   load_joint_names(args.urdf) if args.urdf else [],
                                   scratch)
        try:
            time.sleep(2.0)  # let TF settle at zero
            image = capture_scene(scratch)
            description = ask_vlm(image) if image else "(no frame captured)"
        finally:
            if proc is not None:
                proc.terminate()
        print(json.dumps({
            "ok": bool(image),
            "description": description,
            "inferred": infer_combo(description),
            "candidates": candidates_list(),
            "image": image,
            "scratch_dir": scratch,
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
    if "--selftest" in sys.argv[1:]:
        sys.exit(selftest())
    sys.exit(main())
