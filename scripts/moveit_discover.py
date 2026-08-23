#!/usr/bin/env python3
"""moveit_discover.py — discover MoveIt2 config packages and their callable interfaces.

Generic: not bound to any specific MoveIt package. Finds packages that ship an
SRDF (the MoveIt config convention: share/<pkg>/config/*.srdf), parses planning
groups and named states, and probes whether the standard move_group interfaces
(/move_action, /execute_trajectory, /compute_cartesian_path) are online.

Usage:
  python3 moveit_discover.py [--package <name>] [--srdf <path>]
Output: JSON on stdout:
{
  "packages": [ { "package", "srdf", "groups": {name: {type, joints[]}},
                  "named_states": {group: {name: {joint: value}}} } ],
  "online": { "move_action": bool, "execute_trajectory": bool,
              "compute_cartesian_path": bool, "controller_manager": bool },
  "srdf_given": <path or null>, "groups": {...}, "named_states": {...}   # when --srdf
}
"""
import argparse
import glob
import json
import os
import sys
import xml.etree.ElementTree as ET


def parse_srdf(path):
    """Return {groups: {name: {type, joints[]}}, named_states: {group: {name: {joint: value}}}}."""
    root = ET.parse(path).getroot()
    groups = {}
    for group in root.findall('group'):
        name = group.get('name')
        if not name:
            continue
        joints = [j.get('name') for j in group.findall('joint') if j.get('name')]
        groups[name] = {'type': group.get('type', ''), 'joints': joints}
    named_states = {}
    for gs in root.findall('group_state'):
        group = gs.get('group')
        name = gs.get('name')
        if not group or not name:
            continue
        joints = {
            j.get('name'): float(j.get('value'))
            for j in gs.findall('joint')
            if j.get('name') is not None and j.get('value') is not None
        }
        named_states.setdefault(group, {})[name] = joints
    return {'groups': groups, 'named_states': named_states}


def find_srdf_in_package(pkg):
    """Locate the first *.srdf in a package's share dir (config/ preferred)."""
    import subprocess
    try:
        prefix = subprocess.run(
            ['ros2', 'pkg', 'prefix', pkg], capture_output=True, text=True, timeout=15
        ).stdout.strip()
    except Exception:  # noqa: BLE001
        return None
    if not prefix:
        return None
    share = os.path.join(prefix, 'share', pkg)
    candidates = sorted(glob.glob(os.path.join(share, 'config', '*.srdf')))
    if not candidates:
        candidates = sorted(glob.glob(os.path.join(share, '**', '*.srdf'), recursive=True))
    return candidates[0] if candidates else None


def scan_packages():
    """Scan AMENT_PREFIX_PATH share dirs for packages shipping an SRDF."""
    import subprocess
    found = []
    try:
        out = subprocess.run(
            ['ros2', 'pkg', 'list'], capture_output=True, text=True, timeout=30
        ).stdout
    except Exception:  # noqa: BLE001
        out = ''
    for pkg in sorted(p for p in out.split() if p.strip()):
        srdf = find_srdf_in_package(pkg)
        if srdf:
            found.append({'package': pkg, 'srdf': srdf})
    return found


def probe_online():
    """Probe the standard move_group interfaces via ros2 CLI."""
    import subprocess
    online = {
        'move_action': False,
        'execute_trajectory': False,
        'compute_cartesian_path': False,
        'controller_manager': False,
    }
    try:
        actions = subprocess.run(
            ['ros2', 'action', 'list', '-t'], capture_output=True, text=True, timeout=20
        ).stdout
        online['move_action'] = '/move_action' in actions
        online['execute_trajectory'] = '/execute_trajectory' in actions
    except Exception:  # noqa: BLE001
        pass
    try:
        services = subprocess.run(
            ['ros2', 'service', 'list'], capture_output=True, text=True, timeout=20
        ).stdout
        online['compute_cartesian_path'] = '/compute_cartesian_path' in services
        online['controller_manager'] = '/controller_manager/list_controllers' in services
    except Exception:  # noqa: BLE001
        pass
    return online


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--package', default='', help='Restrict discovery to one package name.')
    ap.add_argument('--srdf', default='', help='Parse a specific SRDF file directly (no package scan).')
    args = ap.parse_args()

    if args.srdf:
        info = parse_srdf(args.srdf)
        out = {
            'srdf_given': args.srdf,
            'groups': info['groups'],
            'named_states': info['named_states'],
            'online': probe_online(),
        }
    else:
        packages = scan_packages()
        if args.package:
            packages = [p for p in packages if p['package'] == args.package]
        entries = []
        for p in packages:
            try:
                info = parse_srdf(p['srdf'])
            except Exception as e:  # noqa: BLE001
                entries.append({'package': p['package'], 'srdf': p['srdf'], 'error': str(e)})
                continue
            entries.append({
                'package': p['package'],
                'srdf': p['srdf'],
                'groups': info['groups'],
                'named_states': info['named_states'],
            })
        out = {'packages': entries, 'count': len(entries), 'online': probe_online()}
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
    print()


if __name__ == '__main__':
    main()
