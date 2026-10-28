# dsh-ros2 安全边界（Safety.md）

> 版本 0.14.1+（monorepo 拆分后位于 `dsh-ros2-safety` 包）· 配套 `safety-handover.md`（本体适配交接）· `safety-todo.md`（GPT
> 意见评审与批次）· `README.md`（使用）

本文档明确 dsh-ros2 安全体系的**边界**：什么被覆盖、什么不被覆盖、各层的职责
与不可替代性。

---

## 1. 六层职责划分（从外到内）

| 层 | 机制 | 覆盖内容 | 由谁执行 |
| --- | --- | --- | --- |
| 1. Agent 权限 | DSH 会话/工具权限体系 | 谁可以调用哪些工具 | DSH / 本插件工具注册 |
| 2. 人工审批 | `ctx.approval.request`（L2） | 每个写操作/运动执行前的人类确认，**fail-closed**（无审批服务或拒绝即失败） | 工具层 |
| 3. 运动校验 | `motion_validator.py`（确定性、无 LLM） | 执行前校验：限位（位置/速度/加速度）、NaN/Inf、关节名与规划组覆盖、时间戳/时长、状态新鲜度、可选 workspace box、指纹 + TTL | 工具层（`moveit_move` / `motion_validate`） |
| 4. 执行监视 | `safety_monitor` 节点（200Hz） | 执行中：轨迹跟踪/堵转（迟滞）、关节反馈丢失、看门狗（critical/observed）、可选力矩；CRITICAL 锁存 `LOCKED` | ROS2 节点（`dsh_ros2_safety`） |
| 5. 事后验证 | `moveit_move` phase 6 | 执行后：终态关节 vs 期望（容差），结果区分 `pass/fail/unavailable` | 工具层 |
| 6. 物理机器人安全 | 本体控制器/PLC/急停 | 硬件级保护（限位开关、力矩限制、急停回路） | **本体厂商/下游适配** |

**执行路径（唯一，见 `safety-todo.md` §21）**：

```
REQUEST → NORMALIZE → PLAN → VALIDATE → APPROVAL → FINGERPRINT CHECK → EXECUTE → WATCHDOG → VERIFY → RESULT
```

工具层唯一运动入口是 `moveit_move`；结构上不存在跳过校验的执行路径（校验失败
在审批前即拒绝，`VALIDATION_FAILED`；执行前指纹/复验变化即拒绝，`VALIDATION_CHANGED`）。

---

## 2. 明确声明（不可替代性）

> **DSH 审批不是运动校验的替代品。**
> **运动校验不是认证机器人安全的替代品。**
> **DSH 不是功能安全控制器（functional-safety controller）。**

- DSH 及其工具**不是**经过认证的安全 PLC / 功能安全系统；不得将本插件的任何
  输出当作安全保证用于人员保护。
- 本插件**不实现**"软件 E-stop"：`safety.estop` 仅为预留接口
  （`{enabled: false, path: ""}`），不假装提供停机保证。
- 物理急停、限位开关、硬件力矩限制等**必须**由机器人本体提供并经下游适配接入
  （`lock_action`、`/safety/lock_active` 订阅、`/safety/state`）。
- 运动校验是**确定性**的（无 LLM 参与）；VLM 仅用于**语义仲裁层**（方案变更/异常
  后的慢层判断），其非 safe 结论一律升级人类裁决，**从不**作为运动放行的依据。

---

## 3. 各层失败模式与对应行为

| 失败模式 | 行为 |
| --- | --- |
| 审批服务不可用 / 拒绝 | 运动工具 fail-closed 拒绝（`APPROVAL_DENIED`） |
| 校验器不可用 / 输出异常 | 视为校验未通过（`VALIDATION_FAILED`） |
| 关节状态缺失 / 过旧（相对运动） | 校验未通过（`state_freshness` fail） |
| 控制器不在线（`require_controller_ready`） | 拒绝（`CONTROLLER_NOT_READY`） |
| 轨迹文件损坏 / 指纹变化 | 拒绝（`VALIDATION_FAILED` / `VALIDATION_CHANGED`） |
| `safety_monitor` 失联 | 运动工具按 `safetyStrict`: `'reject'` fail-closed 拒绝；`'warn'`（默认）放行并提示——生产环境建议 `'reject'` |
| 执行中超时 | `moveit_common` 先 cancel goal 再报错（看门狗，不留失控轨迹） |
| 监视器 CRITICAL | 锁存 `LOCKED`，仅人工解锁（`robot_safety_unlock`） |

**降级策略**：未注册机器人（无 profile）时校验器对未知限位**警告跳过**（
`require_limits` 默认 false）；注册后（URDF 限位入档）即全量 fail-closed。文档与
`robot_register` 流程均引导先注册再运动。

---

## 4. 审计与取证

- `safety_monitor` 在每次 CRITICAL 锁死时把触发前关节/力矩环形缓冲落盘到
  `safety.forensics.dump_dir`（默认 `~/.dsh-ros2/safety-events/`）。
- `moveit_move` 结果携带 `validation`（校验摘要 + 指纹）与 `verification`（终态
  验证）——可重建"请求了什么 / 校验了什么 / 审批了什么 / 执行了什么 / 实际如何"。
- 晚批将增加 JSONL 审计（`~/.dsh-ros2/audit/`），**本版未做**。
- GUI 白名单（§17）**已落地**：`ros2_gui_interact` 默认只免审批驱动
  `rviz2` / `rqt` / `rqt_graph`（可用 `guiAllowedApplications` 配置）；其余目标——
  包括不传 `windowTitle`（作用于焦点窗口）——一律先审批，且 fail-closed。
  注意白名单只是便利性控制（窗口标题可被任意进程伪造），**审批门才是边界**。
- "执行宿主文件"的面按**写操作**加门（第二十二轮）：
  `ros2_workspace use <ws>` 把命令前缀换成 `source <ws>/install/setup.bash`，而
  source 该文件即**执行**它（等价于运行文件里的代码），且该覆盖作用于本进程
  **所有会话**后续的每一条命令——这比 `ros2_run` 更强，所以与 `ros2_run` 一样
  要求审批，fail-closed；`show`/`reset` 仍是只读/降级，不需要审批。
- VLM 上传前按**文件内容**确认为图片（第二十二轮）：
  `ros2_vision_describe` 的 `imagePath`（以及 `ros2_vlm_analyze` 经 `vlm_node` 读的
  同名参数）由调用方给出，字节发往**第三方网关**。旧实现按扩展名猜 MIME、对未知
  扩展名回落 `image/png`，等于"把任意可读文件 base64 后 POST 出去"。现在只接受
  真正的 PNG/JPEG/GIF/WebP（TS 与 Python 两侧各一道，读**头部**判定，非图片直接
  拒绝且不整体读入内存）。
- **固定 `$TMPDIR` 运行目录必须是"自己的 + 私有的"**（第二十五轮）：`$TMPDIR` 是
  **1777 sticky** 目录，所以任何固定名字都可能被别人**先建**（建成他拥有的目录，或
  建成符号链接），插件随后就往一个**自己不能证明拥有**的目录里写：
  - `$TMPDIR/dsh-ros2-moveit` — 计划轨迹的落脚点。`moveit_move` 在这里写一条规划 →
    校验 → 审批 → **重新校验同一个路径** → 执行。**实测修复前该目录是 `0775`**
    （umask 002 + `mkdir`），同组用户可读、可替换 ⇒ 校验过的轨迹和执行的轨迹可能不是
    同一条（审批摘要只展示校验结论，不展示轨迹本身）。
  - `$TMPDIR/dsh-ros2/pty` — PTY 会话文件。`<sid>.in` 是被驱动进程（安装器）的
    **stdin**，即命令通道；文件本身已是 `0600`，但目录被替换就等于把命令通道交出去。
  - `$TMPDIR/dsh-ros2` — 截图与相机取帧，以及下载后**要被执行**的安装脚本。
  现在四处都在写之前走 `ensurePrivateRuntimeDir`：符号链接**直接拒绝**（不看目标——
  链接可以在检查与写入之间被换掉）、不是目录拒绝、**属主不是自己拒绝**；存在且是自己
  的则把 mode 收紧到 `0700`（这是我们自己建的目录，可修复），不存在则以 `0700` 逐层
  创建。与 `scripts/verification/`（第二十四轮）同一套判据。
- 截图 / 取帧的**写入目标**要过门（第二十五轮）：`ros2_screenshot`、`ros2_gui_observe`、
  `ros2_image_snapshot` 的 `output` 由调用方给出。旧实现是
  `path.isAbsolute(x) ? x : path.join(dir, x)`，实测（用已构建的 `lib/`）：
  `'../../etc/evil.png'` → `/etc/evil.png`（**静默逃出**截图目录）、
  `'/home/…/index.html'`（**非图片扩展名也照写**）被原样接受 ⇒ 一个免审批工具可以
  用图片字节覆盖**任意可写文件**。现在：截图目录内 → 免审批；目录外 → **审批**
  （fail-closed）；并且目标必须诚实——扩展名必须是 `.png`（截屏）或 `.jpg/.jpeg`
  （取帧）、不能是符号链接 / 目录 / 设备 / **多硬链接**文件、父目录必须存在。
  审批无法让这些"变得安全"（链接或 inode 可以在检查后被换掉），所以它们是**拒绝**。
- 轨迹输入也要过门（第二十五轮）：`moveit_move {mode:'trajectory'}` 与
  `motion_validate` 读的是调用方给的路径。`lstat` 先行：符号链接、非常规文件
  （`/dev/zero` 这种永不 EOF 的字符设备会让读取挂住）、以及超过 **64 MiB** 的
  文件一律拒绝且**不读**（一条规划轨迹通常 ~1 MB）。
- VLM 上传前**限大小**（第二十四轮）：上一条只回答了"是不是图片"，没回答"有多少"。
  头部判定通过之后，整个文件被 `readFile` 读进内存、base64（4/3）后一次性 POST——
  实测 300 MB 文件在 400 ms 内拉高 **~700 MB RSS**，再大就直接把宿主 agent 进程
  （连同其中所有会话）OOM 掉。现在 `stat` 先行：非**常规文件**（FIFO/设备/目录）
  按类型拒绝（FIFO 的 `open` 会一直阻塞，所以类型检查必须排在头部嗅探**之前**），
  超过 **20 MiB** 的按大小拒绝且**一个字节都不读**，实际读取长度还必须等于 `stat`
  报的长度（读取期间被改动即报错）。两个 VLM 网关的内联图片上限本来就在这个量级
  以下，所以更大的文件不可能成功——它只能安静地失败或把进程弄死。

---

## 5. 快速对照

| 场景 | 正确做法 |
| --- | --- |
| 我要动机械臂 | `moveit_move {mode, group, robot}` → 内部规划+校验 → 审批（展示校验摘要）→ 执行 → 验证 |
| 我拿到一个 trajectoryOut 想执行 | 用 `trajectory` 模式（内部重新校验 + 指纹/TTL）或先 `motion_validate` |
| 相对运动（joint_rel/pose_rel） | 必须 `robot`（新鲜状态自动获取）；过旧状态会被拒绝 |
| 任务方案大改 / 异常后 | `robot_safety_arbitrate`（VLM 语义仲裁）→ 非 safe 走 `robot_safety_lock` / 人工 |
| 机器人被锁死 | 现场确认安全 → `robot_safety_unlock` → 回 home → 恢复 |
