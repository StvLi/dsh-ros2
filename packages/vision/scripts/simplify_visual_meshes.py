#!/usr/bin/env python3
"""生成 RViz 离屏渲染专用低模 STL（"动作渲染提速"工具）。

用法:
    python3 simplify_visual_meshes.py <src_meshes_dir> <dst_dir> [target_hi] [target_med]

- 只处理 <src>/<...>_visual.stl（渲染视觉 mesh；collision 原样复制）。
- target_hi  (默认 25000): 面数 > 10 万的部件目标面数
- target_med (默认 15000): 面数 5~10 万的部件目标面数
- <5 万面部件保持原样。
- 依赖: pip install open3d  (或 venv: /path/to/venv/bin/python 本脚本)

为何用 open3d 而非 fast_simplification:
实测 fast_simplification 输出的网格在 rviz(OGRE) 中渲染丢失 ~70% 内容
(面统计/法线/流形均正常但光栅化空洞)，而 open3d 的 quadric decimation
输出在 OGRE 中完整渲染(内容保留 >99%)。不要轻易换回 fast_simplification。
"""
import argparse
import glob
import os

import open3d as o3d


def target_for(n: int, target_hi: int, target_med: int) -> int:
    if n > 100_000:
        return target_hi
    if n > 50_000:
        return target_med
    return n  # 已足够小，保持原样


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src", help="源 meshes 目录（含 *_visual.stl / *_collision.stl）")
    ap.add_argument("dst", help="输出目录")
    ap.add_argument("--target-hi", type=int, default=25000, help="大部件(>10万面)目标面数")
    ap.add_argument("--target-med", type=int, default=15000, help="中部件(5~10万面)目标面数")
    args = ap.parse_args()

    os.makedirs(args.dst, exist_ok=True)
    tot_b = tot_a = 0
    for p in sorted(glob.glob(os.path.join(args.src, "*_visual.stl"))):
        base = os.path.basename(p)
        m = o3d.io.read_triangle_mesh(p)
        nb = len(m.triangles)
        target = target_for(nb, args.target_hi, args.target_med)
        out = m
        if len(m.triangles) > target:
            try:
                out = m.simplify_quadric_decimation(target_number_of_triangles=target)
            except Exception as e:  # 简化失败则保持原样
                print("WARN %s: %s (keep original)" % (base, e))
        out.compute_vertex_normals()
        o3d.io.write_triangle_mesh(os.path.join(args.dst, base), out)
        na = len(out.triangles)
        tot_b += nb
        tot_a += na
        print("%-44s %8d -> %8d (%.0f%%)" % (base, nb, na, 100.0 * na / nb))

    # collision mesh 原样复制（渲染不用，但 URDF 引用需存在）
    for p in glob.glob(os.path.join(args.src, "*_collision.stl")):
        base = os.path.basename(p)
        if not os.path.exists(os.path.join(args.dst, base)):
            os.link(p, os.path.join(args.dst, base))
    print("TOTAL: %d -> %d (%.1f%%)" % (tot_b, tot_a, 100.0 * tot_a / tot_b))


if __name__ == "__main__":
    main()
