# dsh-ros2 安全边界（Safety.md）

> 版本 0.14.1 · 配套 `safety-handover.md`（本体适配交接）· `safety-todo.md`（GPT
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
- 晚批（0.15+）将增加 JSONL 审计（`~/.dsh-ros2/audit/`）与 GUI 白名单；本版不做。

---

## 5. 快速对照

| 场景 | 正确做法 |
| --- | --- |
| 我要动机械臂 | `moveit_move {mode, group, robot}` → 内部规划+校验 → 审批（展示校验摘要）→ 执行 → 验证 |
| 我拿到一个 trajectoryOut 想执行 | 用 `trajectory` 模式（内部重新校验 + 指纹/TTL）或先 `motion_validate` |
| 相对运动（joint_rel/pose_rel） | 必须 `robot`（新鲜状态自动获取）；过旧状态会被拒绝 |
| 任务方案大改 / 异常后 | `robot_safety_arbitrate`（VLM 语义仲裁）→ 非 safe 走 `robot_safety_lock` / 人工 |
| 机器人被锁死 | 现场确认安全 → `robot_safety_unlock` → 回 home → 恢复 |
