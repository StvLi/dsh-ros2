# dsh-ros2 安全体系 ToDo（GPT 意见评审）

> 依据：`docs/gpt-safety-handover.txt`（GPT 的 P0 Safety TODO，22 条）+ 已有
> 0.14.0 安全框架（`safety_monitor`/`robot_safety_*`/profile `safety` 段）+
> 本文档之前的交互确认。
> 状态：**已确认并完成早批**（2026-08-23，v0.14.1）：版本留在 0.14.x 系列——早批已在 **0.14.1** 落地（motion_validator / moveit_move 单一路径 / motion_validate / profile 扩展 / 执行看门狗 cancel / docs/safety.md / 测试 113 例）；晚批 **0.15+** 再上独立项。校验器范围按确认收敛（排除 collision/singularity 冗余检查）。

---

## 0. 结论摘要

GPT 的核心方向**采纳**：把当前"审批即执行"升级为
`PLAN → VALIDATE → APPROVE → EXECUTE → VERIFY` 单一路径，且系统对无法建立
安全性的情况 fail-closed。但对三条具体顾虑做收敛：

1. **去冗余（实时性）**：每个安全指标**恰好在一个层检查一次**——
   碰撞/奇异/工作空间 → MoveIt 规划层；限位/NaN/新鲜度/控制器 → 预执行校验层；
   跟踪/堵转/力矩/反馈 → 执行监视层（已有）；终态 → 事后验证层。
   **不做** collision/singularity 的二次校验（与 MoveIt 规划冗余）。
   校验器单次 ms 级、不进控制回路，200Hz 监视不动。
2. **保持框架通用（不堆具体模块）**：落地只有 **1 个纯 Python 确定性校验器** +
   `moveit_move` 流程重构 + profile 字段扩展 + 2 份文档 + 测试。
   **不新增 ROS2 节点/服务**（复用 `safety_monitor` 与 `moveit_status`）。
3. **控复杂度（可维护）**：校验器纯确定性、无 ROS2 依赖即可本地单测（与
   `safety_core --selftest` 同模式）；全部数值进 profile `safety` 段（schema 校验）；
   运动只走 `moveit_move` 一条路径，无散落安全门。

---

## 1. 逐条评审（GPT §1–22）

| # | GPT 条目 | 决策 | 理由 | 批次 |
| --- | --- | --- | --- | --- |
| 1 | 统一运动安全校验层 + `motion_validate` | **做（收敛范围）** | 通用确定性校验器，但只查"MoveIt 不查/查不到"的指标；独立可测模块 | 早 |
| 2 | 关节限位校验（位置/速度/加速度/NaN/名字/连续关节/跳变） | **做** | 确定性、通用；限位来自 profile（URDF 派生），零 LLM | 早 |
| 3 | 笛卡尔/工作空间校验 | **半做** | NaN/帧/方向检查做；pose 目标可直接 box 校验（规划帧无需 FK）；joint 模式的 box 需 FK → 留给本体 | 早（pose box）/ 本体（joint box） |
| 4 | 碰撞校验 | **不做** | 与 MoveIt 规划冗余（规划场景已含碰撞/奇异/工作空间）；执行期碰撞由反应式监视覆盖；`trajectoryOut` 重验由指纹+TTL 兜底 | — |
| 5 | 状态新鲜度 `maxStateAgeMs` | **做** | 目前无人检查；`joint_rel`/`pose_rel` 必须（绝对目标基于当前状态） | 早 |
| 6 | 控制器就绪 | **做（复用）** | `moveit_status` 在线探测已存在，批准前复用一次即可 | 早 |
| 7 | 审批发生在验证之后 | **做** | 核心架构变更：plan → validate → **approve（展示校验结果）** → execute | 早 |
| 8 | Fail-closed 策略 | **做（分层）** | 校验层恒 fail-closed（确定性、每请求一次，不会"反复锁"）；监视器失联仍按 `safetyStrict: warn/reject`（既有配置） | 早 |
| 9 | 校验结果绑定 / TOCTOU | **做（最小）** | 轨迹指纹（sha256：profile+group+joints+轨迹点+状态时间戳）；执行前重算比对 | 早 |
| 10 | 校验过期 TTL | **做** | `validationTtlMs`（默认 2000）过期 → 重验（同轨迹廉价重跑，不改意图不重复审批）；状态实质变化 → 重规划+重审批 | 早 |
| 11 | 执行看门狗 | **半做** | moveit 动作超时 → 取消/结构化失败（补验证/修复）；连续监视已有 `safety_monitor`，**不新增节点** | 早（小） |
| 12 | 执行后验证 | **半做** | 终态关节 vs 期望（容差内）做（确定性、通用）；EE 位姿验证需 FK，留给本体 | 早（小） |
| 13 | 相对运动安全 | **做** | 校验器基于**新鲜状态**算绝对目标再验证（绝不只是 delta） | 早 |
| 14 | 轨迹文件安全 | **做** | schema/名字/时间戳单调/限位/指纹/档案兼容，确定性；"DSH 托管目录"建议晚做（软变更） | 早 |
| 15 | Profile 安全配置扩展 | **做** | `safety` 段新增 `maxStateAgeMs`/`validationTtlMs`/`workspace`/`execution.maxDurationMs`/`require*`，safety set/validate 同步 | 早 |
| 16 | 急停边界 | **做（文档）** | `docs/safety.md` 明确"DSH 非功能安全系统"；不造假 E-stop；急停接口保持预留 | 早 |
| 17 | L3 GUI 安全 | **做（轻）** | `ros2_gui_interact` 默认白名单（rviz2/rqt/rqt_graph）+ 窗口标题校验 | 晚 |
| 18 | 审计日志 | **半做** | 工具层追加 JSONL（`~/.dsh-ros2/audit/`，含动作/指纹/校验/审批/执行/验证），不建新服务；绝不记密钥 | 晚 |
| 19 | 密钥安全 | **半做** | 现状已符合（env/密钥管理、不落日志）；补回归测试 | 晚 |
| 20 | 测试 | **做** | 校验器 PASS/FAIL 用例（对齐 GPT §20，排除 collision 等冗余项）+ 工具流测试 | 早 |
| 21 | 最终执行契约（单一路径） | **做** | 路径固化在 `moveit_move`（结构上不可绕过，非仅文档） | 早 |
| 22 | `docs/safety.md` | **做** | 六层边界：agent 权限 / 人工审批 / 运动校验 / 执行监视 / 事后验证 / 物理安全 | 早 |

---

## 2. 早批（0.14.1，**影响架构，先做**）

> 理由：§7/§21 改变运动工具的执行契约（审批时序、单一路径），其余早批项都是
> 该契约的组成部分；文档与测试同步。

**技术路线**（全部通用、确定性、profile 驱动）：

1. **`scripts/motion_validator.py`（新，纯 Python，无 rclpy）**
   - 输入：轨迹 JSON `{joint_names, points[{time_from_start, positions, velocities?}]}` +
     上下文 `{profile safety 段, group, mode, 目标, 当前状态(含时间戳)}`；
   - 检查项：关节名合法/完整、NaN/Inf、位置限位（连续关节回绕）、速度/加速度限位
     （轨迹自带或差分计算）、时间戳单调、轨迹时长 ≤ `execution.maxDurationMs`、
     相对模式按新鲜状态算绝对目标、状态新鲜度 `maxStateAgeMs`、可选 workspace box、
     指纹（sha256 over 规范化 JSON）、TTL `validationTtlMs`；
   - 输出：`{safe, status, checks{...}, warnings[], errors[], fingerprint, validated_at_ms}`；
   - `--selftest`：GPT §20 的 PASS/FAIL 用例（不含 collision/controller——那两层另有覆盖）。
2. **`moveit_move` 流程重构（单一路径，无旁路）**
   - 执行类模式：内部先 `--plan-only --out <tmp>`（同一次调用，不额外审批）→
     `motion_validator` 校验 → **审批（payload 展示校验摘要，如 §7 示例）** →
     执行前重跑廉价校验（指纹/新鲜度/TTL；过期 → 同轨迹重验，状态实质变化 → 重规划+重审批）→
     `trajectory` 模式执行 → 终态关节 vs 期望（容差）→ 结构化结果；
   - `planOnly` 显式模式保持现状（审批 → 仅规划 + `trajectoryOut`）；
   - 复用现有 helper 的两阶段能力（已确认 `--plan-only --out` 与 `trajectory` 模式存在）。
3. **`motion_validate` 工具（L1，只读）**：校验任意已规划轨迹 / `trajectoryOut` /
   运动提议，返回结构化 JSON（同 safety_core 模式：确定性、无运动）。
4. **profile `safety` 段扩展**：`maxStateAgeMs: 500`、`validationTtlMs: 2000`、
   `workspace: {x,y,z}`（可选，默认关）、`execution.maxDurationMs: 30000`、
   `requireControllerReady: true`、`requirePostExecutionVerification: true`；
   `robot_profile.py safety set/validate` 同步。
5. **控制器就绪**：校验步骤复用 `moveit_status` 的在线探测（`/move_action`、
   `/execute_trajectory`、`controller_manager`）——不新增探测逻辑。
6. **执行看门狗**：核对 `moveit_common.py` 动作调用的超时→取消行为，缺则补 cancel；
   连续监视继续由 `safety_monitor` 承担。
7. **文档**：新增 `docs/safety.md`（六层边界 + "DSH 非功能安全系统"声明 + 急停边界）；
   `docs/safety-handover.md` 补充新契约章节；README 双语同步（工具/配置/流程）。
8. **测试**：校验器单测（§20 用例映射）+ vitest 工具流（验证后审批、指纹失配拒绝、
   TTL 过期重验、相对运动新鲜度强制）+ `safety_core` 回归全绿。

## 3. 晚批（0.15+，独立可后补，不影响架构）

| 项 | 说明 |
| --- | --- |
| L3 GUI 白名单（§17） | `ros2_gui_interact` 默认 `allowedApplications: [rviz2, rqt, rqt_graph]` + 窗口标题校验；需改动时审批 |
| 审计 JSONL（§18） | `~/.dsh-ros2/audit/motion-YYYYMMDD.jsonl`，工具层追加（动作/指纹/校验/审批/执行/验证），无密钥 |
| workspace box 默认启用（§3） | 校验器已支持，按机器人填 box 后开启 |
| 轨迹托管目录（§14） | `trajectoryOut` 默认落 `~/.dsh-ros2/trajectories/` |
| 密钥卫生测试（§19） | 断言日志/命令参数不泄露密钥 |

## 4. 不做（含理由）

| 项 | 理由 |
| --- | --- |
| 独立碰撞/奇异/工作空间校验模块（§4） | 与 MoveIt 规划冗余（规划场景已含）；执行期碰撞由反应式监视（力矩/跟踪）覆盖；`trajectoryOut` 重验由指纹+TTL 兜底 |
| 每机器人控制器故障/急停状态探测 | 本体相关 → 下游经 `lock_action`/`/safety/state` 接入 |
| 假"软件 E-stop" | GPT §16 明确反对；只保留预留接口与边界文档 |
| LLM 参与运动校验 | 校验必须确定性（GPT §1 亦要求）；VLM 只留语义仲裁层 |
| 新增执行监视节点/审计服务 | `safety_monitor` + 工具层 JSONL 已覆盖，不重复造轮子 |

## 5. 留给本体实现（下游 agent）

- 碰撞场景填充 / 超越 MoveIt 默认的碰撞校验；
- 控制器故障/急停状态 → `/safety/state` 或 `lock_action`（阻尼/柔顺）接线；
- workspace box 具体数值、每关节阈值标定（已在 profile 预留）；
- EE 位姿事后验证（需 FK）；
- 计算力矩前馈接入（`torque.feedforward_topic` 已预留）；
- 未来 model-based policy 指令流 → 接入 `motion_validator` 预检。

## 6. 验收（对齐 GPT Acceptance Criteria，标注归属）

| GPT 验收 | 归属 |
| --- | --- |
| 1. 无 L2 运动可绕过校验 | 本仓库（§2-2 单一路径） |
| 2. 校验 fail-closed | 本仓库（§1-8） |
| 3. 相对运动用新鲜状态 | 本仓库（§1-5/13） |
| 4. trajectoryOut 执行前重验 | 本仓库（§1-9/10/14） |
| 5. 校验绑定精确轨迹（指纹） | 本仓库（§1-9） |
| 6. 校验过期（TTL） | 本仓库（§1-10） |
| 7. 控制器就绪检查 | 本仓库（§1-6，复用 moveit_status） |
| 8. 执行看门狗 | 本仓库最小（§2-6）+ 既有 monitor |
| 9. 执行后验证 | 本仓库最小（终态关节）+ 下游（EE 位姿） |
| 10. 安全结果在审批前可见 | 本仓库（§1-7） |
| 11. GUI 能力限制 | 晚批（§3） |
| 12. 关键安全条件自动化测试 | 本仓库（§2-8） |
| 13. docs/safety.md 边界 | 本仓库（§2-7） |

---

## 7. 决策记录（已确认）

1. **审批时序重构**（§7/§21）：`moveit_move` 改为"内部规划 → 校验 → 审批（展示校验摘要）→ 执行"——**通过**（纳入早批 0.14.1）。
2. **校验器范围收敛**（§1-4）：排除 collision/singularity 二次校验（冗余）——**通过（收敛范围）**。
3. **版本策略**：不跳中版本，安全集中 0.14.x——**通过**：早批 **0.14.1**，晚批 **0.15+**。
