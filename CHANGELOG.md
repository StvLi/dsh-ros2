# Changelog

All notable changes to **dsh-ros2** are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[SemVer](https://semver.org/).

## [0.13.7] - 2026-08-23

### Added

- **机器人本体注册与读取**（47 工具 + 4 技能）：
  - `robot_register`（L2 审批）：首次接触机器人时采集本体信息（URDF link/joint、
    TF 根、相机话题、MoveIt SRDF 规划组、**零位语义自动联动校准文件**）写入
    `~/.dsh-ros2/robots/<name>.yaml`；
  - `robot_load`（L1）：按名加载档案为结构化 JSON（快速路径，无需重新发现）；
    name 为空列出全部；helper 用 `yaml.safe_load` 健壮解析（含 datetime 归一化）；
  - **skill `robot-registration`**：首接触流程（询问名称/URDF → 采集 → 注册 →
    校验），强调零位语义必校准；
  - **skill `robot-retrieval`**：按名即时读取档案并用其拉起渲染/分析/运动
    （URDF 路径、TF 根、相机、MoveIt 组、零位语义），替代重复发现。
- 测试：102 例全绿。端到端验证（lite）：register（24 links/23 joints/3 cameras/
  4 groups）→ load 快速读回 → 零位校准文件自动纳入档案。

## [0.13.6] - 2026-08-23

### Fixed

- **`ros2_zero_pose_semantics` analyze 链路修复**：`ensure_rsp` 之前只发布 URDF
  描述（供 RobotModel 加载 mesh），缺少 `robot_state_publisher` 生成 TF——离屏
  渲染无法摆放姿态。改为拉起完整的 `robot_state_publisher`（内联 URDF + remap
  描述话题，订阅 `/joint_states` 生成零位 TF）。

### Verified（lite 静态链路，不带真机）

- `analyze` 全链路：发布全零关节角 → rsp 生成 TF → 离屏渲染 /rviz/scene →
  VLM 描述 → 三维推断，**端到端可用**：
  - VLM：*"T-pose, arms raised horizontally to the sides (lateral raise)"*
  - 推断：`{arm: lateral_raise, elbow: forward, palm: up}`（与 lite 零位=侧平举一致）
  - 12 组合候选完整输出；
  - 渲染帧像素与零位基准一致（fg 73331 / red 3508 / orange 3329）；
- `confirm` 三维组合写入 `zero-pose.yaml` 结构化字段验证通过。

## [0.13.5] - 2026-08-23

### Changed

- **零位语义细化为三维排列组合**（`ros2_zero_pose_semantics`）：
  - 三维度：臂（lateral_raise 侧平举 / hanging 下垂）、肘（forward 向前 /
    upward 向上）、手掌/相机支架（up / forward / down）——2×2×3 = **12 种常用
    组合**，`analyze` 输出全部候选供确认；
  - `confirm` 记录三维组合（arm+elbow+palm）或 **`customText` 自定义文字描述**
    （不含组合时兜底）；写入 `~/.dsh-ros2/zero-pose.yaml` 结构化字段；
  - VLM prompt 改为分别描述三维度，输出推断的三维组合；
  - skill 引用同步更新（先校准、勿假设；三方面确认或自定义）。
- 测试：100 例全绿（confirm 三维 + 自定义路径实测写文件验证）。

## [0.13.4] - 2026-08-23

### Changed

- **零位语义改为通用交互校准**（不绑定任何机器人）：新增
  `ros2_zero_pose_semantics`（L2 审批，第 45 个工具）——
  - `analyze`：发布全零关节角 → 抓取离屏渲染帧（/rviz/scene）→ VLM 描述姿态 →
    输出候选语义（`lateral_raise` / `arms_hanging` / `other`）+ 描述，交使用者确认；
  - `confirm`：把使用者确认的选择 + 描述写入 `~/.dsh-ros2/zero-pose.yaml`
    （可 `--out` 指定），skill/agent 读取使用；
  - 通用：URDF 可指定或复用在线描述；零位关节名从 URDF 提取，无任何机器人专有名称。
- skill `robot-state-vision-analysis`：零位语义章节改为"先校准、勿假设"，引用
  `ros2_zero_pose_semantics` 流程，不再硬编码 DeepCybo Lite。
- 测试：100 例全绿；confirm 实测写入 YAML 验证通过。

## [0.13.3] - 2026-08-23

### Added

- **`ros2_bag_play`（L2 审批）**：回放 rosbag 到其话题（`--topics` 过滤、`--rate`、
  `--loop`、`--start-offset`；前台运行可配 `timeoutMs`，超时返回已启动提示）。
- **`ros2_launch`（L2 审批）**：以后台任务启动 `ros2 launch <pkg> <launch_file>`
  （返回 jobId，`ros2_job_status` 查询、DSH job 控制停止）。
- **skill `robot-state-vision-analysis` 零位语义补充**：明确"全零关节 ≠ 双臂下垂"，
  DeepCybo Lite 零位 = 侧平举/肘窝向前，当前非零 = 双臂下垂；VLM 不能从 TF 骨架
  推断关节角，以 `joint_states` 为准。
- 测试：98 例全绿（bag_play/launch 参数、审批、后台 job 路径）。工具总数 44。

## [0.13.2] - 2026-08-23

### Added

- **MoveIt 更多工具（42 个工具）**，全部通用（标准 moveit_msgs + SRDF，不绑定包）：
  - `moveit_status`（L1 只读）：在线探测标准接口 + 当前关节状态采样 + SRDF 规划帧；
  - `moveit_plan`（L2 审批）：规划（可执行）任意关节目标 `"j1:=v1 j2:=v2"`；
    `planOnly` + `trajectoryOut` 把规划轨迹存为 JSON；
  - `moveit_trajectory`（L2 审批）：通过 `/execute_trajectory` 执行 `moveit_plan`
    保存的轨迹 JSON——实现"规划→执行"分离。
- 共享库 `scripts/moveit_common.py`（SRDF 加载/命名姿态/规划帧/goal 构造/客户端）。
- 测试：96 例全绿（新增三个工具的解析/参数/审批/结果路径）。

## [0.13.1] - 2026-08-23

### Fixed

- **`vision_bringup` 轮询/刷新发现**：原一次性发现会漏掉晚出现的图像话题（实测
  2/4 路）。现在每 `--refresh` 秒（默认 10，`--refresh 0` 保持一次性）重新发现——
  新出现的话题自动补桥、消失的话题自动停桥；实测相机话题陆续出现时逐一补桥、
  发布器停止后自动停桥、Ctrl-C 干净退出。

## [0.13.0] - 2026-08-23

### Changed

- **合并 L3 交互工具为 `ros2_gui_interact`**（41 → 39 个工具）：`ros2_gui_click` /
  `ros2_gui_drag` / `ros2_gui_key` 三个工具合并为一个，用 `action=click|drag|key`
  区分（参数并集，行为不变：窗口激活/相对坐标、按钮、拖拽 orbit/pan/zoom、
  组合键/文本）。README/README_CN 交互配方同步更新。

## [0.12.0] - 2026-08-23

### Added

- **`moveit_cartesian`（第 41 个工具，L2 审批）**——沿笛卡尔路径平移规划组末端
  (dx, dy, dz) 米，通用（不绑定具体 moveit 包）：
  - 仅用标准 moveit_msgs（`/compute_cartesian_path` 服务 + `/execute_trajectory`
    action）+ SRDF；**规划帧取自 `virtual_joint` 的 parent_frame、EE link 取自
    组 chain 的 tip_link**（均可参数覆盖）；
  - `frame=ee`（末端系偏移，默认）/ `frame=world`（规划帧）；长平移按段拆分
    （默认 0.02m/段）逐段规划执行，任一段 fraction 低于 `minFraction` 即中止；
  - `planOnly` 仅规划不执行、`avoidCollisions`、`eefStep`、`jumpThreshold`、
    `timeout` 等参数。
- `moveit_discover` 增强：规划组解析输出 chain 的 base/tip（EE link 来源）。
- 测试：91 例全绿（新增 moveit_cartesian 参数校验/审批 fail-closed/结果解析）。
  本机 smoke：discover 输出 right_arm chain tip；cartesian 在 move_group 未运行时
  明确报"接口不可用"。
- 文档：README/README_CN L2 表、CHANGELOG。

## [0.11.0] - 2026-08-23

### Added

- **MoveIt2 通用接口（第 39/40 个工具，不绑定具体 moveit 包）**——通过**读取
  moveit 包内容**（SRDF）动态配置可快速调用的接口：
  - `moveit_discover`（L1 只读）：扫描宿主上任意**带 SRDF 的 MoveIt 配置包**
    （share/*/config/*.srdf）或直接解析指定 `srdf` 文件，输出规划组（groups）、
    每组命名姿态（named states），并探测标准 move_group 接口在线状态
    （/move_action、/execute_trajectory、/compute_cartesian_path、
    /controller_manager）；
  - `moveit_move_to_pose`（L2 审批）：将规划组移动到 SRDF 命名姿态——**仅用
    标准 moveit_msgs**（move_group action + ExecuteTrajectory）+ SRDF 命名姿态，
    不 import 任何具体 moveit 包；支持 `planOnly` 仅规划、`timeout`、速度缩放。
- 助手脚本：`scripts/moveit_discover.py`（SRDF 解析 + 接口探测）、
  `scripts/moveit_move.py`（通用 move_group 客户端）；`moveit_msgs` 为系统
  Jazzy 标准包，无需 moveit_ws 构建即可发现。
- 测试：87 例全绿（新增 moveit_discover 解析、move 参数校验/审批 fail-closed/
  结果解析）。本机 smoke：`moveit_discover --srdf <lite_moveit2 srdf>` 正确输出
  4 个规划组 + 命名姿态 + 接口在线状态。
- 文档：README/README_CN 工具表、CHANGELOG。

## [0.10.0] - 2026-08-21

### Added

- **`ros2_install` — 鱼香ROS一键安装（第 38 个工具，L2 审批）**：主设备未安装
  ROS2 时，经用户确认后拉起鱼香ROS一键安装（http://fishros.com/install）并以
  **交互式方式**完成：
  - `check`：探测 ROS2 状态——可用 / **已装但未 source**（检测 `/opt/ros/*/setup.bash`，
    提示配置 `rosSetup`，避免重复安装）/ 未装；
  - `start`（审批）：启动安装器于 **PTY 交互会话**（`scripts/pty_session.py`，
    纯 stdlib pty；支持 sudo 密码提示与菜单）；
  - `send` / `status` / `stop`：驱动菜单（数字选择）、观察进度、随时取消；
  - 内置保护：本机已装（含未 source）时 `start` 拒绝，防止误装；`installer`
    参数可指向本地脚本/镜像（测试与离线场景）。
- 端到端测试：mock 安装器完整菜单交互（start→send→status→stop）通过（83 例全绿）；
  本机 smoke：check/start 对"已装未 source"正确拒绝。
- 文档：README/README_CN L2 表、`ros2-diagnostics` skill 新增"ROS2 缺失时一键安装"
  章节、CHANGELOG。

## [0.9.3] - 2026-08-21

### Added

- **GPU 直通渲染验证通过（30 Hz 满帧）**：实测 NVIDIA RTX 4060 Ti + Xorg GLX，
  `rviz_offscreen_node` 30 Hz 请求帧率从 llvmpipe 的 ~22 Hz 提升到 **30.0 Hz
  （满 rate）**；onUpdate（含渲染）30 → 9 ms，且链路开支不增（GPU→CPU 回读
  1–2 ms，远小于渲染节省）。完整测试报告：`docs/gpu-passthrough-test.md`。

### Fixed

- **NVIDIA GLX context 创建失败**（`BadValue`）：rviz 默认 FSAA=4 使 OGRE 选中
  32-bit ARGB visual 的 fbconfig，而 NVIDIA GLX 拒绝在其上创建 GL 3.0 core
  context（实测仅 24-bit / samples=0 配置可创建）。修复：离屏渲染节点调用
  `rviz_rendering::RenderSystem::disableAntiAliasing()`——llvmpipe 回归无劣化
  （22.4 Hz，AA 对离屏渲染无视觉损失）。

### Changed

- 文档：新增 `docs/gpu-passthrough-test.md`（硬件/排查/结果/使用方式）；
  `docs/architecture.md` §5.2 补充 GPU 直通结论。

## [0.9.2] - 2026-08-21

### Fixed / Performance

- **消除"双重渲染"（30 Hz 请求帧率翻倍，11.1 → ~22 Hz）**：`VisualizationManager::onUpdate()`
  内部已 `renderOneFrame()` 渲染场景（受 `render_requested_`/10ms 门控），主循环此前
  又调 `win->render()` 造成**每帧第二次渲染**（+31ms/帧）。去掉冗余渲染后每帧 ~33ms，
  TF 全帧率刷新（onUpdate 每帧）；`onUpdate/2`（v0.9.1 的折中）不再需要。
- 实测（38.7 万面低模，1000×750，rate=30）：静止 22.9 Hz、运动 21.5–24.2 Hz
  （400+ 帧稳态）；10 Hz 请求仍达上限（10.3 Hz）；画面像素与之前一致。
- 代码注释明确"不要在 onUpdate 后再 win->render()"的成因与验证。
- 文档：`docs/architecture.md` §5.2、`docs/robot-state-vision-test.md` §8.4 更新为
  双重渲染发现与新数据。

## [0.9.1] - 2026-08-20

### Performance

- **30 Hz 请求实测与循环开销优化**（详见 `docs/architecture.md` §5.2、
  `docs/robot-state-vision-test.md` §8.4）：
  1. **events 节流**：`app.processEvents()` 每 5 帧调用（headless 下 Qt 事件少；
     每帧处理会触发 Qt paint → OGRE 双重渲染 ~30ms/帧），events 30ms → 0ms；
  2. **onUpdate/2**：`onUpdate` 每 2 帧调用（渲染仍每帧；TF 位置刷新 15Hz，
     FrameManager transformer 缓冲不丢数据），display update 摊销减半；
- 30 Hz 请求实际帧率 **11.1 → 16.2 Hz**（+46%）；运动场景 15.6 Hz；800×600 仅
  17.1 Hz（render 由三角形数决定，分辨率影响小）；10 Hz 请求仍达上限（10.3 Hz）。
- **结论**：llvmpipe 软件光栅化（render 27–31ms/帧，与分辨率无关）为硬成本，
  **达 30 Hz 需 GPU 直通（非 llvmpipe）**。
- 节点 `loop-timing` 日志升级：onupdate/events/spin/frame/sleep 分段可观测。

## [0.9.0] - 2026-08-20

### Performance

- **离屏渲染"动作渲染"提速 5.4×（1.9 → 10.2 Hz）**，两个关键手段（实测，详见
  `docs/architecture.md` §5.1 与 `docs/robot-state-vision-test.md` §8）：
  1. **渲染低模 mesh**：新增 `scripts/simplify_visual_meshes.py`（**open3d** quadric
     decimation，大 STL → 25k/15k 面；实测 276 万 → 38.7 万面），帧率 1.9 → 7.1 Hz、
     内存 962 → 386 MB、mesh 加载 ~90s → ~40s、渲染内容保留 99.7%；
  2. **OGRE 直接读像素**：`rviz_offscreen_node` 用 `copyContentsToMemory` 直读帧
     缓冲，替代 `captureScreenShot`（PNG 写盘）+ libpng 解码——capture 38ms →
     1-2ms/帧，帧率 7.1 → 10.2 Hz（达 rate 上限）。
- 节点每 100 帧打印 `frame-timing: total/render/capture/pub`（~10s @10Hz），
  每帧预算可观测。

### Fixed / Notes

- **不要用 fast_simplification 生成渲染低模**：实测其输出在 OGRE 中渲染丢失 ~70%
  内容（open3d 输出完整；工具脚本已内置结论）；
- OGRE vendor 头 include 规范（`<OgreRoot.h>` 不带 `OGRE/` 前缀）+ CMake
  `find_package(rviz_ogre_vendor)` + `include_directories(BEFORE ${OGRE_INCLUDE_DIRS})`。

### Added

- 文档：`docs/architecture.md` §5.1（性能优化）、`docs/robot-state-vision-test.md`
  §8（动作渲染优化验证）；README 特性栏更新。

## [0.8.2] - 2026-08-20

### Added

- **彩色 URDF 渲染验证**（`lite_urdf` 最新生产描述包）：URDF 内 `<material>` 材质
  颜色被 RobotModel 正确应用——白基座/躯干 + 橙上臂 + 红前臂 + 黑关节，不再是白模；
  `docs/images/robot_mesh_full.jpg` 更新为彩色渲染图。
- **静态演示渲染流程**（真机下线时）：`robot_state_publisher` 加载带 `file://` mesh
  的 URDF 并 remap 描述话题，配合 `/joint_states` 发布器即可离屏渲染任意 URDF；
  记录于 `docs/robot-state-vision-test.md` §7。

### Changed

- **文档**：`docs/architecture.md` §4.4 补充材质颜色、相机焦点高度（`Focal Point Z`
  应对准主体高度，避免高基座柱遮挡/裁切）、大 mesh 首次加载耗时特征；
  `docs/robot-state-vision-test.md` 新增 §7（彩色渲染验证 + 静态渲染流程 +
  视角/多进程踩坑）；README 截图说明更新。

## [0.8.1] - 2026-08-20

### Fixed

- **RViz2 离屏渲染"零件堆叠在原点"问题**：根因是发布给 RobotModel 的 URDF link 名
  与实时 TF 帧名不匹配（`_link` 后缀旧文件 vs 真机裸名），导致所有 link 变换查找失败、
  mesh 全部渲染到固定坐标系原点。修复方式：直接抓取真机 `/robot_description`
  （link 名与 TF 帧名一一对应）+ `file://` mesh 路径改写后常驻发布。
- **删除自建 `rclcpp::spin(raw_node)` 线程**：`VisualizationManager` 内部持有
  `SingleThreadedExecutor`（`onUpdate()` 已 `spin_some`），自行 spin 触发
  "node already added to an executor" 崩溃（exit 250）。
- **新增 FrameManager 诊断**：启动 ~3s 后打印 transformer 类型、帧数、全帧名与
  `transformHasProblems(...)` 判定，之后每 20s 打印一行帧数——mesh 是否正确绑定 TF
  可直接从日志判定。

### Changed

- **相机视距修正**：Orbit `Distance` ≈ 1.5–2.0 m 得到 RViz 式近景全身视角（误设 8 时
  机器人缩成画面中心小点）。
- **skill `robot-state-vision-analysis` 更新**：离屏渲染步骤补充 Jazzy
  `Description Source/Topic`、URDF↔TF 帧名必须一致（否则堆叠原点）、`file://` mesh
  路径、视距 1.5–2.0 m 与 `FM frames` 判定信号；交叉验证新增"全渲染在原点"的排查路径。
- **文档**：`docs/architecture.md` §4.4 与 `docs/robot-state-vision-test.md` §6
  记录根因、修复与验证；`docs/images/robot_mesh_full.jpg` 更新为修复后正确渲染图，
  并补充三路相机实拍图（`camera_head.jpg` / `camera_wrist_left.jpg` /
  `camera_wrist_right.jpg`）嵌入联合分析 §5.2。

## [0.8.0] - 2026-08-20

### Changed / Fixed

- **RViz2 离屏渲染支持机器人本体 mesh 渲染**：实测定位并解决三个根因——
  ① Jazzy RobotModel 需 `Description Source/Topic` 属性（旧 `Robot Description:` 被忽略）；
  ② URDF mesh 路径需绝对路径或 `file://` 前缀（裸路径 `resource_retriever` fopen 失败）；
  ③ 视距需适配 mesh 尺度。详见 `docs/architecture.md` §4.4。
- **联合分析验证**：RViz2 场景（mesh 渲染）+ 头部相机 + 左右手眼相机 4 路并行分析，
  状态正常；记录于 `docs/robot-state-vision-test.md` §5。
- **文档**：新增 mesh 渲染图 `docs/images/robot_mesh_full.jpg`；记录 `vision_bringup`
  发现不完整（2/4 路）与 transient-local 发布者需常驻的局限。

## [0.7.0] - 2026-08-20

### Added

- **新 skill `robot-state-vision-analysis`**：封装「状态读取 → 离屏渲染 → 传 VLM → 交叉验证」
  的无头机器人状态分析流水线（L1 状态工具 + L4 视觉链路组合；含最小 `.rviz` 配方、
  零位构型下 TF 轴共线属预期的交叉验证指导）。
- **测试**：79 用例（新增 skill 结构/内容断言）；真机端到端验证——19 节点链路下
  关节零位读取、离屏渲染 `/rviz/scene`、bridge VLM 分析 5.7s 全部通过，
  结果记录于 `docs/architecture.md` §6.5。
- **文档**：`docs/robot-camera-analysis.md` 更名为 `docs/robot-state-vision-test.md`
  （机器人状态视觉分析测试与实时性）：双臂自由下垂构型分析（关节 ±77° 外展 + VLM 视觉 +
  零位语义标定交叉验证）、单轮流水线实时性（稳态 ~7.1s，VLM 推理主导）、链路演进对比；
  附当前状态离屏渲染图 `docs/images/robot_scene.jpg`。

## [0.6.0] - 2026-08-19

### Added

- **视觉链路自动建立（vision pipeline）**：自动发现当前 ROS2 全部图像话题
  （`sensor_msgs/Image` / `CompressedImage`），为每路自动拉起
  `vlm_bridge_node`（参数化 `id`：节点名、service/trigger/result 按话题唯一化），
  LLM/harness 按话题直接分析最新帧。
  - `vision_bringup`：发现话题 → 批量 spawn bridge → 打印 topic↔bridge_service 映射；
    Ctrl-C 统一关闭；
  - `vlm_bridge_node` 支持 `id` 参数（多路并存）；`vlm_bridge_call` 支持 `service` 参数；
  - 新工具 **`ros2_vision_topics`**（列出图像话题 + 桥接 service 名）、
    **`ros2_vision_analyze {topic, prompt}`**（按话题路由到对应 bridge service，内存直传）。
  - **实测**（左右手腕相机）：bringup 自动发现 3 路并建链；wrist_left / wrist_right
    经各自 bridge 分析成功（service 5.5s / 3.9s），VLM 发现手腕处胶带卷边/面板污损等细节。
- **测试**：77 用例（vision_topics 过滤+映射、vision_analyze 路由、工具清单 37）。

### Changed（文档维护）

- **文档合并精简**：`docs/vlm-ros2-architecture.md` 并入 `docs/architecture.md`（全景架构：
  L1–L4 分层、执行缝隙、实时视觉架构、**架构演进性能对比**、安全模型、兼容性）；
  删除 `docs/turtlesim-test-report.md`（早期 X11 截图链路过程记录）与无引用图片；
  README L4 工具表补全（vision_topics / vision_analyze）、`compatibility.md` 补 L4 依赖。

## [0.5.0] - 2026-08-19

### Added

- **常驻图像→VLM 桥接节点（`vlm_bridge_node`）**：持续订阅一路图像话题（raw /
  CompressedImage）并**仅缓存最新帧字节**；只有在被 LLM 触发时才把帧转发给
  `vlm_node` 分析——平时零开销、无进程冷启动。
  - service `/vlm_bridge/analyze_latest`（同步请求-响应，`VlmBridgeAnalyze.srv`）；
  - topic `/vlm_bridge/trigger`（JSON `{prompt, model}`）→ `/vlm_bridge/result`
    （`VlmDescription.msg`，transient-local 缓存，异步）；
  - **内存字节直传**（`image_bytes_b64`）：compressed JPEG 话题免解重编、免磁盘中转。
- **`ros2_vlm_analyze` 新增 `useBridge` 模式**：走 `/vlm_bridge/analyze_latest` 分析
  桥接最新帧（无需先取帧文件）。
- **并发设计**：VLM client 由**专用 spin 线程**服务（executor 回调内等待自己的 client
  响应会死锁；本环境 coroutine 回调亦不可用——已实测排除），service/trigger 回调仅等待。
- **实测效率**：bridge 链路开销（冷启动 + 转发）~0.7s vs 旧链路（取帧+分析两次冷启动
  + 磁盘中转）~2s；VLM HTTP 3.0~4.2s 为主导；trigger→result 5.4s。
- **测试**：73 用例（`ros2_vlm_analyze` useBridge 命令构造）。

### Fixed

- **`ros2_vlm_analyze` useBridge 模式传空 `-p model:=` 导致 rclpy 解析失败**：
  空值参数不再下发（74 用例）。

### Changed

- **文档**：`docs/robot-camera-analysis.md` 更新至 v0.5.0——最新三路相机分析
  （head 走 bridge）+ 优化历程性能参数对比（bash 串行 17s → 插件并行 6.6s → bridge
  链路开销 ~0.7s）。

## [0.4.0] - 2026-08-19

### Added

- **RViz2 离屏渲染节点（`offscreen/`，C++ 包 `dsh_ros2_rviz_offscreen`）**：
  驱动真实 rviz 渲染栈（`rviz_common::VisualizationManager` + OGRE + `rviz_default_plugins`），
  在虚拟 X（Xvfb，无物理屏、无窗口层级）上**离屏渲染** .rviz 场景（Grid/TF/RobotModel/
  PointCloud2/Marker 等），读渲染内核输出发布 `/rviz/scene`（`sensor_msgs/Image`）。
  修复链路上的坑：render window 需先 `initialize()`（建 OGRE scene manager）、
  `RenderPanel::initialize(&vm)`（建 viewport/相机）、`vm.load()` 需传
  `Visualization Manager` 子段、主循环用 `QMetaObject::invokeMethod(vm,"onUpdate")`
  显式驱动 Display 数据流（rviz 默认 QTimer 依赖 Qt 事件循环，无头下不触发）。
- **实测验证**：Grid+TF（static TF map→odom→base_link）渲染出网格与双坐标轴，
  VLM 正确解读（「网格地面、红绿蓝三轴、Orbit 视角」）；相机话题 `/camera/image`
  直取帧 → VLM 识别画面内容。图像全程走话题，零显示器依赖。
- **文档**：`docs/vlm-ros2-architecture.md` §7.5（方案/实测/构建启动/已知限制）。

### Known limitations

- `rviz_default_plugins/Image`（相机贴图面板）无头下内嵌面板崩溃——相机图直接用
  `ros2_image_snapshot` 从话题取帧（更直接，已实测）；
- 每帧经 PNG 编解码，5Hz 足够 VLM；高帧率可改直接 readPixels。

### Removed

- **移除 `turtle_render_node`（自绘简化图渲染器）及其产物**：早期用于验证通道的
  OpenCV 自绘渲染不符合真实需求（图像应来自真实数据源：相机话题 / RViz2 离屏渲染），
  已删除代码、`docs/images/e2e_*.jpg` 与相关文档段落；
  `ros2_image_snapshot` 默认 topic 改为 `/camera/image`。

### Changed

- **`ros2_image_snapshot` 支持 `CompressedImage` 话题**（真机相机常见 `image_raw/compressed`）：
  新增 `compressed` 参数，脚本端 `cv2.imdecode` 解码 jpeg/png；
  实测对机器人三路相机（head/wrist_left/wrist_right，1280×720）取帧 + VLM 分析全部成功。
- **配置提示**：web profile 的 dsh-ros2 配置新增 `rosSetup: source /tmp/vlm_ws/install/setup.bash &&`
  （让插件工具直接找到 `dsh_ros2_vlm` 包；本机演示用，真机按实际 workspace 调整）。

## [0.3.0] - 2026-08-19

### Added

- **L4 实时视觉（并行 VLM + 无头图像通道）**：
  - **ROS2 包 `dsh_ros2_vlm`（`vlm/`）**：`vlm_node`（独立进程的 VLM 分析节点：
    service `/vlm/describe` + transient-local 缓存 topic `/vlm/description`，MultiThreadedExecutor
    并行处理，API key 走参数/`VLM_API_KEY`）、`turtle_render_node`（无头渲染器：`/turtle1/pose`
    → `/turtle1/render` 图像话题，OpenCV，无 X11）、`image_snapshot`（话题取最新帧存 JPEG）、
    `vlm_call`（service 客户端，输出 JSON）。接口 `VlmDescribe.srv` / `VlmDescription.msg`。
  - **插件新工具（35 个）**：`ros2_image_snapshot`（从 `sensor_msgs/Image` 话题取帧，彻底替代
    X11 截图通道）、`ros2_vlm_analyze`（调 `/vlm/describe`，最新结果缓存秒读）。
  - **`runCommand` 自动 ROS_LOG_DIR 回退**：`~/.ros/log` 不可写时自动用 `/tmp/ros-log-<uid>`，
    锁定的无头主机开箱即用（ROS2 Python CLI 不再因日志目录崩溃）。
- **文档**：`docs/vlm-ros2-architecture.md`（架构/组件/启动/实时性对比/端到端验证）；
  turtlesim 端到端闭环实测：直线/圆弧两帧经话题取帧 + VLM 解读与 pose 数据逐项互证，
  service 单次分析 1.6~2.0s，latest 缓存 0 等待。
- **测试**：71 个 vitest 用例（新增 `ros2_image_snapshot` / `ros2_vlm_analyze` 命令构造与解析、
  `ensureWritableRosLogDir` 三分支）。

## [0.2.0] - 2026-08-17

### Added

- **L3 交互（P4「能看也能动」，3 个工具）**：`ros2_gui_click`（xdotool 点击/滚动，窗口激活 + 坐标移动 + `--repeat`）、
  `ros2_gui_drag`（按下-拖动-释放，RViz2 视点操控：左键旋转/中键平移/右键缩放，支持窗口相对坐标与步进插值）、
  `ros2_gui_key`（按键组合如 `ctrl+shift+r` 重载显示配置 / 文本输入，可先激活窗口）。
- **`GuiManager` 交互原语**：新增可注入 `InteractFn` 缝隙（`activateWindow` 含 `windowfocus` 回退、
  `click` / `drag` / `key`），默认走 `xdotool`（15s 超时，ENOENT 给出安装提示），全走测试 fake。
- **测试**：新增 13 个交互用例（管理器原语 + 工具层），共 62 个 vitest 用例全绿。

### Fixed

- **wmctrl `-lG` 解析字段顺序错误**（真机冒烟发现）：真实列序为 `id desktop x y w h host title`
  （几何在 host 之前，desktop 可为 -1、字段间空白不定），旧正则按 `id desktop host x y w h title`
  解析导致本机枚举 0 窗口——「窗口级截图/交互优雅降级」的真正根因；已修复并补真实输出回归用例，
  窗口级截图与本机窗口匹配随之恢复可用。
- **GUI 进程未透传 `rosLogDir`**：`GuiManager.start` 只注入 `DISPLAY`，`~/.ros/log` 不可写时
  rviz2 因 spdlog 致命错误直接 Abort；新增 `GuiManager env` 注入缝隙，入口将 `rosLogDir` 映射为
  `ROS_LOG_DIR` 传给 GUI 进程。
- **`mousemove_relative` 负坐标被 xdotool 当选项**：负增量需 `--` 分隔（`mousemove_relative -- -3 -6`），
  拖拽步进已加 `--`。
- **`ros2_gui_close` 关不掉通过 `ros2 run` 启动的 GUI**（真机验收发现）：SIGTERM 只发给包装进程，
  rqt_graph 等派生的 python/Qt 进程残留、窗口仍在；且 PyQt 应用会忽略 SIGTERM。现改为
  **进程组 SIGTERM → 轮询等待（默认 3s）→ 进程组 SIGKILL**（`close` 变异步，`groupAlive` 可注入），
  真机验证窗口彻底关闭、无残留进程。

### Changed

- 工具总数 30 → 33；`docs/architecture.md` / `docs/compatibility.md` / `README.md` 同步更新
  （交互依赖 `xdotool`；rviz2 需要 GLX 上下文的环境注意；wmctrl 解析修复后窗口匹配可用）。

## [0.1.0] - 2025-08-17

### Added

- **L1 只读诊断工具集（17 个）**：`ros2_pkg_list`（子串过滤）、`ros2_colcon_list`、
  `ros2_rosdep_check`（缺依赖=诊断发现）、`ros2_node_list`、`ros2_node_info`（结构化解析）、
  `ros2_topic_list` / `ros2_topic_info` / `ros2_topic_echo`（JSON 采样）、
  `ros2_service_list` / `ros2_action_list` / `ros2_param_list` / `ros2_interface_show`、
  `ros2_graph`（节点-话题聚合 JSON 图）、`ros2_tf_list` / `ros2_tf_echo`（含反查）、
  `ros2_doctor`（60s 超时）、`ros2_bag_info`。
- **`ros2-diagnostics` skill**：模型侧调试工作流指导（先广后窄、无数据/消息不匹配/TF 排障）。
- **L2 审批门控管理工具（5 个）**：`ros2_colcon_build`（`ctx.jobs` 后台任务）、
  `ros2_rosdep_install`（dry-run 预览）、`ros2_interface_create`（msg/srv/action 骨架，不覆盖既有文件）、
  `ros2_param_set`（JSON 值类型化）、`ros2_bag_record`（限时录制）；配套只读
  `ros2_jobs_list` / `ros2_job_status`。全部写操作经 `ctx.approval.request`，fail-closed。
- **L3 可视化（6 个）**：`ros2_gui_start`（rviz2/rqt_graph/rqt 预设 + 会话跟踪）、
  `ros2_gui_list` / `ros2_gui_close`（wmctrl 窗口枚举）、`ros2_screenshot`（X11 Pillow 截屏，支持窗口裁剪）、
  `ros2_vision_describe`（Gemini/OpenAI/mock 可插拔视觉）、`ros2_gui_observe`（启动→截图→描述闭环）。
- **测试**：48 个 vitest 用例（解析器、工具行为、审批两分支、后台任务、文件写入、GUI 生命周期、视觉 Provider）。
- **文档**：README（L1/L2/L3 工具表、配置）、`docs/architecture.md`、`docs/compatibility.md`、
  CI 工作流（Node 22/24）、`cordis.patch.yml` 补丁层、MIT License。

[0.2.0]: https://github.com/StvLi/dsh-ros2/releases/tag/v0.2.0
[0.1.0]: https://github.com/StvLi/dsh-ros2/releases/tag/v0.1.0