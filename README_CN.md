# dsh-ros2

> ROS2 调试工具集与机器人状态视觉分析能力，作为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) 插件分发。

[![CI](https://github.com/StvLi/dsh-ros2/actions/workflows/ci.yml/badge.svg)](https://github.com/StvLi/dsh-ros2/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/StvLi/dsh-ros2)](https://github.com/StvLi/dsh-ros2/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![ROS2](https://img.shields.io/badge/ROS2-Jazzy-orange)]()
![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen)
![Tools](https://img.shields.io/badge/tools-55-blue)

> **版本对应关系**：npm 上的 `dsh-ros2@0.1.0` 就是本仓库当前版本（monorepo 布局）。
> GitHub 的 `v0.8.0 ~ v0.15.0` 标签是已废弃的旧单体布局历史，从未发布到 npm。
> 版本号在 2026-08 的 monorepo 拆分时重新基线。详见 [docs/versioning.md](docs/versioning.md)。


**dsh-ros2** 让 DSH 智能体在一台装有 ROS2 的主机上获得完整的机器人开发/调试能力，分为四个能力层：

| 层级 | 能力 | 安全边界 |
| --- | --- | --- |
| **L1** | 只读诊断：包/工作区/依赖检查、节点/话题/服务/动作/参数/接口枚举、单帧话题采样、TF 树查询、全图拓扑 JSON、`ros2doctor`、bag 摘要、MoveIt 发现、机器人档案读取、安全状态读取与 VLM 语义仲裁 | 纯只读，无需审批 |
| **L2** | 审批门控管理：`colcon build`（后台任务）、`rosdep install`、消息骨架生成、`param set`、限时 `bag record`、一键安装 ROS2、launch 启停、rosbag 回放、MoveIt 运动、零位语义校准、机器人注册与拓扑学习、**safety_monitor 启动 / 人工门锁死与解锁** | 写操作一律先审批（fail-closed） |
| **L3** | 可视化：RViz2 / rqt 生命周期管理、截图、多模态视觉描述、xdotool 级窗口交互 | 本地会话操作 |
| **L4** | 实时视觉：并行 VLM ROS2 节点 + 图像话题取帧（无头；`vision_bringup` 周期刷新每话题桥），外加 **RViz2 离屏渲染**（OGRE 渲染内核 → `/rviz/scene` 话题） | 纯软件渲染，无需显示器 |

所有工具直接调用宿主上的 `ros2` / `colcon` / `rosdep` CLI；L1 永远不修改任何东西，L2 永远先询问。

---

## 截图

| RViz2 离屏渲染（最新 `lite_urdf`，真实材质配色） | 头部相机 | 左手眼相机 | 右手眼相机 |
| --- | --- | --- | --- |
| ![mesh render](docs/images/robot_mesh_full.jpg) | ![head cam](docs/images/camera_head.jpg) | ![wrist left](docs/images/camera_wrist_left.jpg) | ![wrist right](docs/images/camera_wrist_right.jpg) |

> 左图由 `rviz_offscreen_node` 在 Xvfb 下用真实 rviz 渲染栈（OGRE）渲染并发布到 `/rviz/scene` 图像话题；右侧三图由 `ros2_image_snapshot` 从相机话题取帧（1280×720）。完整实测记录见 [`docs/test-robot-state-vision.md`](docs/test-robot-state-vision.md)。

---

## 特性一览

- **零侵入诊断**：55 个工具覆盖 ROS2 调试的绝大多数场景，从"包装了没有"到"这一帧话题里是什么"，一条命令一个结果；
- **全图拓扑**：`ros2_graph` 将节点/发布/订阅/服务/动作折叠为一份 JSON，几秒看清系统结构；
- **审批门控的写操作**：构建、装依赖、生成消息骨架等写操作通过 DSH 审批服务，fail-closed，拒绝即失败；
- **可视化即服务**：无头也能"看"——截图/多模态描述/窗口交互全部本地化，不依赖远程显示；
- **并行实时视觉**：VLM 跑在独立 ROS2 进程（`vlm_node`，服务 `/vlm/describe`），图像来自话题（`sensor_msgs/Image` / `CompressedImage`），`vision_bringup` 自动为每个图像话题建桥，无头可用；
- **RViz2 离屏渲染（llvmpipe ~22 Hz，GPU 直通 30 Hz 满帧）**：真实 rviz 渲染内核（`rviz_common` + OGRE）在虚拟显示器下渲染任意 `.rviz` 场景并发布为图像话题——不截图、不依赖 X11 窗口层级。**性能优化**：open3d 低模 mesh（`scripts/simplify_visual_meshes.py`）+ OGRE 直接读像素（跳过 PNG 中转）+ 消除双重渲染 → 动作渲染 1.9 → llvmpipe ~22 Hz（11×），NVIDIA GPU 直通达 **30 Hz 满帧**（v0.9.3），内存 -2.5×；
- **实时安全框架**（`safety_monitor` 节点 + `robot_safety_*` 工具，详见[安全框架](#安全框架)）：分层防御——工具层安全门（执行前查 `/safety/state`）→ 反应式监视（轨迹跟踪/堵转 + 迟滞、关节反馈丢失、看门狗、可选力矩）→ 事件驱动 VLM 语义仲裁 → 人工仲裁。锁存 `NORMAL`/`LOCKED` 状态机（锁存直至人工解锁；非致命事件永不锁死）；阈值/话题/锁动作全部按机器人在档案 `safety` 段注册；几何预检（关节限位/速度/FK 自碰撞）为预留层；
- **内置技能**：`ros2-diagnostics`（何时用哪个工具、如何由宽到窄排查）与 `robot-state-vision-analysis`（状态读取 → 离屏渲染 → VLM → 交叉验证的完整流水线）。

---

## 快速开始

### 环境要求

- 装有 ROS2 的主机（**Jazzy** 实测；Humble 应可用），`ros2` 在 `PATH` 上；
- Node `^22.19 || >=24`（DSH 宿主版本要求）；
- L4 视觉链路额外需要 Python 3 的 `rclpy` 与一个 OpenAI 兼容 VLM 网关（如 Gemini / 自建网关）。

### 安装插件

全部 9 个 npm 包以 **0.1.0** 发布（GitHub ↔ npm 版本对应关系见
[docs/versioning.md](docs/versioning.md)）。

**方式一：DSH 插件 CLI（推荐；经 npm 解析）**

```bash
# 全集（聚合包；自动拉取 core/profile/moveit/safety/vision 依赖）
dsh plugin --profile <profile> add dsh-ros2
# 按需瘦身安装——例如只装诊断：
dsh plugin --profile <profile> add dsh-ros2-core
# dsh-ros2-common 为纯库，随依赖自动安装。
```

**方式二：直接 npm 安装**（同一批包；也用于安装可选附加包）

```bash
# 聚合包（自动拉取 dsh-ros2-common/core/profile/moveit/safety/vision）
npm install dsh-ros2
# 可选附加：sidecar 数据面守护进程 + 控制面状态客户端
npm install dsh-ros2-state dsh-ros2-sidecar
```

**方式三：墙内版（走 npmmirror 镜像，推荐大陆网络环境）**

```bash
# ① 全局切换镜像源（推荐——DSH 插件 CLI 同样生效，一次配置处处可用）：
npm config set registry https://registry.npmmirror.com
# 之后正常执行方式一/方式二的命令即可。

# ② 或单次安装走镜像（不改全局配置）：
npm install dsh-ros2 --registry=https://registry.npmmirror.com
npm install dsh-ros2-state dsh-ros2-sidecar --registry=https://registry.npmmirror.com
```

> 镜像说明：本项目发布走 npm 官方源；npmmirror 会定期同步，新发布的小版本
> 可能有几分钟到几十分钟的传播延迟——若镜像上暂缺，可用
> `--registry=https://registry.npmjs.org` 直连官方源验证或应急安装。
>
> 包角色：`dsh-ros2`（聚合）· `dsh-ros2-common`（共享库）·
> `dsh-ros2-core`（核心诊断）· `dsh-ros2-profile`（档案/拓扑）·
> `dsh-ros2-moveit`（MoveIt 运动）· `dsh-ros2-safety`（安全框架）·
> `dsh-ros2-vision`（视觉流水线）· `dsh-ros2-state`（状态客户端）·
> `dsh-ros2-sidecar`（数据面守护进程）。

### 最小配置（per-bundle，整体对象替换）

拆分后每个 bundle 携带各自的**运行 seam 配置**（同样的键按 id 重复），vision
provider 只存在于 `dsh-ros2-vision`：

```yaml
# DSH profile 补丁片段（按 id 定向配置覆盖）
- id: dsh-ros2-core                 # 亦可用：-profile / -moveit / -safety
  config:
    rosSetup: source /opt/ros/jazzy/setup.bash &&   # 准备 ROS2 环境
    workspaceRoot: /home/you/ros2_ws                 # colcon/rosdep 的默认工作目录
- id: dsh-ros2-vision
  config:
    rosSetup: source /opt/ros/jazzy/setup.bash &&
    vision:
      provider: gemini                               # mock | gemini | openai
      apiKey: ${GEMINI_API_KEY}                      # 经环境变量/密钥管理注入，勿写死
- id: dsh-ros2-safety
  config:
    safetyStrict: warn                               # 'warn'（默认）| 'reject'（fail-closed）；LOCKED 一律拒绝
```

### 三分钟体验

```bash
ros2_graph                          # 一键看清系统拓扑
ros2_topic_list                     # 当前所有话题及类型
ros2_topic_echo /joint_states       # 采样一帧关节状态
ros2_tf_list                        # TF 树边
ros2_doctor                         # 系统健康报告
```

---

## 工具参考

> 工具按域归属包：L1/L2/L3 在 `dsh-ros2-core`；`motion_validate`/`moveit_*` 在 `dsh-ros2-moveit`；`robot_*`/`ros2_zero_pose_semantics` 在 `dsh-ros2-profile`；`robot_safety_*` 在 `dsh-ros2-safety`；视觉工具在 `dsh-ros2-vision`。

### L1 只读诊断

| Tool | 底层命令 | 用途 |
| --- | --- | --- |
| `ros2_pkg_list` | `ros2 pkg list` | 已安装包（可选子串过滤） |
| `ros2_colcon_list` | `colcon list` | 工作区内的包 |
| `ros2_rosdep_check` | `rosdep check --from-paths src --ignore-src` | 依赖健康（缺依赖 = finding 而非 error） |
| `ros2_node_list` | `ros2 node list` | 运行中的节点 |
| `ros2_node_info` | `ros2 node info <node> [-v]` | 单节点订阅/发布/服务/动作 |
| `ros2_topic_list` | `ros2 topic list -t` | 话题及类型 |
| `ros2_topic_info` | `ros2 topic info <topic> [-v]` | 话题元数据 / QoS |
| `ros2_topic_echo` | `ros2 topic echo <topic> --once` | 单帧消息（尽量 JSON）；`--qos-reliability` / `--qos-durability` 透传，可读 TRANSIENT_LOCAL 锁存话题 |
| `ros2_topic_hz` | `ros2 topic hz <topic> [--window N]` | 测量话题发布频率（窗口内均值/最小/最大/标准差）；自然终止 = 测量超时 |
| `ros2_service_list` | `ros2 service list -t` | 服务及类型 |
| `ros2_action_list` | `ros2 action list -t` | 动作及类型 |
| `ros2_param_list` | `ros2 param list <node>` | 节点参数 |
| `ros2_interface_show` | `ros2 interface show <type>` | 消息/服务/动作完整字段定义 |
| `ros2_graph` | `ros2 node list` + 逐节点 `node info` | 折叠式 JSON 拓扑图 |
| `ros2_tf_list` | `ros2 topic echo /tf --once` | 当前 TF 树边 |
| `ros2_tf_echo` | `ros2 topic echo /tf --once` | 两帧间变换 |
| `ros2_doctor` | `ros2 doctor` | 系统健康报告 |
| `ros2_bag_info` | `ros2 bag info <path>` | bag 摘要 |
| `moveit_discover` | 扫描 MoveIt 包 + 解析 SRDF + 探测 move_group | 发现宿主上的 MoveIt2 配置包（任意带 SRDF 的包）、规划组与命名姿态，以及 `/move_action`/`/execute_trajectory`/`/compute_cartesian_path` 是否在线；可直接传 `srdf` 解析指定文件——通用，不绑定具体包 |
| `robot_safety_state` | `ros2 topic echo /safety/state --once` | 读锁存安全状态（NORMAL / LOCKED + 严重级 + 触发原因 + 细节）；监视器离线时返回 `monitor_running: false` |
| `robot_safety_arbitrate` | `ros2 run dsh_ros2_safety safety_vlm_arbitrate ...` | 事件驱动 VLM 语义仲裁（方案变更/异常后）：固定格式化 prompt + 新鲜离屏帧经 `/vlm/describe`；非 safe 一律提示人工裁决 |
| `motion_validate` | `motion_validator.py --trajectory <file> --config <json>` | 确定性预执行校验（只读）：关节限位、NaN/Inf、名字与规划组覆盖、时间戳/时长、新鲜度、可选 workspace box、指纹 + TTL——碰撞/奇异留给 MoveIt 规划 |

### L2 管理（审批门控）

每个 L2 工具执行**写操作**，先经 DSH 审批服务询问用户（无审批服务/被拒 = fail-closed）。只读辅助 `ros2_jobs_list` / `ros2_job_status` 无需审批。

| Tool | 底层命令 | 说明 |
| --- | --- | --- |
| `ros2_colcon_build` | `colcon build [--packages-select ...] [--symlink-install]` | 以**后台任务**运行（`ctx.jobs`）；返回 `jobId`，用 `ros2_job_status` 跟踪 |
| `ros2_rosdep_install` | `rosdep install --from-paths src --ignore-src -y` | `dryRun` 用 `--simulate` 预览 |
| `ros2_interface_create` | 写入 `<root>/<pkg>/<msg\|srv\|action>/<Name>.*` | 骨架生成器；**绝不覆盖**已有文件 |
| `ros2_param_set` | `ros2 param set <node> <param> <value>` | JSON 数字/布尔按类型处理，其余按字符串 |
| `ros2_bag_record` | `ros2 bag record <topics...> --output <dir>` | 限时录制：`duration` 秒后自动停止 |
| `ros2_jobs_list` | `ctx.jobs.list` | 本智能体的后台任务（只读） |
| `ros2_job_status` | `ctx.jobs.get` | 按 id 查任务状态（只读） |
| `ros2_install` | 鱼香ROS一键安装（交互式 PTY 会话） | ROS2 未安装时：`check` 探测（已装/已装未 source/未装）；`start`（审批）拉起安装器；`send`/`status`/`stop` 驱动与观察交互菜单 |
| `ros2_bag_play` | `ros2 bag play <path> [--topics ...] [--rate X] [--loop] [--start-offset S]` | 回放 rosbag 到其话题（审批门控；会发布到图）；前台运行 `timeoutMs` |
| `ros2_topic_pub` | `ros2 topic pub <topic> <type> "<yaml>" [-r Hz] [-n N|--once|-t 秒]` | 发布消息（审批门控；会写入图）。限时/限量发布 + QoS 透传（--qos-reliability / --qos-durability） |
| `ros2_run` | `ros2 run <pkg> <executable> [args]` | 运行任意已安装 ROS2 可执行文件（审批门控）：前台（限时）或后台任务 |
| `ros2_process_cleanup` | `pgrep -f '[p]attern'` + `kill` | 清理匹配模式的残留 ROS2 进程（自安全）；审批门控 |
| `ros2_launch` | `ros2 launch <pkg> <launch_file> [args]` | 以后台任务启动 launch 文件（审批门控；返回 jobId，用 DSH job 控制停止） |
| `ros2_zero_pose_semantics` | 发零位→离屏渲染→VLM→确认 | 交互式校准零位语义（通用）：`analyze` 渲染全零姿态并让 VLM 从三维度描述（臂：侧平举/下垂；肘：向前/向上；手掌/相机支架：上/前/下）；`confirm` 记录使用者确认的组合（或 `customText` 自定义文字）到 `~/.dsh-ros2/zero-pose.yaml` 供 skill 使用 |
| `robot_register` | 采集 URDF/TF/相机/MoveIt/零位语义 → 写入 `~/.dsh-ros2/robots/<name>.yaml` | 首次接触时注册机器人本体档案（审批门控），便于后续即时复用 |
| `robot_load` | 读取 `~/.dsh-ros2/robots/<name>.yaml` | 加载已注册的机器人档案为结构化 JSON（快速路径——无需重新发现）；name 为空列出全部 |
| `robot_topology` | 聚合快照 + 渐进式重要节点学习（严格 schema） | 机器人通信拓扑的取舍：`snapshot`（审批）记录节点/话题/服务清单（轻量不冗杂）；`learn`（审批）记录单个重要节点的角色/功能 + pub/sub/srv/act；`show`（只读）读回 |
| `moveit_move` | 统一：`/move_action` + `/execute_trajectory` | **一个工具五种本质模式**（审批门控）：`joint_abs`、`joint_rel`、`pose_abs`、`pose_rel`（frame ee/world）、`trajectory`。通用：仅标准 moveit_msgs + SRDF。**单一路径：规划 → 确定性校验（motion_validator，`robot` 档案提供完整限位）→ 人工审批（展示校验摘要）→ 执行 → 验证**；执行前查 `/safety/state`（LOCKED 恒拒；监视器失联按 `safetyStrict`）。`planOnly` + `trajectoryOut` 分离规划/执行 |
| `robot_safety_start` | `ros2 run dsh_ros2_safety safety_monitor --profile <yaml>` | 以后台任务启动通用安全监视器（审批门控）；本体相关值全部来自档案 `safety` 段 |
| `robot_safety_lock` / `robot_safety_unlock` | `ros2 service call /safety/set_lock|unlock ...` | **人工门**显式锁死 / 解锁（调用前 L2 审批）；锁存直至人工解锁（恢复：解锁 → 回 home → 恢复） |
| `moveit_status` | 探测 move_group 接口 + 采样 `/joint_states` | 运行时状态：在线探测 + 当前关节状态 + SRDF 规划帧（只读） |

### L3 可视化

GUI 生命周期 + 截图 + 多模态视觉（"先能看，再谈动"）+ xdotool 级交互（"能看也能动"）。截图用 Pillow `ImageGrab`（X11，无需额外 CLI）；视觉 provider 可插拔；交互需 `xdotool`（`sudo apt install xdotool`）。

| Tool | 用途 |
| --- | --- |
| `ros2_gui_start` | 在宿主显示上启动 RViz2（支持 `-d config`）/ rqt_graph / rqt；会话被跟踪 |
| `ros2_gui_list` | 被跟踪会话 + X11 窗口（`wmctrl -lG`） |
| `ros2_gui_close` | 关闭会话（SIGTERM） |
| `ros2_screenshot` | 截屏或按窗口标题截图到 PNG |
| `ros2_vision_describe` | 用配置的多模态模型描述一张图片（Gemini / OpenAI / mock） |
| `ros2_gui_observe` | 确保 GUI 运行 → 截图 → 返回多模态描述（"看"工作流） |
| `ros2_gui_interact` | 统一 xdotool 交互：`action=click`（点击/滚动，`button` 4/5 = 滚动）、`action=drag`（拖拽：RViz2 orbit/pan/zoom）、`action=key`（组合键如 `ctrl+shift+r` 或输入文本） |

交互配方（模型视角）：`ros2_gui_interact {action: "drag", windowTitle: "rviz2", button: 1, toX: <dx>, toY: <dy>}` 环绕视角、`action: "drag", button: 3` 缩放、`ros2_gui_interact {action: "key", keys: "ctrl+shift+r"}` 重载配置。`wmctrl` 枚举不到窗口（如显示上没有窗口管理器）时窗口相对交互会报"未找到窗口"——退回绝对屏幕坐标。交互属于本地会话操作（无需审批，与其它 L3 工具一致）。

### L4 实时视觉（并行 VLM over ROS2，无头图像话题）

感知与机器人控制栈同构：VLM 跑在**独立 ROS2 进程**（`vlm_node`，服务 `/vlm/describe` + 缓存话题 `/vlm/description`），图像来自 **`sensor_msgs/Image` 话题而非 X11 截图**——无头就绪。需要 `dsh_ros2_vlm` ROS2 包（`vlm/`）；构建/运行见 [`docs/architecture.md`](docs/architecture.md) §4。

| Tool | 用途 |
| --- | --- |
| `ros2_image_snapshot` | 从图像话题抓最新帧（raw / compressed）存为 JPEG |
| `ros2_vlm_analyze` | 分析图像文件或桥的缓存帧（`useBridge`） |
| `ros2_vision_topics` | 列出实时图像话题及其自动桥服务名 |
| `ros2_vision_analyze` | 经自动桥分析任意话题最新帧（`ros2_vision_analyze {topic, prompt}`） |

```bash
# 构建并启动视觉流水线（每图像话题自动建桥）
mkdir -p /tmp/vlm_ws/src && ln -s <repo>/vlm /tmp/vlm_ws/src/dsh_ros2_vlm
cd /tmp/vlm_ws && colcon build --symlink-install && source install/setup.bash
VLM_API_KEY=... ros2 run dsh_ros2_vlm vlm_node &       # 并行 VLM 进程
ros2 run dsh_ros2_vlm vision_bringup &                 # 发现话题，每路一桥
```

### RViz2 离屏渲染（`dsh_ros2_rviz_offscreen`）

真实 rviz 渲染栈（`rviz_common` + OGRE + `rviz_default_plugins`）在 Xvfb（虚拟显示器）下加载 `.rviz` 场景离屏渲染，把画面发布为 `/rviz/scene` 图像话题——读取渲染内核而非 X 截图，无窗口层级依赖。

```bash
# 构建（需要 vlm_ws 同款工作区）
ln -s <repo>/offscreen /tmp/vlm_ws/src/dsh_ros2_rviz_offscreen
cd /tmp/vlm_ws && colcon build --symlink-install && source install/setup.bash
# 运行（config_path 指向 .rviz 场景文件）
xvfb-run -a -s "-screen 0 1280x800x24" ros2 run dsh_ros2_rviz_offscreen rviz_offscreen_node \
  --ros-args -p config_path:=/tmp/robot_scene.rviz -p topic:=/rviz/scene \
  -p width:=800 -p height:=600 -p rate:=5.0
```

**机器人本体 mesh 渲染要点**（踩坑总结，详见 [`docs/architecture.md`](docs/architecture.md) §4.4）：

1. **Jazzy RobotModel 属性**：用 `Description Source: Topic` + `Description Topic: <话题>`（旧版 `Robot Description:` 被忽略 → `Links` 为空）；
2. **mesh 路径**：URDF 内 mesh 用绝对路径或 `file://` 前缀（裸路径 `resource_retriever` fopen 失败）；发布者须常驻（transient-local，退出后新订阅者收不到）；
3. **URDF 与 TF 必须同名绑定**：URDF link 名必须与实时 TF 帧名完全一致（发布真机 `/robot_description` 即可）。**不匹配时所有 link 变换查找失败，mesh 全部堆到固定坐标系原点**；
4. **视距**：Orbit `Distance` ≈ 1.5–2.0 m 得到 RViz 式近景全身视角（>5 m 时缩成画面中心小点）；
5. **判定信号**：节点启动 ~3 s 后日志打印 `FM: ... frames=N` 与 `transformHasProblems(...)=0`，即 mesh 已正确绑定 TF。

---

## MoveIt2 运动——五种本质模式，一个工具

**设计意图**。机器人经 MoveIt 的运动，本质只有五种操作：关节角绝对设置、关节角相对微调、
末端位姿绝对到达、末端位姿相对增量、执行预规划轨迹。与其让工具随需求不断膨胀，
dsh-ros2 将它们抽象为 **一个工具 `moveit_move` + `mode` 参数**——接口小而可预期、可脚本化，
并且对任意 MoveIt 包通用（读取 SRDF、只讲标准 `moveit_msgs`）。

| 工具 | 职责 |
| --- | --- |
| `moveit_discover`（L1） | 读取任意 MoveIt 包的 SRDF：规划组、命名姿态、chain 末端；探测标准接口（`/move_action`、`/execute_trajectory`…）在线状态 |
| `moveit_status`（L1） | 运行时探测：接口在线 + 当前 `/joint_states` 采样 + SRDF 规划帧 |
| `moveit_move`（L2 审批） | **一个工具五种模式**：`joint_abs`（joints "j1:=v1 j2:=v2"）、`joint_rel`（deltaJoints = 当前 + 增量）、`pose_abs`（pose "x y z rx ry rz" 规划帧）、`pose_rel`（deltaPose "dx dy dz drx dry drz"，frame ee/world）、`trajectory`（执行已保存的轨迹 JSON） |

```json
moveit_move {mode: "joint_abs", group: "right_arm", joints: "right_shoulder_roll:=0.5"}
moveit_move {mode: "joint_rel", group: "right_arm", deltaJoints: "right_elbow_pitch:=-0.2"}
moveit_move {mode: "pose_rel",  group: "right_arm", deltaPose: "0.05 0 0 0 0 0"}
moveit_move {mode: "pose_abs",  group: "right_arm", pose: "0.5 0 0.8 0 0 0"}
moveit_move {mode: "trajectory", group: "right_arm", trajectory: "/tmp/traj.json"}
```

**实现方式**。`moveit_discover`/`moveit_status` 告诉你"能动什么"（组、关节、SRDF chain
末端的 EE link、在线状态）；`moveit_move` 把任意模式转成标准 `MoveGroup` goal
（`/move_action`），经 `/execute_trajectory` 执行；配合 `planOnly` + `trajectoryOut`
保存规划轨迹，之后用 `mode: "trajectory"` 单独执行（规划/执行分离）。不绑定任何具体
MoveIt 包——只需 SRDF 路径（包扫描自动解析，或显式 `srdf`/`package`）。

---

## 安全框架

**设计意图**。兼顾实时与语义判断的两层策略（完整契约见 `docs/safety-handover.md`
——本体适配交接文档：通用框架/接口归本仓库，本体数据源/方案/算法归下游）：

```
工具层安全门（执行前：/safety/state 是否 LOCKED；监视器失联按 safetyStrict）
  → 反应式监视（执行中：轨迹跟踪/堵转 + 迟滞、关节反馈丢失、看门狗、可选力矩；控制频率检测，响应 ≤100ms 预算）
  → VLM 语义仲裁（方案变更/异常后，秒级——不必要时不拉起）
  → 人工仲裁（非 safe 一律升级人工；人工门解锁）
```

- **`safety_monitor` 节点**（`dsh_ros2_safety` 包）：订阅关节反馈（+ 可选指令流/力矩流），
  按 `control_frequency` 定时器运行检查器，任何 CRITICAL 事件**锁存 LOCKED**——锁存
  不因条件消失自动恢复，必须人工解锁（避免重新撞进同一危险）。发布
  `/safety/state`（transient-local）、`/safety/event`、`/safety/heartbeat`、
  `/safety/lock_active`；服务 `/safety/get_state`、`/safety/unlock`、`/safety/set_lock`。
- **锁存，非致命不锁**：任何 CRITICAL 事件锁存 `LOCKED`（锁存不因条件消失自动
  恢复，必须人工解锁——避免重新撞进同一危险）；看门狗区分 `critical`（掉线即锁）
  与 `observed`（掉线仅 WARNING）；单帧噪声由 M-of-K 迟滞过滤；WARNING 永不锁存。
  监视器失联时工具层的 fail-closed 按 `safetyStrict: 'reject'`（默认 `'warn'` 放行并提示）。
- **按机器人注册**：`robot_register` 写入通用 `safety` 段（URDF 派生速度/力矩限位）
  并自动拉起监视器；`robot_profile.py safety set <key> <json>` 可改任意阈值/话题/名单
  （schema 校验）。无力矩反馈时力矩检查自动禁用。**预留层**（接口已注册，不实现）：
  几何预检（指令路径上的关节限位/速度/FK 自碰撞——`motion.max_velocity` /
  `max_acceleration`）、计算力矩前馈输入（`torque.feedforward_topic`）、YOLO 类
  轻量触发、非 ROS 急停通路（`estop`）。
- **工具层安全门**：`moveit_move` 执行前查 `/safety/state`——LOCKED 恒拒绝
  （`SAFETY_LOCKED`）；监视器失联时 `safetyStrict: 'reject'`（fail-closed）拒绝 /
  `'warn'`（默认）放行并提示。`robot_safety_arbitrate` 跑固定格式化 VLM 仲裁，
  非 safe 一律提示人工裁决。
- **取证**：关节/力矩环形缓冲在每次 CRITICAL 锁死时落盘到 `forensics.dump_dir`，
  供事后 / VLM 诊断。

```bash
# 构建 safety 包（与 vlm/、offscreen/ 同一 colcon 工作区）
ln -s <repo>/safety /tmp/vlm_ws/src/dsh_ros2_safety
cd /tmp/vlm_ws && colcon build --symlink-install && source install/setup.bash
```

`safety_core` 纯逻辑自带故障注入自测（`python3 packages/safety/safety/scripts/safety_core.py
--selftest`，12 个场景）——无需 ROS2 即可验证状态机。

## 机器人注册与通信拓扑维护

**设计意图**。机器人的本体（URDF link/joint、相机、MoveIt 组、零位语义）与通信拓扑，
每次重新发现成本很高。插件将它们固化为**结构化档案**
（`~/.dsh-ros2/robots/<name>.yaml`）：首次接触注册一次，之后即时读取。对通信图，
全量逐节点深挖在复杂机器人（成百上千话题/服务）下不可扩展，因此设计取**折中**：
**聚合层快照**（轻量的节点/话题/服务清单）+ **使用中渐进学习**（只记录真正重要的节点）。

| 工具 | 职责 |
| --- | --- |
| `robot_register`（L2） | 采集本体信息（URDF link/joint、TF 根、相机、MoveIt SRDF 组、**自动联动零位语义校准**与通用 **`safety` 段**——URDF 派生限位）写入档案；随后自动拉起 safety_monitor（`startSafety: false` 可关） |
| `robot_load`（L1） | 按名加载档案为结构化 JSON——快速路径，无需重新发现；name 为空列出全部 |
| `robot_topology`（L1/L2） | 通信拓扑：`snapshot`（L2，聚合清单）、`learn`（L2，单个重要节点的角色/描述 + pub/sub/srv/act，严格 schema）、`show`（L1，读回）、**`diagnose`（L1——知识增强诊断：知识库 + 快照 × 实时图交叉比对：missing / new / drift / topic_drift）**、**`search`（L1——知识库高效检索：按 topic 反查 / 按 name/role/description/连接关键字匹配）** |
| `ros2_zero_pose_semantics`（L2） | 经"渲染 + VLM + 使用者确认"校准零位（臂/肘/手掌组合或自定义文字）；档案自动纳入 |

配套两个内置 skill 完成闭环：**`robot-registration`**（首接触流程：问名称/URDF →
采集 → 注册 → 校验，并建立拓扑基线快照）与 **`robot-retrieval`**（即时加载档案，
据此拉起渲染/诊断/运动——含已学习的拓扑与零位语义）。

**实现方式**。全部为 `~/.dsh-ros2/` 下的结构化 YAML：`robots/<name>.yaml`（本体 +
拓扑）与 `zero-pose.yaml`（校准）。`robot_register` 固化本体；`robot_topology
snapshot` 固化聚合层；`robot_topology learn` 在使用中逐个追加重要节点（幂等合并）。
`robot_load` 与 `robot_topology show` 即时读回——一次调用替代 N 次发现。

**知识库是被消费的，而非只存不读。** `robot_topology diagnose`（L1 只读）是
**知识增强诊断**的入口：载入已学节点 + 快照，与实时 ROS2 图交叉比对——

- `missing`：已学但当前不在线的节点（控制器/发布者掉线）——最高优先级；
- `new`：在线但未入知识库的节点（learn 候选）；
- `matched[].drift`：每个已学节点的期望 pub/sub/srv/act vs 实时（缺话题 = 连接
  消失；多话题 = 节点已变化）；
- `topic_drift`：聚合快照话题 vs 实时话题。

`ros2-diagnostics` 与 `robot-retrieval` 两个 skill 都以 `diagnose` 开始诊断，
并用 `learn` 记录重要的 `new` 节点收尾——知识库每次会话都在变好，诊断一次比一次快。

---

## 内置技能

| Skill | 内容 |
| --- | --- |
| `ros2-diagnostics` | 何时用哪个工具、如何由宽到窄定位、排查"话题无数据"/消息格式不匹配/TF 问题的方法论 |
| `robot-state-vision-analysis` | 完整流水线：状态读取 → 离屏渲染 → 传 VLM → 交叉验证（含 Jazzy `Description Source/Topic`、URDF↔TF 帧名一致、`file://` mesh、视距、`FM frames` 信号、校准后的零位语义） |
| `robot-registration` | 首接触流程：问名称/URDF → 采集本体 + 零位语义校准 → `robot_register` → 拓扑基线快照 |
| `robot-retrieval` | 即时加载档案（`robot_load`）并拉起渲染/诊断/运动；读取并渐进学习通信拓扑（`robot_topology`） |

---

## 配置

| Key | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| `rosSetup` | string | `''` | 准备环境的 shell 前缀，如 `source /opt/ros/jazzy/setup.bash && ` |
| `timeoutMs` | number | `15000` | 单命令超时 |
| `rosLogDir` | string | `''` | 覆盖 `ROS_LOG_DIR`（`~/.ros/log` 不可写时很有用） |
| `workspaceRoot` | string | `''` | 工具省略 `cwd` 时 `colcon`/`rosdep` 的工作目录 |
| `includeStderr` | boolean | `false` | 成功结果附带尾部 stderr |
| `display` | string | `''` | GUI/截图工具的 DISPLAY 覆盖 |
| `screenshotDir` | string | `''` | 截图输出目录（默认 `$TMPDIR/dsh-ros2`） |
| `screenshotCommand` | string | `''` | 自定义截图命令；`{output}` 替换为 PNG 路径 |
| `vision.provider` | string | `'mock'` | `mock` \| `gemini` \| `openai` |
| `vision.apiKey` | string | `''` | 你的 API key（用户提供；永不记录日志） |
| `vision.model` | string | `''` | 模型覆盖（如 `gemini-2.5-flash`、`gpt-4o-mini`） |
| `vision.baseUrl` | string | `''` | API base URL 覆盖（OpenAI 兼容端点） |

> `rosLogDir` 同样覆盖工具拉起的 ROS2 Python CLI（`topic echo/pub`、`ros2 run`）；此外 `runCommand` 在 `~/.ros/log` 不可写时自动回退到可写目录。

---

## 项目结构

```
dsh-ros2/                      # pnpm monorepo（工作区根，private）
├── pnpm-workspace.yaml        # packages/*
├── tsconfig.base.json
├── packages/
│   ├── common/                # dsh-ros2-common（非 bundle）：runner / parse / toolkit + scripts/robot_profile.py（零复制）
│   ├── core/                  # dsh-ros2-core（37 工具）：L1 诊断 + L2 管理 + L3 GUI + ros2-diagnostics skill + gui.ts + pty_session.py
│   ├── profile/               # dsh-ros2-profile（4 工具）：robot_register/load/topology + 零位校准 + registration/retrieval skills
│   ├── moveit/                # dsh-ros2-moveit（4 工具）：discover/status/motion_validate/moveit_move + moveit_*.py + motion_validator.py
│   ├── safety/                # dsh-ros2-safety（5 工具）：robot_safety_* + safety/ ROS2 包 + safetyStrict 配置
│   ├── vision/                # dsh-ros2-vision（5 工具）：视觉工具 + vlm/ + offscreen/ ROS2 包 + vision provider 服务 + state-vision skill
│   └── dsh-ros2/              # 聚合 bundle（apply 为空，向后兼容）
├── docs/                      # architecture.md · safety.md / safety-handover.md / safety-todo.md / safety-gpt-review.md · test-*.md · plugin-split-plan.md · versioning.md
├── .github/workflows/         # CI：Node 22/24 → 工作区 typecheck/test/build + 每包 tarball 校验
└── CHANGELOG.md               # 版本变更记录（Keep a Changelog）
```

---

## 插件拆分（7 个包）

自 v0.15.0 起插件为 **pnpm monorepo**，含 7 个 npm 包（见
[`docs/plugin-split-plan.md`](docs/plugin-split-plan.md)，ISP 收紧版）：51 工具 +
4 skills 全部保留、**名称与行为不变**。按需安装域包（或安装 `dsh-ros2` 聚合包获得全集）：

- `dsh-ros2-common` 为纯库（非 cordis bundle）——共享 runner/解析/toolkit 与
  `scripts/robot_profile.py`（零复制）；
- 跨包运行时契约不变：`/vlm/describe`、`/safety/state`、`/safety/set_lock` 等；
  `safetyStrict` 语义不变；
- `dsh-ros2-vision` **修复 npm 发布缺陷**：`files` 已含 `vlm/` + `offscreen/`；
- vision provider 为可选 cordis 服务（`dshRos2.vision`）；`ros2_gui_observe`（core）
  与 `ros2_zero_pose_semantics`（profile）在缺失时降级报 `VISION_UNAVAILABLE`。

## 故障排查 / FAQ

- **`~/.ros/log` Permission denied**：ROS2 写日志目录失败。设 `rosLogDir`（如 `/tmp/ros-log`）即可；`runCommand` 也会自动回退。
- **stderr 里一堆 `RTPS_TRANSPORT_SHM` / FastDDS SHM 警告**：SHM 传输不可用（常见于容器/受限环境）的无害噪音，工具默认丢弃。
- **`ros2 topic echo` 返回空**：先 `ros2_topic_info -v` 看 publisher 数与 QoS；transient-local 话题用 `--qos-durability transient_local` 采样。
- **RViz2 离屏渲染"零件全部堆在原点"**：URDF link 名与 TF 帧名不一致（详见上文 mesh 渲染要点 3）；先看节点日志 `FM transformHasProblems(<link>)=1` 定位。
- **RobotModel 没有 mesh（`Links` 空）**：Jazzy 必须用 `Description Source/Topic`，旧 `Robot Description:` 无效。
- **`Could not load resource ... Unable to open file`**：mesh 路径需绝对路径或 `file://` 前缀。
- **发布者退出后收不到描述**：URDF 发布者须常驻（transient-local 只对后订阅者补发一次，进程退出即失效）。
- **`vision_bringup` 曾漏发现部分图像话题（实测 2/4 路）**：已修复——现在每 `--refresh` 秒（默认 10）刷新发现，后续出现的话题自动补桥、消失的话题自动停桥。

---

## 开发

```bash
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm run test        # vitest（115 例；CLI 输出 mock）
pnpm run build       # tsc -> lib/ + lib/types/
```

CI（`.github/workflows/ci.yml`）：push 到 `main` / PR 时在 Node 22 与 24 上跑 typecheck/test/build，并校验 `pnpm pack` 产物包含补丁层（`cordis.patch.yml`）与构建产物。

发布流程（npm 与 GitHub Release）见 [`PUBLISH.md`](PUBLISH.md)。

---

## 路线图

- [x] `vision_bringup` 轮询/刷新发现（晚出现话题自动补桥、消失自动停桥）；
- [x] 零位语义：通用校准流程（`ros2_zero_pose_semantics`，渲染 + VLM + 使用者确认，三维组合）并联动进机器人档案；
- [x] npm 发布（9 个包 @ 0.1.0 已发布到 npmjs，2026-08-30；`dsh-ros2-state`/`dsh-ros2-sidecar` 于 2026-09 补齐；见 [docs/versioning.md](docs/versioning.md)）；
- [ ] 更多 ROS2 版本（Humble / Rolling）兼容验证。

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | 设计概览、四层能力、L4 视觉与离屏渲染架构、性能演进、安全模型 |
| [`docs/compatibility.md`](docs/compatibility.md) | 兼容基线 |
| [`docs/safety.md`](docs/safety.md) | 安全边界：六层（agent 权限 / 人工审批 / 运动校验 / 执行监视 / 事后验证 / 物理机器人安全）、fail-closed 与降级策略、"DSH 非功能安全系统"声明 |
| [`docs/safety-handover.md`](docs/safety-handover.md) | 本体适配交接：通用框架/接口 vs 本体数据源/算法、profile `safety` schema、接口定义 |
| [`docs/safety-todo.md`](docs/safety-todo.md) | GPT 评审结论与批次：0.14.1 已完成（确定性校验）、0.15+（GUI 白名单 / 审计 / C++ 实时节点…） |
| [`docs/test-robot-state-vision.md`](docs/test-robot-state-vision.md) | 真机端到端实测：流水线、实时性、mesh/TF 绑定修复与验证、四路联合分析（含图） |
| [`docs/test-gpu-passthrough.md`](docs/test-gpu-passthrough.md) | GPU 直通验证：硬件、排查、结果、使用方式 |
| [`CHANGELOG.md`](CHANGELOG.md) | 版本变更记录（Keep a Changelog） |
| [`docs/versioning.md`](docs/versioning.md) | GitHub tag ↔ npm 包版本对应关系（monorepo 重基线；旧单体 tag v0.8–v0.15 从未上 npm） |

---

## 贡献

欢迎提交 Issue 与 PR（中文或英文均可）。请保证 `pnpm run typecheck && pnpm run test && pnpm run build` 全绿，并更新相应文档。

## 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — 插件宿主框架；
- ROS2 / RViz2 社区 — 渲染与工具链基础。

## License

[MIT](LICENSE)
