# 反馈落实说明：让 dsh-ros2 更易被 Agent（dsh）稳定调用

> 致反馈者。本说明对应你在"多工作区 ROS2 仓库调试"反馈中提出的四点建议，逐条说明落实情况、使用方式与验证结果。
> 落实提交：`2ebe3a4`（功能）+ `821f9b8`（CI 测试修复）；版本：`dsh-ros2-common@0.1.1`、`dsh-ros2-core@0.1.5`；工具集 77 个。

---

## 反馈回顾

> 痛点：多工作区 ROS2 仓库调试时，最大的阻力不是工具，而是工具集环境配置——一次配置错，75 个工具全挂，且报错不可读、修复需改配置并重启整个 DSH，逼人绕过插件改用裸 `ros2` CLI。

**核心诉求**："装好即用、用错自纠、切环境不重启"。

---

## 逐条落实

### P0-1 环境解析自愈 + 可诊断 ✅

**回退链**（common `runCommand` 内实现，所有域包共享）：

```
会话级覆盖（ros2_workspace use） → 配置 rosSetup → workspaceRoot/install/setup.bash
  → /opt/ros/<distro>/setup.bash → 无 source（裸宿主 PATH）
```

- `rosSetup` 未配置 → 自动检测 `workspaceRoot/install/setup.bash` 或 `/opt/ros/*/setup.bash`——"装好即用"。
- `rosSetup` 显式配置但 **source 路径不存在** → 自动回退到链上可用项（用错自纠），并**不再只报 `No such file or directory`**，而是给出可操作诊断：
  - 缺失的 source 路径；
  - 已自动回退到哪个 setup（或无可用 setup）；
  - 宿主检测到的 `AMENT_PREFIX_PATH` / `COLCON_PREFIX_PATH`。
- 诊断以 `sourceOk` / `envNote` 字段随结果返回，错误信息带 `[env]` 前缀，Agent 可直接读到。

**新工具 `ros2_env_check`（L1 只读）**：一次报告"当前 source 哪个 overlay、路径是否存在、可见多少个包/多少节点"——0 包即环境未 source，一眼定位。

### P0-2 会话内切工作区，无需改配置/重启 ✅

**新工具 `ros2_workspace`（L1）**：

| 动作 | 行为 |
| --- | --- |
| `use <ws>` | 校验 `<ws>/install/setup.bash` 存在 → 设为**会话级** source 前缀，后续所有工具调用立即生效（内存态，**不改配置、不重启 DSH**） |
| `show` | 报告当前生效 setup（会话覆盖 / 配置 / 自动检测） |
| `reset` | 清除会话覆盖，回到配置与回退链 |

实现上，会话状态放在 `dsh-ros2-common`（与既有 `rosLogFallback` 同模式），`runCommand` 优先读取——所以切换对所有域包（core/profile/moveit/safety/vision）的后续命令统一生效。

### P1 报错契约：环境问题优先判别 ✅

- `RosResult` 新增 `sourceOk` / `envNote`；
- 失败时错误信息区分"环境未 source / source 路径错（已回退）/ 命令失败"，并附**实际生效的拼接命令**与诊断；
- 环境类错误不再与业务错误混淆。

### P2 skill 补恢复路径 ✅

- `ros2-diagnostics` 技能新增 **"Environment recovery（环境自愈）"** 章节：
  `ros2_env_check` 诊断 → `ros2_workspace use` 切换 → 回退链说明；
- Agent 在会话内按此路径自愈，不再默认"工具一定可用"。

---

## Agent 使用示例

```text
# 1. 环境疑似没配好
ros2_env_check
# → setup: { sourcePath: null } visiblePackages: 0  → 未 source

# 2. 切到目标工作区（无需改配置/重启）
ros2_workspace {action: "use", path: "/home/you/ros2_ws"}
# → sessionRosSetup: "source /home/you/ros2_ws/install/setup.bash && "

# 3. 再验证
ros2_env_check        # visiblePackages: 120, visibleNodes: 3
ros2_topic_list       # 正常枚举

# 4. 切回/清除
ros2_workspace {action: "show"}
ros2_workspace {action: "reset"}
```

错误信息示例（显式 `rosSetup` 路径写错时，自动回退并报告）：

```
[env] 配置的 rosSetup source 路径不存在：/home/you/old_ws/install/setup.bash；
已自动回退到 /opt/ros/jazzy/setup.bash。建议修正配置。
[env] 宿主环境：AMENT_PREFIX_PATH=... COLCON_PREFIX_PATH=...
```

---

## 验证与交付

| 项 | 数值 |
| --- | --- |
| 新增工具 | `ros2_env_check`、`ros2_workspace`（core 57 → 59，全集 75 → 77） |
| 测试 | common 10 → **13**；core 89 → **94**；工作区 **166 vitest** + 10 sidecar Python 场景 |
| 版本 | `dsh-ros2-common@0.1.1`、`dsh-ros2-core@0.1.5` |
| CI | 最新提交 `821f9b8`：**Node 22/24 均 success** |
| 文档 | README/README_CN（工具表 + 计数）、CHANGELOG 同步 |

> 过程说明：首版测试曾依赖本机 `/opt/ros/jazzy` 存在，在 CI runner（无 ROS2）上失败——已重写为环境无关测试并确认 CI 通过。

---

## 已知边界（诚实说明）

1. **会话覆盖是内存态**：DSH 进程重启后清除，需重新 `ros2_workspace use`（或把目标写进配置的 `rosSetup`）。
2. **仅对"source 路径不存在"自动回退**：若显式 `rosSetup` 路径存在但内容过时（旧 overlay），不会静默替换（那是用户的明确选择）——诊断会如实报告。
3. **无 source 兜底 = 裸宿主 PATH**：此时 `ros2` 可能不在 PATH，命令报 `command not found`——`ros2_env_check` 的 0 包结果即此情形，按 P2 路径处理。
4. 若你希望**配置级** `rosSetup` 也支持"多工作区"，可后续在 DSH profile 里按 bundle 配置不同 `rosSetup`（各域包已支持），或反馈需要统一的全局配置入口。
