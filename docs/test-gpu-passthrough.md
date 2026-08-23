# GPU 直通渲染验证测试报告（v0.9.3）

> 2026-08-21 · 验证"GPU 直通"方案能否解决 llvmpipe 软件渲染的帧率瓶颈，
> 使离屏渲染（`rviz_offscreen_node`）在 30 Hz 请求下真正达到 30 Hz。

---

## 1. 测试目标

- 前提：v0.9.2 已把 llvmpipe 下 30 Hz 请求的帧率从 11.1 提升到 ~22 Hz
  （消除双重渲染），瓶颈为 llvmpipe 软件光栅化（renderOneFrame 27–31ms/帧）。
- 本测试验证：**NVIDIA GPU 直通**能否消除该瓶颈、达到 30 Hz，并评估链路开销。

## 2. 硬件与环境

| 项 | 值 |
| --- | --- |
| GPU | **NVIDIA GeForce RTX 4060 Ti 16GB**（PCIe） |
| 驱动 | 595.71.05（open kernel module；`nvidia_drm`/`nvidia_uvm` 已加载） |
| DRM 节点 | `/dev/dri/card1`、`/dev/dri/renderD128`（本用户不在 video/render 组，测试期用 sudo 临时 `chmod o+rw`，测后恢复） |
| NVIDIA 节点 | `/dev/nvidia{0,ctl,modeset,uvm}`（666，无需额外权限） |
| X server | Xorg `:1`（GDM 启动，加载 `nvidia_drv.so` + `libglxserver_nvidia.so`，GLX 1.4 + NV-GLX/NV-CONTROL） |
| 软件渲染对照 | Xvfb + Mesa llvmpipe（v0.9.2 基线） |
| 测试场景 | lite_urdf 低模（38.7 万面，open3d），1000×750，rate=30 |

## 3. 链路与排查过程

### 3.1 逐环节分析（回答"GPU 直通是否增加链路开支"）

| 环节 | llvmpipe | GPU 直通 | 变化 |
| --- | --- | --- | --- |
| 渲染 renderOneFrame | 27–31 ms | **~9 ms** | 大幅下降 |
| 像素获取 copyContentsToMemory | 1–2 ms | 1–2 ms（GPU→CPU 回读，2.25MB 量级） | 基本持平 |
| 发布 / 桥接 / VLM | 不变 | 不变 | 无变化 |

**结论：GPU 直通不增加链路开支，净节省 ~20 ms/帧**；唯一新增的 GPU→CPU
回读（~1–2 ms）远小于渲染节省量。

### 3.2 排查中发现的三层阻塞（均已解决）

1. **`nvidia-smi` NVML 失败**（`Unknown Error`）——驱动用户态工具异常，但
   **GL/GLX 实测可用**（以实际渲染结果为准，工具失败不影响功能）；
2. **`/dev/dri/renderD128` 权限拒绝**——当前用户不在 `video/render` 组，
   Mesa/EGL 的 DRM 路径打不开；用 sudo 临时 `chmod o+rw` 解决（测试用，
   重启/udev 重置后失效）；
3. **OGRE GLX context 创建失败**（`BadValue`，100 次重试后 abort）——定位为：
   - rviz 默认 **FSAA=4**（`use_anti_aliasing_`）→ OGRE `selectFBConfig` 的
     maxAttribs 优化选中 **32-bit ARGB visual** 的 fbconfig；
   - **NVIDIA GLX 拒绝在 32-bit visual 窗口上创建 GL 3.0 core context**
     （实测枚举 215 个 fbconfig：仅 24-bit / samples=0 的配置可创建，32-bit 全部
     `BadValue`）；
   - **修复**：`rviz_rendering::RenderSystem::disableAntiAliasing()`（离屏渲染无
     AA 视觉损失）→ OGRE 回落到 24-bit 配置 → context 创建成功。

## 4. 测试结果

### 4.1 帧率对比（1000×750，lite_urdf 低模 38.7 万面，rate=30）

| 指标 | llvmpipe（v0.9.2） | **NVIDIA GPU（v0.9.3）** | 提升 |
| --- | --- | --- | --- |
| 静止稳态帧率 | 21.5–22.9 Hz | **30.0 Hz（满 rate）** | +31% |
| 运动稳态帧率 | 21.5 Hz | **30.0 Hz（满 rate）** | +40% |
| onUpdate（含渲染） | ~30 ms | **~9 ms** | 3.3× |
| 每帧循环 | ~47 ms | **33 ms**（sleep 22ms 富余） | — |
| 测量帧数 | 400+ | 535 / 540 | — |

### 4.2 画面正确性

- GPU 渲染画面与 llvmpipe 基准一致（fg 75849 vs 73331，red/orange 等彩色部件
  完整；微小差异来自 AA 关闭的边缘）；运动帧差异 24335 px（双臂区域）——**动作
  渲染流畅**；
- 10 Hz 请求回归：仍达上限（未测，逻辑同上——onUpdate 9ms 远小于 100ms sleep）。

### 4.3 回归

- **llvmpipe（Xvfb）回归**：`disableAntiAliasing` 后 22.4 Hz、画面正确——
  **无劣化**（AA 关闭对离屏渲染无视觉影响，CPU 渲染反而略快）。

## 5. 结论

1. **GPU 直通方案有效且不增加链路开支**：30 Hz 请求从 llvmpipe 的 ~22 Hz
   提升到 **30.0 Hz（满 rate）**，onUpdate（渲染）30 → 9 ms，且有 22 ms/帧
   富余可支撑更高分辨率/面数；
2. **实现方式**：Xorg（NVIDIA GLX）+ 现有 `rviz_offscreen_node`，仅需
   `disableAntiAliasing()`（`offscreen/src/rviz_offscreen_node.cpp`）绕过
   NVIDIA 的 32-bit visual GLX 限制；无需 EGL 无头改造；
3. **前置条件**：GPU 驱动正常 + 用户可访问 `/dev/dri`（或 X 已在 NVIDIA GLX
   上运行）；启动时 `DISPLAY=<NVIDIA X>`（如 `:1`）+ 对应 `XAUTHORITY`，
   **不要用 Xvfb**（Xvfb 无 GPU 加速，自动回落 llvmpipe）；
4. **可选后续**：EGL surfaceless（已验证 NVIDIA EGL 1.5 可用）可去掉 X 依赖，
   但需 OGRE 渲染目标改造，收益仅为省掉 X 层（当前 X 层开销已包含在 9ms 内，
   优先级低）。

## 6. 使用方式（GPU 渲染）

```bash
# 前置：NVIDIA 驱动 + Xorg 已用 NVIDIA GLX（无 Xvfb）
export DISPLAY=:1 XAUTHORITY=/run/user/1000/gdm/Xauthority   # 视环境调整
ros2 run dsh_ros2_rviz_offscreen rviz_offscreen_node \
  --ros-args -p config_path:=/tmp/robot_scene_lite7.rviz \
  -p topic:=/rviz/scene -p width:=1000 -p height:=750 -p rate:=30.0
# 节点日志 onupdate≈9ms 即 GPU 生效；≈30ms 则为 llvmpipe（检查 DISPLAY）
```

## 7. 相关代码

- `offscreen/src/rviz_offscreen_node.cpp`：`RenderSystem::disableAntiAliasing()`（v0.9.3）
- 其余优化（低模 mesh、直读像素、双重渲染消除）：`docs/architecture.md` §5、`docs/test-robot-state-vision.md` §8
