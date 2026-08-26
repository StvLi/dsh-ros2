# dsh-ros2 拆分为职责域插件 · 定稿规划（ISP 收紧版）

> 版本：0.15.0（拆分后新包从 0.1.0 起）· 状态：**已对齐**（2026-08-24）
> 背景：拆分 Handover（另一 agent 提出）经源码核实 + 用户对齐，按 **ISP（接口隔离）**
> 收紧两处归属与 common 内容后定稿。本文件为执行对照基准；拆分后 51 工具 + 4 skills
> 全部保留、工具名与行为不变。

---

## 1. 目标与判定

- 修复"基础插件职责越界"：profile 可按需装包（只要诊断就不背 vision/moveit/safety）。
- 修复 npm 发布缺陷：`vlm/` 与 `offscreen/` 不在 `files`（vision 包必须包含）。
- 隐性依赖显性化：跨包运行时契约（`/vlm/describe`、`/safety/state`、vision 服务）
  改为**可选/软依赖 + 显式声明**，代码零硬耦合。
- ISP 判定：每个包只依赖它实际使用的接口；跨包接口全部按需 + 可选。
  已收紧：common 瘦身、`pty_session.py`→core、`simplify_visual_meshes.py`→vision、
  `zero_pose_semantics.py`→profile、`ros2_zero_pose_semantics` 归 profile、
  `ros2_gui_observe` 留 core 经可选 vision 服务。

## 2. 包结构（7 个 npm 包，pnpm monorepo）

| # | 包 | 内容 | 工具 | skills | 配置 |
| --- | --- | --- | --- | --- | --- |
| 1 | `dsh-ros2-common` | 共享 TS 实现（runner.ts / parse.ts / ToolDeps 类型 / defineTool 包装）+ `scripts/robot_profile.py`（3 包共用，**零复制**） | — | — | — |
| 2 | `dsh-ros2-core` | L1 诊断 17 + L2 管理 10 + L3 GUI 6；`gui.ts`；`scripts/pty_session.py` | 33 | `ros2-diagnostics` | 公共项（见 §5） |
| 3 | `dsh-ros2-profile` | `robot_register/load/topology` + **`ros2_zero_pose_semantics`**（更正：写档案零位字段）；`scripts/zero_pose_semantics.py` | 4 | `robot-registration`、`robot-retrieval` | — |
| 4 | `dsh-ros2-moveit` | `moveit_discover/status/motion_validate/moveit_move`；`moveit_common/discover/status/move.py` + `motion_validator.py` | 4 | — | — |
| 5 | `dsh-ros2-safety` | `robot_safety_start/state/arbitrate/lock/unlock` + 随附 `safety/` ROS2 包 | 5 | — | `safetyStrict` |
| 6 | `dsh-ros2-vision` | `ros2_image_snapshot/vlm_analyze/vision_topics/vision_analyze/vision_describe` + 随附 `vlm/`、`offscreen/`（**files 必须含**）+ vision provider（gemini/openai/mock）**注册为可选服务**；`scripts/simplify_visual_meshes.py` | 5 | `robot-state-vision-analysis` | `vision{provider,apiKey,model,baseUrl}` |
| 7 | `dsh-ros2`（聚合） | 依赖以上 6 包、空 apply（向后兼容，老 profile 迁移成本最低） | — | — | — |

合计 **33+4+4+5+5 = 51 工具**；skills **1+2+0+0+1 = 4** ✓

## 3. 工具归属映射（51，逐一）

**core（33）**：L1——`ros2_pkg_list` `ros2_colcon_list` `ros2_rosdep_check` `ros2_node_list`
`ros2_node_info` `ros2_topic_list` `ros2_topic_info` `ros2_topic_echo` `ros2_service_list`
`ros2_action_list` `ros2_param_list` `ros2_interface_show` `ros2_tf_list` `ros2_tf_echo`
`ros2_doctor` `ros2_bag_info` `ros2_graph`；L2——`ros2_colcon_build` `ros2_rosdep_install`
`ros2_interface_create` `ros2_param_set` `ros2_bag_record` `ros2_bag_play` `ros2_launch`
`ros2_install` `ros2_jobs_list` `ros2_job_status`；L3——`ros2_gui_start` `ros2_gui_list`
`ros2_gui_close` `ros2_screenshot` `ros2_gui_observe`（经可选 vision 服务）
`ros2_gui_interact`。

**profile（4）**：`robot_register` `robot_load` `robot_topology`
（snapshot/learn/show/search/diagnose）`ros2_zero_pose_semantics`（运行时软依赖
vision：offscreen + vlm）。

**moveit（4）**：`moveit_discover` `moveit_status` `motion_validate` `moveit_move`
（运行时经 common 的 `robot_profile.py` 取限位）。

**safety（5）**：`robot_safety_start`（jobs + common 的 robot_profile.py）`robot_safety_state`
`robot_safety_arbitrate`（运行时软依赖 `/vlm/describe`）`robot_safety_lock`
`robot_safety_unlock`。

**vision（5）**：`ros2_image_snapshot` `ros2_vlm_analyze` `ros2_vision_topics`
`ros2_vision_analyze` `ros2_vision_describe`。

## 4. 共享脚本方案（已定：common 包，零复制）

- `robot_profile.py` 放 `dsh-ros2-common`（profile/safety/moveit 三包经
  `require.resolve('dsh-ros2-common/scripts/robot_profile.py')` 定位，替代原
  `import.meta.url` 相对路径）。
- 不复制脚本（避免漂移）；依赖关系经 npm 显式声明。
- `runner.ts`/`parse.ts`/ToolDeps 类型同理入 common，各包 `apply()` 自建 run seam
  （与现状一致，`ToolDeps` 注入不变 → 测试 fake 模式不变）。

## 5. 配置迁移映射（cordis.patch.yml 是 whole-object replacement——必须精确）

| 旧 `dsh-ros2` config 键 | 新包 id | 新键 |
| --- | --- | --- |
| `rosSetup` `rosLogDir` `workspaceRoot` `timeoutMs` `includeStderr` `display` `screenshotDir` `screenshotCommand` | `dsh-ros2-core` | 同名 |
| `vision.provider/apiKey/model/baseUrl` | `dsh-ros2-vision` | `vision{...}` |
| `safetyStrict` | `dsh-ros2-safety` | `safetyStrict` |

漏映射 = 配置丢失；迁移前后必须 `--dump-config` 对比 + 备份
（`package.json`、`cordis.patch.yml`）。

## 6. 跨包运行时契约（保持不动）

- 话题/服务名：`/vlm/describe`、`/vlm/description`、`/safety/state`、`/safety/heartbeat`、
  `/safety/set_lock`、`/safety/unlock`、`/safety/get_state`、`/safety/lock_active`。
- `safetyStrict` 语义（warn/reject；LOCKED 一律拒）不变。
- vision provider 由 vision 包注册为可选 cordis 服务（如 `dshRos2.vision`）；core 的
  `ros2_gui_observe` 与 profile 的 `ros2_zero_pose_semantics` 经 `ctx.get` 可选获取，
  缺失时报 `VISION_UNAVAILABLE` 而非崩溃。

## 7. 工程约束（cordis bundle 契约）

1. 每包 `package.json` 声明 `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}`；
   `cordis.patch.yml` = `- insert: [{id: <包名>, name: <包名>, config: {}}]`
2. `lib/index.js` 只做 named exports（`name`/`inject`/`Config`/`apply`）
3. 工具名全局唯一、一字不改
4. peer 依赖：`@deepseek-ai/cordis ^4.0.1`、`@deepseek-ai/dsh-tools 0.1.0-rc.6`、
   `@deepseek-ai/dsh-skill 0.1.0-rc.6`
5. `files`：每包只含自身产物；vision 含 `vlm/` + `offscreen/`（修复发布缺陷）；
   common 含 `scripts/`
6. monorepo：pnpm workspace，一个 CI（Node 22/24 → typecheck/test/build/pack 校验），
   各包独立版本（从 0.1.0 起）独立发布

## 8. 实施步骤

1. 备份 profile（`/home/stvli/.dsh/profiles/web/package.json` + `cordis.patch.yml`）
2. 建 monorepo（pnpm workspace）+ 7 包骨架（package.json + cordis.patch.yml + src/index.ts 空壳）
3. 按归属拆 `tools.ts`/`config.ts`/`skill.ts`/`vision.ts`/`gui.ts`/`runner.ts`/`parse.ts`
   → 各包；迁移脚本（robot_profile.py→common，pty_session→core，simplify_visual_meshes→vision，
   zero_pose_semantics→profile，moveit_*+motion_validator→moveit）
4. 迁移/拆分 `tests/`（vitest，ToolDeps fake 模式不变）；monorepo 一次 `pnpm test` 全绿；
   `pnpm build`（tsc）通过
5. profile 迁移：`link:` 依赖 + `dsh.profile.bundles` + patch config 精确映射；
   `--dump-config` 前后对比（51 工具 + 4 skills 全注册；`dsh-deepcybo-lite`、
   `diagram-converter-mcp`、`@tt-a1i/archify-dsh` 三插件 patch 原样保留）
6. 本机实测：ROS2 就绪时至少 L1 诊断工具可用；否则工具返回结构正确、原因明确的错误
7. 每包 README：功能域、依赖（含跨包软依赖）、配置、ROS2 包构建方式
8. 交付说明：拆分映射表、共享脚本方案、未决问题（npm 发布凭据由用户提供；版本从 0.1.0）

## 9. 验收标准

- [ ] 7 包各为合法 cordis bundle，`dsh --profile web --dump-config` 显示全部 provider
- [ ] 51 工具 + 4 skills 全部注册、工具名与行为不变（对比拆分前后 dump-config）
- [ ] vitest 全绿；tsc 构建通过
- [ ] vision 包 `files` 含 `vlm/`、`offscreen/`；每包 `files` 只含自身产物
- [ ] 本机实测：ROS2 就绪时至少 L1 可用；否则结构化错误
- [ ] 不破坏同 profile 的 `dsh-deepcybo-lite` / `diagram-converter-mcp` /
      `@tt-a1i/archify-dsh`（改动前后 dump-config 对比）
- [ ] 备份还原说明：失败可回滚 profile 配置

## 10. 风险与回滚

- config whole-object 丢失：备份 + 迁移映射表 + dump-config 对比兜底
- common 包成为新瓶颈：若出现"某包只用 common 一部分"，按唯一使用者归属收敛（ISP 持续收紧）
- 聚合包使老 profile 背负全部依赖：向后兼容的明确取舍；在意轻量化的 profile 直接依赖子包
- 回滚：`git revert` + 恢复 profile 备份（package.json / cordis.patch.yml）

## 11. npm 发布准备（本文件交付时已做）

- 用户级 `~/.npmrc` 配置 `//registry.npmjs.org/:_authToken`（token 不落仓库）
- `npm whoami` 验证凭据；`npm view` 检查 `dsh-ros2` 及新包名（core/profile/moveit/
  safety/vision/common）可用性与归属
- 发布时用 `npm publish --access public`；新包版本从 0.1.0 起
