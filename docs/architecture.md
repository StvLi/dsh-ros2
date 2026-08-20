# dsh-ros2 架构

> 版本 0.6.0（37 工具 + `ros2-diagnostics` skill）· 配套 `README.md`（使用）· `compatibility.md`（兼容基线）

---

## 1. 设计概览

dsh-ros2 让 DSH agent 以 **CLI + ROS2 话题/service 双通道**调试机器人系统。工具按安全边界分四层：

| 层 | 范围 | 工具数 | 安全模型 |
| --- | --- | --- | --- |
| **L1 只读诊断** | 包/工作区/依赖/节点/话题/服务/动作/参数/接口/TF/拓扑/健康/包 | 17 | 纯只读，无审批 |
| **L2 审批管理** | 构建/依赖安装/消息骨架/参数设置/录制 + 任务查询 | 7 | 写操作一律 `ctx.approval.request`，fail-closed |
| **L3 可视化与交互** | GUI 生命周期/截图/多模态描述/xdotool 交互 | 9 | 本地会话良性操作，无审批 |
| **L4 实时视觉** | 并行 VLM / 图像话题取帧 / 视觉链路自动建立 | 4 | 图像来自话题（无头），无审批 |

**核心设计原则**
1. **文本/结构化优先**：L1 输出 JSON，LLM 直接消费；GUI 给人看、多模态给 agent 看；
2. **执行缝隙注入**：所有外部依赖（run/approval/jobs/gui/vision）经 `ToolDeps` 注入，测试全用 fake；
3. **无头优先**：视觉图像一律来自 `sensor_msgs/Image` 话题或离屏渲染内核，不依赖 X11 截图。

---

## 2. 工具分层

### L1 只读诊断（17）

`ros2_pkg_list` / `ros2_colcon_list` / `ros2_rosdep_check` / `ros2_node_list` /
`ros2_node_info` / `ros2_topic_list` / `ros2_topic_info` / `ros2_topic_echo` /
`ros2_service_list` / `ros2_action_list` / `ros2_param_list` /
`ros2_interface_show` / `ros2_graph` / `ros2_tf_list` / `ros2_tf_echo` /
`ros2_doctor` / `ros2_bag_info`。

### L2 审批管理（7）

`ros2_colcon_build`（后台任务）/ `ros2_rosdep_install`（dry-run 预览）/
`ros2_interface_create`（msg/srv/action 骨架，不覆盖既有文件）/
`ros2_param_set`（JSON 值类型化）/ `ros2_bag_record`（限时录制）/
`ros2_jobs_list` / `ros2_job_status`（只读查询）。

### L3 可视化与交互（9）

`ros2_gui_start` / `ros2_gui_list` / `ros2_gui_close` / `ros2_screenshot` /
`ros2_vision_describe` / `ros2_gui_observe` / `ros2_gui_click` /
`ros2_gui_drag` / `ros2_gui_key`（xdotool 级交互：RViz2 视点操控、显示配置重载）。

### L4 实时视觉（4）

`ros2_image_snapshot`（图像话题取帧，raw/compressed）/ `ros2_vlm_analyze`
（文件或 bridge 最新帧 → 并行 VLM）/ `ros2_vision_topics`（图像话题 + 桥接
service 清单）/ `ros2_vision_analyze`（按话题路由到对应 bridge 分析最新帧）。

---

## 3. 执行缝隙（seams）

```
DSH 会话 → tools/skills 服务
   │ createRos2Tools({run, approval, jobs, gui, vision})
   ▼
工具层 tools.ts ──▶ runner.ts（CLI 执行）│ approval（L2 审批）
                 ──▶ jobs（后台任务）    │ gui.ts（GUI 生命周期/截图/xdotool）
                 ──▶ vision（L3 多模态） │ vlm/ offscreen/（L4 ROS2 包）
```

| 缝隙 | 生产实现 | 测试 |
| --- | --- | --- |
| `run` | `runCommand`（超时/杀进程/自动 ROS_LOG_DIR 回退） | fake 返回夹具 |
| `approval` | `ctx.approval.request`（仅 `allowed-once` 放行） | allowed-once/rejected |
| `jobs` | `ctx.jobs.start` + `spawnJob` | fake registry |
| `gui` | `GuiManager`（spawn/wmctrl/Pillow/xdotool，全可注入） | fake 各原语 |
| `vision` | `VisionProvider`（gemini/openai/mock，key 用户自备） | Mock |

---

## 4. 实时视觉架构（L4）

L4 解决具身 agent 的**实时性与无头部署**：VLM 分析在独立进程运行（与机器人控制栈一致的
ROS2 通信），图像全部来自话题，杜绝 X11 截图依赖与窗口层级问题。

```
┌─ ROS2 图（多进程）─────────────────────────────────────────────┐
│                                                               │
│  /camera/image (相机/仿真)   /rviz/scene (RViz2 离屏渲染, 可选)  │
│         └──────────┬───────────┘                               │
│                    ▼                                          │
│  [vlm_bridge_node] 常驻桥接：缓存最新帧，仅被触发时转发           │
│  （每话题一路，service/trigger/result 按话题唯一化）              │
│                    │  image_bytes_b64（内存直传，无磁盘/重编码）  │
│                    ▼                                          │
│  [vlm_node] 独立进程（MultiThreadedExecutor）                   │
│    service /vlm/describe · topic /vlm/description（latest 缓存）│
│                    ▼                                          │
│             本地 VLM 网关（OpenAI 兼容）→ 描述                    │
└───────────────────────────────────────────────────────────────┘
```

### 4.1 并行 VLM 节点（`vlm_node`）

- service `/vlm/describe`（图像路径或 base64 字节 + prompt → 描述），
  `MultiThreadedExecutor` 并发处理；
- `/vlm/description`（transient-local）缓存最近结果，新订阅者 0 等待；
- API key 经参数或 `VLM_API_KEY` 注入，不落盘明文。

### 4.2 常驻桥接（`vlm_bridge_node`）

- 订阅一路图像话题（raw / CompressedImage，jpeg 保持原始字节免重编码），
  **仅缓存最新帧，未被触发时零开销**；
- 被触发时把帧经 `image_bytes_b64` **内存直传** `vlm_node`（无磁盘中转）；
- service `/vlm_bridge/analyze_latest`（同步）+ topic trigger→result（异步）；
- 并发设计：VLM client 由**专用 spin 线程**服务——executor 回调线程等待自己的 client
  响应会死锁（rclpy 实测排除 coroutine 方案），此为唯一可靠模式。

### 4.3 视觉链路自动建立（`vision_bringup`）

- 自动发现全部 `sensor_msgs/Image` / `CompressedImage` 话题，每路拉起一个
  参数化 bridge（`id` = 话题规范化名，service/trigger/result 按话题唯一化）；
- LLM/harness 统一入口：`ros2_vision_topics`（话题+桥接清单）、
  `ros2_vision_analyze {topic, prompt}`（路由到该话题 bridge 分析最新帧）。

### 4.4 RViz2 离屏渲染（`dsh_ros2_rviz_offscreen`）

- 驱动真实 rviz 渲染栈（`rviz_common` + OGRE + `rviz_default_plugins`），在
  **Xvfb（无物理屏、无窗口层级）**上加载 `.rviz` 场景离屏渲染，输出 `/rviz/scene`
  图像话题（Grid/TF/RobotModel/PointCloud2/Marker 等，读取渲染内核而非 X 截图）；
- 相机图直接经 `ros2_image_snapshot` 从话题取帧（rviz 的 Image 面板无头下不适用）。

---

## 5. 架构演进与性能对比

| 阶段 | 取帧 | 分析 | 三路/单帧性能 |
| --- | --- | --- | --- |
| ① X11 截图链路（已废弃） | 窗口截图 → PNG 落盘 | 进程内 HTTP，串行 | 依赖显示器/窗口层级，无头不可用 |
| ② 话题取帧 + 并行 VLM | `image_snapshot`（冷启动 + 磁盘中转） | `vlm_analyze` 并行 | 三路 ~6.6s（≈2.6× vs 串行）；链路开销 ~2s/帧 |
| ③ **bridge 常驻**（当前） | 桥接常驻缓存（0 冷启动） | 内存直传并行 VLM | 链路开销 **~0.7s/帧**；单路 service 3.0~5.5s |

**关键结论**
- VLM HTTP（3~6s）为主导成本，由网关/模型决定，非插件瓶颈；
- 并行调用消除串行等待；常驻桥接消除进程冷启动与磁盘中转；
- 高频/持续观察场景桥接收益最大，重复调用稳定。

---

## 6. 安全模型

- **L1**：纯只读，无审批；
- **L2**：写操作一律审批（fail-closed：无审批服务/无 agent/非 `allowed-once` 均拒绝），
  reason 含完整命令预览；后台任务有输出截断；
- **L3**：GUI/截图/xdotool 交互限定本地会话，无审批；
- **L4**：图像来自话题与离屏渲染，无审批；视觉 API key 用户自备，不落盘明文；
- **通用**：`~/.ros/log` 不可写时自动回退可写目录（`runCommand` 与 ROS2 节点均内置）。

---

## 6.5 Skills

插件注册两个运行时 skill（`ctx.skills.register`）：

| Skill | 用途 |
| --- | --- |
| `ros2-diagnostics` | 调试工作流：先广后窄、无数据/消息不匹配/TF 排障 |
| `robot-state-vision-analysis` | **状态 → 离屏渲染 → VLM → 交叉验证** 的无头机器人状态分析流水线（L1 状态读取 → `rviz_offscreen_node` → `vision_bringup`/`ros2_vision_analyze` → 数值交叉验证，如零位构型下 TF 轴共线重叠属预期而非异常） |

**测试结果（2026-08-20 真机）**
- 单测：79 用例全绿（含 skill 结构/内容断言）；
- 端到端·零位场景：19 节点链路——关节零位读取 ✅、离屏渲染 800×600 `/rviz/scene` ✅、
  bridge VLM 分析 5.7s ✅（识别直立姿态/TF 树，提示坐标系重叠；与零位数据交叉验证一致）。
- 端到端·非零构型场景（重启后）：`ros2_vision_analyze`（插件工具本体）分析 `/rviz/scene` 5.6s ✅；
  **交叉验证发现视觉/数值分歧**——VLM 判"零位/中性姿态"，而 `joint_states` 显示双臂
  shoulder_roll 外展 ±77°（-1.353/+1.384 rad）、wrist_yaw 0.81/1.575 rad（非零构型）：
  视觉对 TF 骨架的关节角判断有限，**姿态应以 `joint_states` 数值为准**，视觉用于结构与粗粒度姿态。 

---

## 7. 兼容性与环境注意

详见 `compatibility.md`。要点：Jazzy 实测（Humble 预期可用）；X11 仅 L3 需要
（L4 无头）；`dsh_ros2_vlm` / `dsh_ros2_rviz_offscreen` 需 colcon 构建并 source
（web profile 经 `rosSetup` 注入）；FastDDS SHM stderr 噪音默认丢弃。
