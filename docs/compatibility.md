# 兼容基线

| 项 | 基线 | 说明 |
| --- | --- | --- |
| DeepSeek Harness | `0.1.0-rc.6`（钉版 `@deepseek-ai/dsh-*`） | 社区惯例：逐版本锁定，勿裸装 latest |
| Node.js | `^22.19.0 \|\| >=24.0.0` | 与 DSH 一致 |
| pnpm | `>= 10` | 开发/构建 |
| ROS2 | **Jazzy**（实测）；Humble 预期可用 | 依赖 `ros2`/`colcon`/`rosdep` 在 PATH；环境全局注入 ROS 变量（无需 source） |
| L4 ROS2 包 | `dsh_ros2_vlm`（colcon 构建；本机 `/tmp/vlm_ws`，经插件 `rosSetup` source） | `vlm_node`/`vlm_bridge_node`/`vision_bringup`；含 Python 依赖 `cv2`、`numpy` |
| L4 离屏渲染 | `dsh_ros2_rviz_offscreen`（C++，链接 rviz_common/OGRE）+ **Xvfb**（虚拟 X 提供 GLX） | 无物理屏、无窗口层级；`xvfb` 需安装 |
| 显示服务 | **X11**（L3 GUI/截图必需） | Pillow ImageGrab 走 X11；Wayland 需配置 `screenshotCommand`（如 grim） |
| 截图依赖 | python3 + Pillow（`pip install pillow`） | 本机已装；可用 `screenshotCommand`（scrot/import）替代 |
| 窗口管理（L3） | `wmctrl`（可选，窗口级截图/枚举） | 缺失时窗口匹配优雅降级为全屏 |
| 交互（L3 P4） | `xdotool`（`sudo apt install xdotool`） | 点击/拖拽/键鼠；wmctrl 枚举不到窗口时退回绝对坐标 |
| 多模态（L3/L4） | Gemini / OpenAI API（用户自备 key） | `vision.provider=mock` 免 key；`none` 则禁用 |

## 已知环境注意

- `ros2 doctor` 做联网版本检查，默认超时已放宽至 60s
- `ros2 topic echo --once` 在无发布者时会超时（返回 `TIMEOUT` finding，非错误）
- FastDDS SHM stderr 噪音默认丢弃（`includeStderr=true` 可打开）
- `~/.ros/log` 不可写时设 `rosLogDir`（如 `$TMPDIR`）；该覆盖同样作用于 GUI 启动进程，
  `runCommand` 与 L4 ROS2 节点亦内置自动回退（`/tmp/ros-log-<uid>`）
- RViz2 需要可用的 GLX 上下文：在无 GLX 的显示（如 Xvfb/远程转发）上启动后不会出窗口，
  属环境限制；L4 离屏渲染在 Xvfb + Mesa llvmpipe（软件 GL 4.5）上工作正常
