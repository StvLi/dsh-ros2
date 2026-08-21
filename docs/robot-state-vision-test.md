# 机器人状态视觉分析：skill 流水线测试与实时性

> 版本 0.7.0 · 2026-08-20 · 使用 `robot-state-vision-analysis` skill 的完整流水线
> （状态读取 → 离屏渲染 → 传 VLM → 交叉验证）分析真机当前状态，并给出实时性评估。

---

## 1. 方法与流水线

按 skill 指导执行（无头，图像全部来自话题/渲染内核，不依赖 X11 截图）：

```
① 拓扑与状态（L1）   ros2_node_list / joint_states / tf
② 离屏渲染（L4）     rviz_offscreen_node（Xvfb + Grid/TF/RobotModel，Fixed Frame=chest）→ /rviz/scene
③ 传 VLM（L4）       vlm_node + vision_bringup → ros2_vision_analyze /rviz/scene
④ 交叉验证           视觉结论 ↔ 关节数值 ↔ 机器人零位标定语义
```

**零位语义标定（用户提供）**：关节全 0 = **侧平举、肘窝向前**；当前关节非零 = **双臂自由下垂**。

---

## 2. 当前状态分析结果（双臂自由下垂）

### 2.1 关节数值（`/lite/joint_states`，权威）

| 关节 | 左臂 | 右臂 | 解读 |
| --- | --- | --- | --- |
| shoulder_roll | **-1.353 rad** | **+1.384 rad** | 外展 ~±77° → 双臂落下（非侧平举） |
| wrist_yaw | +0.809 rad | +1.576 rad | 腕部回正角度 |
| shoulder_pitch / yaw / elbow_pitch | 0.05 / 0.10 / -0.14 | 0.06 / 0.40 / -0.24 | 其余关节近零 |
| gripper | +0.02 | +0.02 | 闭合/零位 |

**构型结论：双臂自由下垂**（符合用户标定：非零位 ⇒ 下垂）。

### 2.2 离屏渲染视觉（VLM，gemini-2.5-flash）

![当前状态离屏渲染](images/robot_scene.jpg)

- **双臂姿态：下垂** ✅（与关节数值、用户标定一致）；
- 站姿：直立且左右对称，朝向一致无扭转；
- **TF 树完整健康**：所有关节坐标轴正确挂载、无飞离/堆叠失效；
- 无物理配置异常；足/盆骨区坐标轴密集属多关节显示的常规现象。

### 2.3 交叉验证结论

| 来源 | 姿态判断 | 一致性 |
| --- | --- | --- |
| 关节数值 | 自由下垂（shoulder_roll ±77°） | 权威基准 |
| VLM 视觉 | 下垂（但附带"接近零位"措辞） | 姿态✅；**零位语义混淆** |
| 零位标定 | 零位=侧平举；当前≠零位 | 确认当前为下垂 |

**发现**：VLM 对姿态的**粗粒度判断正确**（下垂），但其"零位/中性"语义与机器人实际零位定义
（侧平举）不符——源于缺少机器人零位标定信息，**非 skill 硬性问题**；后续可为 skill 补充
各机器人零位语义（如"零位=侧平举、肘窝向前"）以提升视觉解读精度。

---

## 3. 实时性分析

### 3.1 单轮流水线耗时（稳态）

| 阶段 | 耗时 | 说明 |
| --- | --- | --- |
| 状态读取（joint_states） | **~1.2s** | `topic echo --once`（含 DDS 发现） |
| 离屏渲染帧就绪 | 一次性 ~20s | xvfb + OGRE 冷启动（机器人链路常驻后为零） |
| vision_bringup 建桥 | 一次性 ~14s | bridge 启动 + service 注册（常驻后为零） |
| **VLM 分析**（`ros2_vision_analyze`） | **~5.9s** | service 端 HTTP（网关推理主导） |
| **单轮合计**（冷启动后） | **~7.1s** | 状态读取 + VLM（渲染/桥常驻） |

### 3.2 性能构成

- **VLM HTTP（~6s）为绝对主导**，由网关/模型决定，非插件瓶颈；
- 链路开销（bridge 内存直传、无磁盘/重编码、无取帧子进程）**~1s/轮**；
- 并行化收益：多话题分析可并行（vlm_node MultiThreadedExecutor + bridge 多路）；
- 常驻组件（vlm_node / vision_bringup / rviz_offscreen）消除冷启动后，**持续观察场景单轮 ~7s**。

### 3.3 与历史链路对比

| 阶段 | 截图链路（废弃） | 话题+并行 VLM | bridge 常驻（当前） |
| --- | --- | --- | --- |
| 图像获取 | X11 截图+落盘 | 取帧冷启动+磁盘 | 桥接内存直传 |
| 链路开销/轮 | 依赖显示/窗口 | ~2s | **~1s** |
| 无头 | ❌ | ✅ | ✅ |

---

## 4. 结论

- **机器人状态**：双臂自由下垂、直立对称，TF 树完整健康，无物理/变换异常；
- **流水线可用**：skill 指导的「状态→渲染→VLM→交叉验证」在真机（19 节点）上端到端可用，
  `ros2_vision_analyze` 插件工具本体直接工作；
- **交叉验证有效**：视觉（下垂）与数值一致；VLM 零位语义需机器人标定信息补充（后续可选）；
- **实时性**：稳态单轮 ~7s，VLM 推理主导；常驻组件后持续观察可行。

---

## 5. 补充：mesh 渲染与联合分析（v0.8.0，2026-08-20）

### 5.1 机器人本体 mesh 渲染验证

离屏渲染**成功渲染机器人实体几何**（不再只有 TF 骨架）：

![机器人 mesh 渲染](images/robot_mesh_full.jpg)

- VLM 确认：白色立体模型（底座/躯干/头部连杆外壳），姿态直立，无关节异常/畸变；
- 三个关键根因（详见 `architecture.md` §4.4）：Jazzy RobotModel 属性格式
  （`Description Source/Topic`）、mesh 路径需 `file://` 前缀（resource_retriever fopen
  限制）、视距需适配 mesh 尺度；
- 局限：双臂 mesh 在当前视角/构型下不明显（待视角或构型调整；mesh 本身已加载，
  日志无加载错误）。

### 5.2 联合分析（RViz2 可视化 + 手眼/头部相机，4 路并行）

| 通道 | VLM 结论 |
| --- | --- |
| **RViz2 场景**（mesh 渲染） | 机器人简化几何结构、直立、无异常 |
| **head 头部相机** | 室内工作区，几人在组装机械设备，零件工具散落，无异常 |
| **wrist_left 手眼** | 机器人自身结构（白部件「1」标签 + 黄色防护装置），无异常 |
| **wrist_right 手眼** | 白面板「R」标识 + 木制结构，无异常 |

**四路图像**（`image_snapshot` 从话题取帧，1280×720）：

| head 头部相机 | wrist_left 手眼 | wrist_right 手眼 |
| --- | --- | --- |
| ![head](images/camera_head.jpg) | ![wrist_left](images/camera_wrist_left.jpg) | ![wrist_right](images/camera_wrist_right.jpg) |

**联合结论**：3D 渲染（本体几何/姿态）+ 头部相机（环境/人员）+ 手眼相机（近距结构/标签）
四通道互补，状态正常无异常。每路分析 3~6s（VLM 主导）。

### 5.3 发现（记录）

- `vision_bringup` 一次性发现可能不完整（本场合计发现 2/4 路，head 与 rviz_scene
  需手动补桥）——后续可加轮询/刷新发现；
- mesh 渲染的 URDF 发布者需常驻（transient-local 发布者退出后新订阅者收不到）。

---

## 6. 补充：mesh/TF 绑定修复与正确渲染验证（v0.8.1，2026-08-20）

### 6.1 问题：所有零件堆叠在原点

v0.8.0 的 mesh 渲染图（§5.1）视觉上**全部零件 + TF 坐标轴堆叠在原点**，与
"mesh 应与 TF 绑定"的预期不符。排查结论：

1. **根因 = URDF 与 TF 帧名不匹配**：发布给 RobotModel 的 URDF 是一套 `_link` 后缀
   的旧文件（`left_shoulder_pitch_link`…），而真机 TF 帧名为**不带后缀**的
   `left_shoulder_pitch`…。RobotModel 按 URDF link 名查变换全部失败 → 所有 mesh
   渲染到固定坐标系原点。
2. **修复**：直接抓取真机实际描述（订阅 `/robot_description`，21 个 link 名与 TF
   帧名一一对应），mesh 路径改写为 `file:///tmp/live_meshes/…` 后常驻发布到
   `/robot_description_abs`。
3. **次要因素**：`.rviz` 相机 `Distance` 被误设为 8（一次 sed 未匹配），机器人缩成
   画面中心小点；调回 1.8 后得到 RViz 式近景全身视角。

### 6.2 修复后验证

![修复后 mesh/TF 绑定渲染](images/robot_mesh_full.jpg)

- 节点日志（启动 ~3s 后）：`FM: ... frames=21`，且
  `transformHasProblems(chest/left_shoulder_pitch/left_elbow_pitch/right_wrist_yaw/head/base_link)=0`
  —— rviz 自身 TF 缓冲已解析全部机器人帧（新增的内置诊断）；
- 像素分析：白色 mesh 区域 240×435 px、TF 三色轴纵跨 y 48..520，非原点堆叠；
- VLM 确认：头/躯干/双臂完整、各部件位于正确分离位置（"not collapsed into a
  single point"）、双臂下垂（与关节数值、用户零位标定一致）；
- 连续多帧快照字节一致，渲染稳定。

### 6.3 代码变更（`rviz_offscreen_node.cpp`）

- **删除**了错误的自建 `rclcpp::spin(raw_node)` 线程：`VisualizationManager` 内部
  持有一个 `SingleThreadedExecutor`（构造时 `add_node`），`onUpdate()` 里已
  `spin_some`，自行 spin 会因"node already added to an executor"崩溃（exit 250）；
- **新增** FrameManager 诊断：`getTransformer()->getClassId()`（确认 TF 插件而非
  Identity 回退）、`getAllFrameNames()`、`transformHasProblems()`，预热后打印一次
  全帧名，之后每 20s 打印一行帧数，便于判定 mesh/TF 绑定状态。

---

## 7. 补充：彩色 URDF（`lite_urdf`）渲染验证（v0.8.2，2026-08-20）

### 7.1 目标与背景

最新生产描述包 `bar_ws/src/lite_urdf`（xacro：`urdf/lite.urdf.xacro`）的 URDF **带
真实材质**（`<material><color rgba=...>`：白基座/躯干、橙上臂、红前臂、黑关节），
不再是无材质白模。真机栈此时已下线（仅相机节点在线），故采用**静态演示渲染**：
自己起 `robot_state_publisher` 发布该 URDF 的 TF，再离屏渲染。

### 7.2 静态渲染流程（无真机 TF 时的标准做法）

1. `xacro lite.urdf.xacro mode:=arms_grippers emit_ros2_control:=false > /tmp/lite_latest.urdf`
   （24 links / 23 joints / 19 个 visual mesh / 19 个材质颜色；`check_urdf` 通过）；
2. mesh 路径改写为 `file:///home/stvli/Desktop/bar_ws/src/lite_urdf/meshes/...`；
3. `robot_state_publisher` 加载该 URDF 并 **remap `/robot_description:=/robot_description_abs`**
   （同时发布 URDF 与 TF，帧名 = link 名 `xxx_link`，与 URDF 一致，无需额外发布器）；
4. 发布 `/joint_states` 全 0（该模型零位 = 双臂水平侧平举，Z≈0.8 m）；
5. `.rviz`：`Fixed Frame: world_root`（模型根帧），Grid + RobotModel（Description
   Source/Topic → `robot_description_abs`）+ TF；Orbit `Distance 1.7 / Yaw 0.8 /
   Pitch 0.18 / Focal Z 0.55`（焦点对准手臂高度，避免 1.03 m 高基座柱遮挡/裁切）；
6. `rviz_offscreen_node` 渲染（1000×750）。**大 mesh 首次加载需数十秒**（RSS 升至
   ~1 GB、CPU 持续 = 加载中，期间画面静止属正常）。

### 7.3 验证结果

![彩色 URDF 渲染](images/robot_mesh_full.jpg)

- 节点日志：`FM: ... frames=24`，TF 全解析；
- **VLM 确认彩色渲染**：白/浅灰基座立柱躯干头 + **橙上臂**（含夹爪）+ **红前臂** +
  **黑关节**；双臂完整带夹爪；整机（底座到头）无裁剪；
- 像素分析：红色/橙色像素各数千、黑色关节像素存在，非白模；
- 连续多帧快照字节一致，渲染稳定；
- 单 mesh probe（Fixed Frame = 自身、Distance 0.5）可快速验证大 STL 加载与材质
  颜色（红 shoulder_pitch 部件清晰可见）。

### 7.4 踩坑要点

- **视角/焦点是关键**：该模型双臂沿 X 轴水平展开在 Z≈0.8 m 高度，若相机焦点在
  地面（Z=0）且从侧面看，双臂落在视野外或被 1.03 m 高基座柱遮挡 → 画面只见
  "白模柱子"。把 `Focal Point Z` 对准手臂高度即可看到完整彩色机器人；
- 一次只保留**一个** `rviz_offscreen_node` 进程发布 `/rviz/scene`（多进程并存时
  取帧会随机订阅到旧进程的帧；旧进程若订阅到被覆盖的 URDF 会把全部 mesh 堆到
  原点渲染成白团）；
- 零位姿态因模型而异：`lite_urdf` 全 0 = 双臂水平侧平举（与用户对真机
  `bar_description_lite` 的标定一致）。

---

## 8. 补充：动作渲染性能优化验证（v0.9.0，2026-08-20）

### 8.1 目标

dsh-ros2 作为具身基础插件需被快速调用；"渲染机器人动作"（TF 驱动 mesh 重绘）的
原始性能：稳定帧率仅 **1.9 Hz**（每帧 ~526ms），瓶颈为大 mesh（276 万面）软件渲染
+ PNG 中转。

### 8.2 优化与实测（lite_urdf 静态渲染，1000×750）

| 阶段 | 优化 | 稳定帧率 | 每帧 capture | 内存 | 内容保留 |
| --- | --- | --- | --- | --- | --- |
| 原始 | 276 万面 + PNG 中转 | 1.9 Hz | 38ms | 962 MB | 100% |
| ① 低模 | open3d 简化至 38.7 万面 | 7.1 Hz | 38ms | 386 MB | 99.7% |
| ② 直读像素 | `copyContentsToMemory` 跳过 PNG | **10.2 Hz** | **1-2ms** | 386 MB | 99.7% |

- mesh 加载：~90s（原始）→ ~40s（低模）；
- **动作渲染验证**：shoulder_roll 以 10 Hz 摆动时，连续帧差异像素位于双臂区域
  （x 118..706），画面流畅跟随 TF（10.2 Hz）；
- 像素正确性：直读像素与 PNG 路径的渲染统计完全一致（fg 73331 / red 3508 /
  orange 3329），RGB 顺序无误。

### 8.3 工具与结论

- 低模生成：`scripts/simplify_visual_meshes.py`（open3d；勿用 fast_simplification，
  其输出在 OGRE 渲染丢失 ~70% 内容）；
- 节点日志每 100 帧输出 `loop-timing` 可观测循环预算（onupdate / events / spin /
  frame / sleep）；
- 完整动作渲染链路 1.9 → 10.2 Hz（5.4×，rate=10 上限内）。

### 8.4 30 Hz 请求实测（v0.9.1）

把 `rate` 拉到 30 后逐项优化，实测（lite_urdf 低模 38.7 万面，1000×750，静止/运动）：

| 配置（rate=30） | 实际帧率 | 每帧循环 | 说明 |
| --- | --- | --- | --- |
| 原始（processEvents 每帧） | 11.1 Hz | 92ms | onUpdate 30ms + processEvents 30ms + render 31ms |
| + **events 节流**（每 5 帧） | 14.2 Hz | 66ms | processEvents 触发 Qt paint → OGRE **双重渲染**，节流后 events 30ms→0ms |
| + **onUpdate/2**（每 2 帧刷新 TF 位置） | 16.2 Hz | ~48ms | 渲染仍 30Hz；TF 位置刷新 15Hz（FrameManager 缓冲，不丢数据） |
| 800×600 + 全部优化 | 17.1 Hz | ~47ms | render 仍 ~30ms：耗时由**三角形数**决定，分辨率影响小 |
| **30Hz + 运动**（shoulder_roll 摆动） | **15.6 Hz** | ~64ms | 动作渲染场景 |
| 回归：rate=10 + 全部优化 | 10.3 Hz | sleep 主导 | 达 rate 上限，无劣化 |

**结论**：30 Hz 请求下实际最高 ~16–17 Hz。瓶颈为 llvmpipe 软件光栅化 38.7 万面
（render 27–31ms，与分辨率无关）+ rviz display update（onUpdate ~30ms）。**达到
30 Hz 需 GPU 直通（非 llvmpipe）**；本次新增优化（events 节流 + onUpdate/2）使
30 Hz 请求帧率 11.1 → 16.2 Hz（+46%），10 Hz 请求仍达上限。

