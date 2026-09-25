# dsh-ros2 日常维护文档（Maintenance Log）

> 仓库：`StvLi/dsh-ros2` · 本地代码：`/home/stvli/Desktop/embody_agent_ws/dsh-ros2`（git remote `git@github.com:StvLi/dsh-ros2.git`）
> 维护日期：2026-09-26（最近一轮） · 维护者：DSH scheduled-run agent（StvLi 仓）
> 维护轮次：第一轮 2026-09-03（§0–§7）；第二轮 2026-09-04（§8）；第三轮 2026-09-05（§9，安全修复）；第四轮 2026-09-05（§10，无 open issue → 安全检查 → 两项维护卫生修复）；第五轮 2026-09-06（§11，无 open issue → 安全检查 → 落地 `ros2_install` 注入修复）；第六轮 2026-09-11（§12，无 open issue → 安全检查 → 落地 `safety_monitor` / `zero_pose_semantics` 注入修复 + vitest 4 升级 + CI 最小权限）；第七轮 2026-09-13（§13，open issue #19 → journey skills + 组合不变量）；第八轮 2026-09-14（§14，3 个 open issue → #21 修复并真机复核、#22 落地但保留 open、#19 完成验收测量）；第九轮 2026-09-21（§15）：open issue #22 → 补齐"会话技能目录对账"（其唯一未实现项）+ 修复 `ros2_env_check` 的"报告 ≠ 执行"缺陷（第八轮存疑项的真因）+ 安全复测；**第十轮 2026-09-22（§16，本轮）：补齐第九轮"在途无 PR"的缺口（PR #27，CI 首跑即抓出"本地绿、CI 红"）→ 在运行中进程里验收并关闭 issue #22 → 定位并修复线上故障真因（`rosSetup` 只校验第一段）→ 3 个 PR 全部合入 main**；第十二轮 2026-09-24（§17，收尾超时遗留的在途 PR #32 → 实测第十轮的重启请求已按硬期限落地 → 修复"配置没送到 doctor"的接线缺口 + API Key 来源语义）；第十三轮 2026-09-25（§18，0 open issue / 0 open PR → 安全扫描发现并落地 3 处真实缺陷 = PTY 会话 id 路径穿越 · 发布物携带 `__pycache__` 字节码 · 安装器选项注入，并开启 Dependabot 告警）；**第十四轮 2026-09-26（§19，本轮）：0/0 → 先闭环第十三轮唯一的未闭环观测（gen-21 重启逐字命中），再落地 3 个 PR = 明文传输的 VLM API Key 可见化 · 插件自建 IPC 对象权限收紧（PTY 会话文件 / sidecar UDS / 安装器脚本）· Dependabot 版本更新；并把跨五轮未处理的部署配置项升级为 issue #40**。

本文件记录 dsh-ros2 插件的一次完整日常维护循环：**查 issue → 评估建议 → 分支开发 → 验证 → 推送 → 交付维护文档**。每次维护在下方追加一节。

---

## 0. 仓库快照（本次维护起点）

| 项 | 值 |
| --- | --- |
| 当前分支 | `main`（与 `origin/main` 一致，工作树干净） |
| 远端分支 | `origin/main`，`origin/docs/maintenance`（历史遗留，PR #1 已合并，落后于 main，保留未清理） |
| 近期提交（head） | `cea3f80` vision 0.1.3（解析 JPEG 尺寸）→ `2895046` vision prompt-first key … |
| CI 状态 | 最近一次 main push 的 CI **全部 success**（Node 22/24） |
| 最新发布 | `v0.1.0-plugins`（monorepo 拆分标记，2026-08-30）；npm 侧 9 包均为 `0.1.0` 基线 |
| 包数量 | 9 个（common / core / dsh-ros2 / dsh-ros2-state / moveit / profile / safety / sidecar / vision） |
| 本地 Node / pnpm | Node `v24.16.0` / pnpm `11.22.0`（root `packageManager` 一致） |

---

## 1. Issue 检查与建议评估

### 1.1 是否存在未处理的 issue

`gh issue list --state open` → **无 open issue**。

当前仅有 2 个 issue，且均已 **closed**：

| # | 标题 | 状态 | 关闭时间 | 对应修复 commit |
| --- | --- | --- | --- | --- |
| 2 | `build: pnpm 11 fails because allowBuilds.esbuild contains a placeholder value` | CLOSED | 2026-09-01 | `47dfb4a` fix(build) + `ca243f0` ci: align pnpm version |
| 3 | `docs: update monorepo package and test counts after state/sidecar split` | CLOSED | 2026-09-01 | `47dfb4a` refresh package/test counts + `821f9b8` test(common) CI-robust |

### 1.2 各建议的合理性 / 必要性判断

**issue #2（pnpm 11 构建失败，`allowBuilds.esbuild` 占位符）——合理且必要。**

- 现象：`pnpm-workspace.yaml` 里 `allowBuilds.esbuild: "set this to true or false"` 是未替换的占位符，pnpm 11 直接因 `ERR_PNPM_IGNORED_BUILDS` 拒绝构建。
- 影响面：全新 checkout 无法 `pnpm build`，是**发布/CI 门槛级**问题，必修。
- 修复评估：现改为 `allowBuilds.esbuild: true` + root `packageManager: pnpm@11.22.0`，并让 CI `pnpm/action-setup@v4 version: 11.22.0` 与之一致。**正确且完整**（npm 侧不再报占位符；CI 明确固定 pnpm 版本）。
- 遗留小项：issue 提到 README 未声明 pnpm 版本要求——非必须，未列入本次修复（README 有 `packageManager` 由 CI 保证）。

**issue #3（包数量与测试用例统计过时）——合理，但不紧急。**

- 现象：拆分后 9 个包，但根 `package.json` / README 仍写 7 包、115 例；实际测试为 127 vitest + 10 Python。
- 影响面：文档与 release 元数据失真，属**发布卫生**问题，不阻断功能。
- 修复评估：此前已把包数更新到 9、用例更新到当时值。**本次维护发现 README 用例数与 tool 数再度漂移（见 §3），一并修正。**

结论：**无未处理 issue；两条已关闭 issue 的建议均合理，issue #2 必要性高，issue #3 属文档卫生。** 本轮为纯维护型开发。

---

## 2. 本轮维护结论（发现的问题）

### 2.1 真机验证发现一个**确定性测试失败**：`ros2_install` 的 PTY 交互测试

- 现象：`packages/core/tests/tools.spec.ts` 的
  `ros2_install interactive flow … drives the installer menus via PTY`
  反复失败（本机 3/3 稳定失败），`status` 返回空输出，断言 `expected '' to contain '众多工具'`。
- 根因（逐层排除后定位）：**不是代码回归**，而是执行环境无法分配新 pty。
  `pty.openpty()` 抛 `OSError: out of pty devices`。本机 `/proc/sys/kernel/pty/nr=1, max=4096` 并无耗尽，
  但 `/dev/pts` 以 `ptmxmode=000` 挂载，非 root 无法打开 `/dev/ptmx` 分配新 pty。
  → 工具本身（`scripts/pty_session.py` 的 pty 会话）在该类无头/容器环境天然不可用。
- 影响面：完整 `pnpm test` 在此类环境红掉，掩盖其他真实失败。

**修复（`fix(test)`）**：对 `ros2_install` PTY 测试加 `it.skipIf(!ptyUsable)`——用
`python3 -c "import pty; pty.openpty()"` 探测；pty 可用（CI/ubuntu）时仍完整跑通
`start→send→status→stop`，不可用时明确 skip 而非红灯。改动只影响测试健壮性，不改工具行为。

> 说明：`ros2_install` 工具在 pty 不可用环境其 `start` 会静默成功但无输出（daemon stderr 被丢弃）。
> 属已知局限，见 §5；本轮不做工具层改动，避免扩大范围。

### 2.2 工具数量元数据漂移

逐包核对实际注册工具集与 inventory 测试断言：

| 包 | 实际（测试断言） | 原 description | 现值 |
| --- | --- | --- | --- |
| `dsh-ros2-core` | 59 | tools (33) | tools (59) |
| `dsh-ros2-vision` | 7 | tools (5) | tools (7) |
| `dsh-ros2`（聚合） | 79（59+4+4+5+7） | all 75 tools | all 79 tools |
| vision inventory 标题 | 7 | tool set (5) | tool set (7) |
| 工作区 vitest 用例 | 182 | 166 | 182 |

> 合计验证：core 59 + profile 4 + moveit 4 + safety 5 + vision 7 = **79 工具 + 4 skills**（与 README badge `tools-79` 一致）。
> 补充：另有 sidecar 10 个 Python 自测场景（`python3 -m sidecar.selftest` → `SELFTEST PASSED (10 scenarios)`），README 表述正确。
> 用例合计：common 13 + core 94 + moveit 16 + profile 11 + safety 8 + vision 30 + state 8 + dsh-ros2 2 = **182**（CI 全通过；pyt-less 环境那 1 例 skip）。

---

## 3. 开发管理（git）

### 3.1 分支与提交

- 基分支：`main`（干净）
- 新开分支：`fix/maintenance-daily`（`fix/...` 前缀，符合“修复问题”语义）
- 提交（Conventional Commits）：

| commit | 类型 | 说明 |
| --- | --- | --- |
| `e09c4b0` | `fix(test)` | `ros2_install` PTY 测试在 pty 不可用时 skip（+ 纠正 core inventory 标题 (59)） |
| `021640d` | `docs` | 对齐工具/用例数量元数据（core 59 / vision 7 / 聚合 79 / 182 例） |

- PR：**#5** `fix/daily maintenance: pty-safe ros2_install test + tool/test count metadata`（base `main`，mergeable）。

### 3.2 本地验收（全绿）

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
CI=true pnpm run typecheck   # 9/10 项目 tsc --noEmit 全部 Done
CI=true pnpm run test        # 182 vitest（本机 1 例 skip）+ 10 sidecar Python 场景，通过
CI=true pnpm run build       # pnpm -r build 全部 Done
```

> `CI=true` 原因：本机 `node_modules` 由旧 pnpm 配置生成，pnpm 会因 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 提示清空 modules；
> 设 `CI=true` 让 pnpm 自动确认（等价 CI/无 TTY 场景）。仓库本身在全新 checkout 下无需此设置。
> push 后 GitHub CI（Node 22/24）在 PR #5 上校验。

---

## 4. dsh-phoenix 持续更新/测试循环（README 所述的“自进化循环”）

dsh-phoenix 已在 web profile 安装并生效：

- 安装：`~/.dsh/profiles/web/package.json` → `dsh-phoenix: link:…/dsh-phoenix`；`cordis.patch.yml` 注入 `dsh-phoenix` 行。
- 生效验证：`curl http://127.0.0.1:3080/__dsh_health` → `{"token":"…"}`（心跳端点在线 = **client 自动重连**在跑）。
- 优雅重启能力：`systemctl --user list-units` → `dsh-web.service … active running`，且 systemd 255 可用 ⇒ **graceful-restart 启用**。
- dsh-ros2 同样以 `link:` 装入 web profile（`dsh-ros2` / `dsh-ros2-core` / `dsh-ros2-vision` … 均为 symlink）；本 Agent 会话已具备全部 `ros2_*` 工具，证明 bundle 已生效。

**本维护会话如何使用它：** 修改 → `CI=true pnpm run typecheck/test/build` 全绿 → 提交/推送。由于本轮改动只涉及
测试与文档元数据（**不改工具运行时行为**），无需把新 lib 重载进运行中的 dsh web；因此本会话
**有意未触发** dsh-phoenix 的优雅重启（其触发条件是 dsh 编译工具 `cordis_run`，且会中断本会话）。

**给后续维护者的循环（真正需要重载运行时变更时）：**
1. 改 `packages/<domain>/src/…` → 构建 → 验证全绿；
2. 用 dsh 插件工具 `cordis_run`（或更新动态 plugin）触发；
3. dsh-phoenix 检测到 `cordis_run` 后 idle-aware 优雅重启（系统无 busy agent 才重启，`systemd-run --user` 独立 unit）；
4. 重启后 phoenix 重连页面（token 变化自动 reload）、并按 checkpoint 重臂未完成 goal；
5. 用 `DSH_PHOENIX_STATE_FILE`（JSON checkpoint，`pendingResume:true`）驱动跨重启的持续目标。

> 注：本次未设置 `DSH_PHOENIX_STATE_FILE`，故重臂功能处于默认（未挂起目标）状态；重启/恢复路径未被本会话实际演练。

---

## 5. 已知限制 / 遗留事项

| 项 | 说明 | 建议 |
| --- | --- | --- |
| pty 受限环境 | 无头/容器 `devpts ptmxmode=000` 下 `ros2_install` 的 PTY 会话不可用（测试已 skip；工具层仍会静默返回无输出 session） | 后续可在 `pty_session.py` 让 daemon 上报 pty 分配失败，工具返回明确 `PTY_UNAVAILABLE` |
| `docs/maintenance` 远端分支 | PR #1 合并后遗留，落后于 main | 可 `git push origin --delete docs/maintenance` |
| README pnpm 版本声明 | 未显式写明需 pnpm 11.x（CI 已固定） | 可选补一句，风险低 |
| `docs/feedback-env-recovery.md:97` | 为历史反馈记录（截图数字 166 / core 89→94），非用户入口 | 保留为历史快照 |
| sidecar / state | sidecar 为“纯模板框架”（reducer 未实现），state 是控制面客户端 | 符合设计，无动作 |

---

## 6. 下次维护建议动作

1. 若需重载运行时变更：走 §4 的 dsh-phoenix 优雅重启循环，而非手动 `systemctl restart`。
2. 在 pty 可用机器（如 CI）跑一次全量 `pnpm run test`，确认 182 例全绿（本会话 1 例 skip）。
3. 视需要将 `docs/maintenance` 清理，并在 README 补 pnpm 版本声明。
4. 保持“提交前 typecheck+test+build 全绿 + 行为变更补测试 + push 后 CI 绿”的验收线。

---

## 7. 本次维护记录（时间线）

- 检查仓库/分支/远端；`gh issue ls`（无 open，2 closed）。
- 评估 2 条已关闭 issue 的建议（§1.2）。
- 定位并复现 `ros2_install` PTY 测试失败（pty 受限，3/3 稳定）。
- 归并工具/用例数量漂移（core 59 / vision 7 / 聚合 79 / 182 例）。
- 开分支 `fix/maintenance-daily` → 两枚提交（`fix(test)`、`docs`）→ push → PR #5。
- 本地 typecheck/test/build 全绿；dsh-phoenix 接线核对（§4）。
```

---

## 8. 维护记录（2026-09-04 · 第二轮：无 open issue → 安全检查 + 验证）

> 本轮结论：**无未处理 issue**（0 open issue / 0 open PR）。按流程 `1 → 有 issue→2,3,4 / 无 issue→5` ，直接转入**安全检查（step 5）**。
> 因此本轮是**纯验证 + 安全检查**型维护：**未做任何代码改动**，故不新开分支、不提交、不触发 dsh-phoenix 优雅重启。

### 8.0 仓库快照（本轮）

| 项 | 值 |
| --- | --- |
| 当前分支 | `main`（= `origin/main` HEAD `ee3ae03`，工作树干净） |
| 远端分支 | `origin/main`，`origin/docs/maintenance`（历史遗留，落后于 main；见 §5 建议清理） |
| main CI 状态 | HEAD `ee3ae03`：check(22) / check(24) 均 `completed: success` |
| 本地 Node / pnpm | Node `v24.16.0` / pnpm `11.22.0`（root `packageManager` 一致） |
| 包数量 | 9 个（common/core/dsh-ros2/dsh-ros2-state/moveit/profile/safety/sidecar/vision） |

### 8.1 Issue 检查（step 1）

`GET /repos/StvLi/dsh-ros2/issues?state=open` → **0 open**；`/pulls?state=open` → **0 open**。
历史全部 closed：issue #1（docs consolidate）、#2（pnpm11 build）、#3（docs counts）；PR #1、#5（已合并）。
→ **不存在未处理 issue**，跳转安全检查；未做步骤 2/3/4 的“建议评估/分支开发”。

### 8.2 本地验证（typecheck / test / build 全绿；step 0 健康检查）

```bash
CI=true pnpm run typecheck   # 9/10 工程 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run test        # 182 vitest（core 93 过 + 1 skip）；sidecar python3 -m sidecar.selftest → SELFTEST PASSED (10 scenarios)；exit 0
CI=true pnpm run build       # pnpm -r build 全部 Done（exit 0）
```
用例分布：common 13 + core 94 + moveit 16 + profile 11 + safety 8 + vision 30 + state 8 + dsh-ros2 2 = **182**（CI 允许 1 例 pty-skip）。

### 8.3 安全扫描（step 5）

**依赖审计（pnpm audit）**：默认 registry 为 `registry.npmmirror.com`，无 `/-/npm/v1/security/advisories/bulk` 端点（直接 `ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`）；须显式 `--registry=https://registry.npmjs.org`。
结果：**No known vulnerabilities found**（exit 0，覆盖 `@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery` 等运行依赖）。

**静态 / 历史扫描**：

- 硬编码密钥（`AKIA…` / `sk-…` / `ghp_…` / `BEGIN RSA|OPENSSH|EC|DSA PRIVATE` / `AIza…` / `xox…`）：**源代码与 git 全历史均无泄漏**。`.gitignore` 正确排除 `secrets.json` / `*.secrets.json` / `.env` / `lib/` / `node_modules/`。
- `eval` / `new Function` / `vm`：**无**。
- 命令执行面：`spawn` / `execFile` 均使用**数组参数**（不做 shell 展开）；`runCommand`（`common/src/runner.ts`）对每个 arg 经 `shq()` 单引号转义——**参数层防注入**。`spawnJob` 同样数组参数。

**发现（低–中，未在本轮改动，列为改进建议）**：

1. **`ros2_workspace use <path>` 的会话级 source 前缀未做 shell 转义**（`packages/core/src/tools.ts:1429` `setSessionRosSetup(\`source ${setup} && \`)`）。
   - `setup = path.join(p,'install','setup.bash')`，`p` 为用户参数；随后在 `runner.ts:168,172` 被拼接进 `bash -lc` 字符串。
   - **实际可利用性低**：`access(setup)` 要求该**字面路径真实存在**才通过校验（含 `;` / 空格的文件名极为罕见）。
   - 但属**隐式注入 / 误解析**风险：路径含空格会令 `source` 失败、含元字符可逃逸。
   - **安全修复非一行**：需对 source 路径加 shell 引号（`shq()` 或内联转义）**并**同步改造 `extractSourcePath()`（`runner.ts:76`，当前正则 `\bsource\s+([^\s&;|]+)` 只捕获裸路径，会因引号误判为“路径不存在”而触发错误回退）——即 setter 与读取两端 + 补测试。本轮无驱动 issue，未扩大范围，作为建议保留。
2. **`packages/vision/scripts/simplify_visual_meshes.py:22` 顶层 `import open3d`**：脚本 docstring 有 `pip install open3d` 说明，但无 `requirements.txt` / `pyproject.toml` 声明 → **未声明的可选运行依赖**（工具脚本、非常驻服务，风险低）。
3. **默认 registry 无 audit 端点**：CI/维护中的 `pnpm audit` 会假失败，需显式指定官方 registry 或配置含 audit 能力 registry。

### 8.4 dsh-phoenix 持续更新/测试链路核对（step 4 侧）

- 安装：web profile `package.json` `dsh-phoenix: link:…/dsh-phoenix`（v0.2.6）；`dsh-ros2` 及各 `dsh-ros2-*` 包同样以 `link:` 装入。
- 生效：`curl http://127.0.0.1:3080/__dsh_health` → `{"token":"…"}`（client 自动重连在跑）；`systemctl --user list-units` → `dsh-web.service … active running`。
- 本轮**无运行时行为改动**，**有意不触发** dsh-phoenix 优雅重启（其触发条件为 dsh 编译插件 `cordis_run`，且会中断本会话）。

### 8.5 结论与下一步建议

- 本轮**无代码变更**：无 open issue + 本地验证全绿 + audit/静态扫描干净 + main CI 绿。
- 下次维护可选：
  1. 对 `ros2_workspace` source 前缀做 shell 转义（setter + `extractSourcePath` + 测试）。
  2. 为 `simplify_visual_meshes.py` 补 `requirements.txt`/`pyproject` 声明 `open3d`。
  3. `git push origin --delete docs/maintenance` 清理历史遗留分支。
  4. README 补显式 pnpm 版本声明（CI 已固定 11.22.0）。
  5. 沿用“提交前 typecheck+test+build 全绿 + 行为变更补测试 + push 后 CI 绿”验收线；`pnpm audit` 需加 `--registry=https://registry.npmjs.org`。

---

## 9. 维护记录（2026-09-05 · 第三轮：无 open issue → 安全检查 → 落地安全修复）

> 本轮结论：**无未处理 issue**（0 open issue / 0 open PR）。按流程 `1 → 无 issue→5`，先跑**安全检查**；
> 检查中确认上一轮（§8.5）列为“下次维护可选”的 **`ros2_workspace` source 路径未转义**问题仍存在，
> 且属真实（低–中）注入面 + 含空格路径的功能缺陷。本轮**一并落地修复**（走标准 `fix/` 分支 + 常规提交），
> 因此本轮为 **“安全检查 + 安全修复 + 验证 + 文档”** 型维护，不再是无改动的纯验证轮。

### 9.0 仓库快照（本轮起始）

| 项 | 值 |
| --- | --- |
| 起始分支 | `main`（HEAD `a03c60f`；此时本地领先 `origin/main` 1 个 docs 提交，未推送——历史维护文档本地保留） |
| 起始远端分支 | `origin/main`，`origin/docs/maintenance`（历史遗留，落后于 main，§5 已建议清理） |
| 新开分支 | `fix/ros2-workspace-path-quoting`（已推送，PR **#6**） |
| 起始 main CI | HEAD `ee3ae03`（已合并 PR #5）：check(22)/check(24) `completed: success` |
| 本地 Node / pnpm | Node `v24.16.0` / pnpm `11.22.0`（root `packageManager` 一致） |
| 包数量 | 9 个（common/core/dsh-ros2/dsh-ros2-state/moveit/profile/safety/sidecar/vision） |

**本轮结束状态**：`origin/main` 已推进到 `c423e49`（**PR #6 已合并**，main CI `completed: success`）；远程仅剩 `main`
（`docs/maintenance` 已不在远程，`fix/…` 分支已删除）；本地 `main` 在 `f26dafd`（领先 `origin/main` 1 个 `docs:` 提交
= 本维护文档 §9，未推送，符合“本地维护”要求）。

### 9.1 Issue 检查（step 1）

`GET /repos/StvLi/dsh-ros2/issues?state=open` → **0 open**；`GET /pulls?state=open` → **0 open**。
历史全部 closed：issue #1（docs consolidate）、#2（pnpm11 build）、#3（docs counts）；PR #1、#5（已合并）。
→ **不存在未处理 issue**，转入 step 5（安全检查）。**未**将 `ros2_workspace` 转义当作“issue”计为 step 2/3 的驱动条目；
它来自安全扫描（step 5）的发现，按 step 5 → 修复的路径处理（见 §9.2/§9.3）。

### 9.2 安全扫描（step 5）——复测 + 落地修复

**依赖审计（`pnpm audit`）**：默认 registry 为 `registry.npmmirror.com` 无 audit 端点，须显式
`--registry=https://registry.npmjs.org`。
结果：**No known vulnerabilities found**（exit 0，覆盖 `@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery` 等运行依赖）。

**静态 / 历史扫描**（复测，均干净）：

- 硬编码密钥（`AKIA…`/`sk-…`/`ghp_…`/`BEGIN RSA|OPENSSH|EC|DSA PRIVATE`/`AIza…`/`xox…`）：**源码与 git 全历史均无泄漏**。
  `.gitignore` 正确排除 `secrets.json`/`*.secrets.json`/`.env`/`lib/`/`node_modules/`。
- `eval`/`new Function`/`vm`：**无**。
- 命令执行（`spawn`/`execFile`）：均数组参数；`runCommand`（`common/src/runner.ts`）对每个 arg 经 `shq()` 转义——参数层防注入。`spawnJob` 同样数组参数。

**本轮发现并落地修复（低–中，真实注入面 + 功能缺陷）：**

1. **`ros2_workspace {action:'use', path}` 的 source 路径未转义**（`packages/core/src/tools.ts:1429`）：
   `setSessionRosSetup(\`source ${setup} && \`)` 把用户路径 `p`（经 `path.join(p,'install','setup.bash')`）**原样**存进会话前缀，
   随后在 `runner.ts:172` 经 `bash -lc` 执行。路径含 `;`/`&`/`$(...)` 等 shell 元字符可逃逸（注入面）；
   路径含**空格**（如 `my workspace`）则 source 直接失败（功能缺陷）。
   - 原可利用性低：`access(setup)` 要求该字面路径真实存在才通过校验；但属**隐式注入 / 误解析**风险，且空格路径是现实场景。
   - **修复（`fix(workspace)`）**：
     - `common/src/runner.ts`：`shq()` 由私有改为 **export**（POSIX 单引号转义，单个安全 shell 词）；
       `extractSourcePath()` 支持**反解析单/双引号包裹的路径**（de-quote），使存在性检查与 `show` 仍旧读到真实（未引号）路径。
     - `core/src/tools.ts`：`setSessionRosSetup(\`source ${shq(setup)} && \`)`——路径始终作为单个引号 shell 词。
     - **回归测试**：common +1（shq 单引号包裹的含空格路径能正确 round-trip 回原始路径）、core +1（存储前缀形如
       `source '<path>' && `，非原样插值）。工作区 vitest 用例 **182 → 184**。
   - 其余命令执行面（`spawn`/`execFile`/`runCommand`/`spawnJob`）经复测**均无未转义用户输入进 shell 字符串**。

### 9.3 开发管理（git · step 3）

- 基分支：`main`（干净）。
- 新开分支：`fix/ros2-workspace-path-quoting`（`fix/...` 前缀，符合“修复问题”语义）。
- 提交（Conventional Commits）：

| commit | 类型 | 说明 |
| --- | --- | --- |
| `3f5c97b` | `fix(workspace)` | `ros2_workspace` source 路径 `shq()` 转义 + `extractSourcePath()` de-quote + 2 例回归测试 + CHANGELOG |
| `97556fb` | `docs` | README/README_CN 工作区 vitest 用例 182 → **184**（2 例新回归测试） |

- PR：**#6** `fix(workspace): shell-quote ros2_workspace source path (injection + space-safe)`（base `main`，`MERGEABLE`，已于本轮**合并**）。

### 9.4 本地验收（全绿）

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
CI=true pnpm run typecheck   # 10/10 项目 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run test        # 184 vitest（core 94 过 + 1 pty-skip；本机无 pty 那 1 例 skip）；sidecar python3 -m sidecar.selftest → SELFTEST PASSED (10 scenarios)；exit 0
CI=true pnpm run build       # pnpm -r build 全部 Done（exit 0）
```

用例分布：common 14 + core 95(94+1skip) + moveit 16 + profile 11 + safety 8 + vision 30 + state 8 + dsh-ros2 2 = **184**（CI 允许 1 例 pty-skip）。
> `CI=true` 原因同 §3.2（本机 node_modules 由旧 pnpm 配置生成，pnpm 会因 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 提示清空 modules）。
> push 后 GitHub CI（Node 22/24）在 PR #6 上校验（typecheck 已绿，test/build/工具数校验运行中）。

### 9.5 dsh-phoenix 持续更新/测试链路核对（step 4 侧）

- 安装：web profile `package.json` `dsh-phoenix: link:…/dsh-phoenix`（v0.2.6），并列入 `bundles`；`dsh-ros2` 及各 `dsh-ros2-*` 包同样以 `link:` 装入。
- 生效：`curl http://127.0.0.1:3080/__dsh_health` → `{"token":"…"}`（client 自动重连在跑）；`systemctl --user list-units` → `dsh-web.service … active running`。
- **本轮有运行时行为变更**（`ros2_workspace use` 前缀格式 + 新增 `shq`/`extractSourcePath` 逻辑）。是否让运行中的 dsh web 立即生效：
  **有意未就地触发** dsh-phoenix 优雅重启——其触发条件为 dsh 编译插件 `cordis_run` 且会中断本会话；且 phoenix 为 idle-aware（本会话为 busy agent，此刻也不会重启）。
  该变更已**合并**并经 CI 校验（PR #6，main CI `success`），将在运行中 dsh web **下次重载/重启**时自然生效（dsh-ros2 包以 symlink 装入，`lib/` 已重建）。
  给后续维护者：若需立即生效，走 §4 的 dsh-phoenix 优雅重启循环（先确认无 busy agent、再触发 `cordis_run`），而非手动 `systemctl restart`。

### 9.6 结论与下一步建议

- 本轮**落地 1 项安全修复**（`ros2_workspace` source 路径转义，注入面 + 空格路径功能双修）+ 2 例回归测试 + 元数据对齐（README 184 例）。
- 本地 typecheck/test/build 全绿（184 例 + 10 sidecar 场景）；`pnpm audit` 干净；静态/历史无密钥、无 `eval`/`vm`。
- 下次维护可选：
  1. 为 `simplify_visual_meshes.py` 补 `requirements.txt`/`pyproject` 声明 `open3d`（未声明可选运行依赖）。
  2. `docs/maintenance` 已不在远程（本轮 `fetch --prune` 已同步清理该陈旧跟踪引用）——无需再删。
  3. README 补显式 pnpm 版本声明（CI 已固定 11.22.0）。
  4. 维护文档为本地产物未推送（符合“本地维护”要求）；如需随仓库走，可对 `main` 的 `docs:` 提交做 `git push`（当前本地领先 1 个 docs 提交：`f26dafd`）。
  5. 沿用“提交前 typecheck+test+build 全绿 + 行为变更补测试 + push 后 CI 绿”验收线；`pnpm audit` 需加 `--registry=https://registry.npmjs.org`。
---

## 10. 维护记录（2026-09-05 · 第四轮：无 open issue → 安全检查 → 落地两项维护卫生修复）

> 本轮结论：**无未处理 issue**（0 open issue / 0 open PR）。按流程 `1 → 无 issue→5`，先跑**安全检查**；
> 检查复测干净（`pnpm audit` 无漏洞、静态/历史无密钥、无 `eval`/`vm`、命令执行面均为数组参数），
> 其中发现上一轮（§8.3/§9.6）列为“下次维护可选”的两项**低风险维护卫生**问题仍存在，本轮**一并落地**：
> ① `simplify_visual_meshes.py` 的 `open3d` 未声明运行依赖；② README 未显式声明 pnpm 版本要求。
> 走标准 `fix/` 分支 + 常规提交，因此本轮为 **“安全检查 + 维护卫生修复 + 验证 + 文档”** 型维护。

### 10.0 仓库快照（本轮起始）

| 项 | 值 |
| --- | --- |
| 起始分支 | `main`（HEAD `6b274c8`＝本地 round-3 维护文档提交，领先 `origin/main` 1 个 `docs:`，未推送） |
| 远端 `origin/main` | `c423e49`（PR #6 已合并）；远程仅剩 `main`（`docs/maintenance`、历史 `fix/…` 均已不在远程，`fetch --prune` 同步） |
| 新开分支 | `fix/vision-declare-python-deps`（已推送，PR **#7**） |
| 起始 main CI | HEAD `c423e49`（已合并 PR #6）：check(22)/check(24) `completed: success` |
| 本地 Node / pnpm | Node `v24.16.0` / pnpm `11.22.0`（root `packageManager` 一致） |
| 包数量 | 9 个（common/core/dsh-ros2/dsh-ros2-state/moveit/profile/safety/sidecar/vision） |

### 10.1 Issue 检查（step 1）

`GET /repos/StvLi/dsh-ros2/issues?state=open` → **0 open**；`GET /pulls?state=open` → **0 open**。
历史全部 closed/merged：issue #1（docs consolidate）、#2（pnpm11 build）、#3（docs counts）；PR #1、#5、#6（已合并）。
→ **不存在未处理 issue**，转入 step 5（安全检查）。未将本轮两项修复当作“issue”计为 step 2/3 的驱动条目；
它们来自安全扫描（step 5）与上轮推荐（§9.6），按 step 5 → 修复的路径处理。

### 10.2 安全扫描（step 5）——复测 + 落地两项维护卫生修复

**依赖审计（`pnpm audit`）**：默认 registry 为 `registry.npmmirror.com` 无 audit 端点，须显式
`--registry=https://registry.npmjs.org`。结果：**No known vulnerabilities found**（exit 0，覆盖
`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery` 等运行依赖）。

**静态 / 历史扫描**（复测，均干净）：

- 硬编码密钥（`AKIA…`/`sk-…`/`ghp_…`/`BEGIN RSA\|OPENSSH\|EC\|DSA PRIVATE`/`AIza…`/`xox…`）：**源码与 git 全历史均无泄漏**。
  `.gitignore` 正确排除 `secrets.json`/`*.secrets.json`/`.env`/`lib/`/`node_modules/`；仓库内无 `secrets.json`/`.env` 实体。
- `eval`/`new Function`/`vm`：**无**。
- 命令执行面：`spawn`/`execFile` 均使用**数组参数**（无 `shell:true`、无字符串形式 `exec`）；`runCommand`
  （`common/src/runner.ts`）对每个 arg 经 `shq()` 转义；`spawnJob` 同样数组参数。
- 复测确认 **round-3 的 `ros2_workspace` 修复已正确存在**：`runner.ts` `shq()` 已 export、`extractSourcePath()`
  支持反解析单/双引号路径、`core/src/tools.ts` 以 `source ${shq(setup)} &&` 拼接——本次未再触发该类问题。

**本轮发现并落地修复（低风险·维护卫生）：**

1. **`simplify_visual_meshes.py` 的 `open3d` 依赖未声明**（§8.3 #2 / §9.6 #1）：
   - 现象：`packages/vision/scripts/simplify_visual_meshes.py` 顶部 `import open3d as o3d`，但仅 docstring
     提到 `pip install open3d`；仓库无任何 `requirements.txt`/`pyproject.toml` 声明该**未声明的可选运行依赖**。
   - 影响面：低（工具脚本、非常驻服务），但属**安装/发布卫生**问题——他人无法 `pip install -r` 复现环境。
   - 修复（`chore(vision)`）：新增 `packages/vision/scripts/requirements.txt`，内容 `open3d>=0.18` 并附安装说明；
     该目录已含于 vision 包 `package.json` 的 `files` 白名单（`scripts`），将随 npm 包发布。

2. **README 未显式声明 pnpm 版本要求**（§9.6 #3）：
   - 现象：root `packageManager: pnpm@11.22.0` 且 CI 用 `pnpm/action-setup@v4` 固定，但 README/README_CN 开发章节未写明“需 pnpm 11.x”。
   - 修复（`docs`）：README/README_CN 开发章节补一行“安装需 **pnpm 11.x**（固定 `packageManager: pnpm@11.22.0`，CI 经
     `pnpm/action-setup@v4` 安装匹配版本）；Node `^22.19 \|\| >=24`”；CHANGELOG `[Unreleased]` 增补 `### Added`（open3d）与 `### Changed`（pnpm 前置）。

### 10.3 开发管理（git · step 3）

- 基分支：`origin/main`（`c423e49`，干净）。
- 新开分支：`fix/vision-declare-python-deps`（`fix/...` 前缀；本轮两项改动为“补齐缺失声明/文档”，语义上属修复类）。
- 说明：本轮由本地 `main`（领先 `origin/main` 1 个 round-3 docs 提交）新开分支，初始 PR 误含该 round-3 docs 提交；
  **已将分支 rebase 到 `origin/main` 上**（cherry-pick 仅保留本轮 2 枚提交），使 PR 聚焦、维护文档保持本地（§10.6）。
- 提交（Conventional Commits）：

| commit | 类型 | 说明 |
| --- | --- | --- |
| `65013ea` | `chore(vision)` | 新增 `packages/vision/scripts/requirements.txt`，声明 `open3d>=0.18`（补齐未声明运行依赖） |
| `d3737ed` | `docs` | README/README_CN 补 pnpm 11.x 前置声明 + CHANGELOG `[Unreleased]` 增补（Added/Changed） |

- PR：**#7** `fix(vision): declare open3d runtime dep + document pnpm 11.x requirement`（base `main`，`MERGEABLE`，CI 绿后合并）。

### 10.4 本地验收（全绿）

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
CI=true pnpm run typecheck   # 10 个项目 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run test        # 184 vitest（core 94 过 + 1 pty-skip）；sidecar python3 -m sidecar.selftest → SELFTEST PASSED (10 scenarios)；exit 0
CI=true pnpm run build       # pnpm -r build 全部 Done（exit 0）
```

用例分布：common 14 + core 95(94+1 skip) + moveit 16 + profile 11 + safety 8 + vision 30 + state 8 + dsh-ros2 2 = **184**（CI 允许 1 例 pty-skip）。
> `CI=true` 原因同 §3.2（本机 node_modules 由旧 pnpm 配置生成，pnpm 会因 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 提示清空 modules）。

### 10.5 dsh-phoenix 持续更新/测试链路核对（step 4 侧）

- 安装：web profile `package.json` `dsh-phoenix: link:…/dsh-phoenix`，并列入 `dsh.profile.bundles`；`dsh-ros2` 及各 `dsh-ros2-*` 包同样以 `link:` 装入。
- 生效：`curl http://127.0.0.1:3080/__dsh_health` → `{"token":"…"}`（client 自动重连在跑）；`systemctl --user list-units` → `dsh-web.service … active running`。
- **本轮无运行时行为变更**（requirements.txt 声明 + README 文档），**有意未触发** dsh-phoenix 优雅重启——
  其触发条件为 dsh 编译插件 `cordis_run` 且会中断本会话；该改动已随 PR #7 合并并经 CI 校验，将在 dsh web 下次重载时自然生效。

### 10.6 结论与下一步建议

- 本轮**落地 2 项维护卫生修复**（`open3d` 依赖声明 + README pnpm 11.x 前置）；安全扫描复测干净；本地 typecheck/test/build 全绿。
- 维护文档为本地产物**未推送**（`main` 领先 `origin/main` 1 个 `docs:` 提交＝本轮 §10），符合“本地维护”要求。
- 下次维护可选：
  1. 若需在 pty 可用机器（如 CI）跑一次全量 `pnpm run test`，确认 184 例全绿（本机 1 例 pty-skip）。
  2. `docs/maintenance` 与历史 `fix/…` 分支已不在远程（`fetch --prune` 已同步）——无需再删。
  3. 维持“提交前 typecheck+test+build 全绿 + 行为变更补测试 + push 后 CI 绿”验收线；`pnpm audit` 需加 `--registry=https://registry.npmjs.org`。

---

## 11. 维护记录（2026-09-06 · 第五轮：无 open issue → 安全检查 → 落地 `ros2_install` 注入修复）

> 本轮结论：**无未处理 issue**（0 open issue / 0 open PR）。按流程 `1 → 无 issue→5`，先跑**安全检查**。
> 检查中复测发现上一轮（§8.3/§9.2）“命令执行面均无未转义用户输入进 shell 字符串”的结论**遗漏了一处**：
> **`ros2_install {action:"start"}` 把用户传入的 `installer` 原样插进 `curl -fsSL ${installer}`**（真实注入面 + 含空格路径功能缺陷）。
> 本轮**一并落地修复**（走标准 `fix/` 分支 + 常规提交），因此本轮为 **“安全检查 + 安全修复 + 验证 + 文档”** 型维护。
> 首版修复尝试把下载改走 `deps.run`（为可注入测试），但**破坏了 PTY 交互测试**（mock `run` 不真正执行 `cp`，bootstrap 文件未生成）；
> 已回退为 `execFileP` + 抽取纯函数 `buildRos2InstallDownloadCommand()` 的方案。

### 11.0 仓库快照（本轮起始/结束）

| 项 | 值 |
| --- | --- |
| 开始分支 | `main`（HEAD `c042619`＝本地 round-4 docs 提交，领先 `origin/main` 1 个 `docs:`，未推送） |
| 开始 `origin/main` | `4c35ea8`（PR #7 已合并，main CI success） |
| 新开分支 | `fix/ros2-install-installer-quoting`（已推送，PR **#8**） |
| 结束 `origin/main` | `fbd09a2`（PR #8 合并 commit；main CI success） |
| 本地 Node / pnpm | Node `v24.16.0` / pnpm `11.22.0`（root `packageManager` 一致） |
| 包数量 | 9 个（common/core/dsh-ros2/dsh-ros2-state/moveit/profile/safety/sidecar/vision） |
| 工作区 vitest | **185** 例（common 14 + core 96(95 过+1 pty-skip) + moveit 16 + profile 11 + safety 8 + vision 30 + state 8 + dsh-ros2 2）＋ sidecar selftest 10 场景 |

### 11.1 Issue 检查（step 1）

`GET /repos/StvLi/dsh-ros2/issues?state=open` → **0 open**；`GET /pulls?state=open` → **0 open**（本轮开始前）。
历史全部 closed/merged：issue #1（docs consolidate）、#2（pnpm11 build）、#3（docs counts）；PR #1、#5、#6、#7（已合并）。
→ **不存在未处理 issue**，转入 step 5（安全检查）。**未**把 `ros2_install` 注入当作“issue”计为 step 2/3 的驱动条目；
它来自安全扫描（step 5）的发现，按 step 5 → 修复的路径处理。

### 11.2 安全扫描（step 5）——复测 + 发现并落地 1 项注入修复

**依赖审计（`pnpm audit`）**：默认 registry 为 `registry.npmmirror.com` 无 audit 端点，须显式
`--registry=https://registry.npmjs.org`。结果：**No known vulnerabilities found**（exit 0，覆盖
`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery` 等运行依赖）。

**静态 / 历史扫描**（复测，均干净）：
- 硬编码密钥（`AKIA…`/`sk-…`/`ghp_…`/`BEGIN RSA|OPENSSH|EC|DSA PRIVATE`/`AIza…`/`xox…`）：**源码与 git 全历史均无泄漏**。
  `.gitignore` 正确排除 `secrets.json`/`*.secrets.json`/`.env`/`lib/`/`node_modules/`；仓库内无 `secrets.json`/`.env` 实体
  （仅有 `packages/vision/src/secrets.ts` 与其测试，为读取逻辑，非密钥实体）。
- `eval`/`new Function`/`vm`：**无**。
- 命令执行面：`spawn`/`execFile` 均用**数组参数**（无 `shell:true`、无字符串形式 `exec`）；`runCommand`（`common/src/runner.ts`）
  对每个 arg 经 `shq()` 转义；`spawnJob` 同样数组参数。
- 复测确认 round-3 的 `ros2_workspace` 修复正确存在（`runner.ts` `shq()` export + `extractSourcePath()` de-quote + `core/src/tools.ts` `source ${shq(setup)} &&`）。

**本轮发现并落地修复（低–中，真实注入面 + 功能缺陷）：**

1. **`ros2_install {action:"start"}` 的下载命令未转义 `installer`**（`packages/core/src/tools.ts`）：
   - 现象：`const installer = strOrUndefined(params.installer) ?? FISHROS_INSTALL_URL`，随后
     `execFileP('bash', ['-lc', \`mkdir -p "${bootDir}" && (curl -fsSL ${installer} -o "${boot}" || wget -q ${installer} …\`)])`
     把**用户传入的 `installer` 原样**插进 `bash -lc` 字符串；`bootDir`/`boot` 仅双引号包裹。
   - 注入面：`installer` 含 `;`/`&`/`$(...)` 等 shell 元字符可**逃逸**（如 `http://x/a;touch /tmp/pwned` → 执行 `touch`）。
   - 功能缺陷：含**空格**的本地路径/URL 会让下载失败。
   - 可利用性：**低–中**——工具本身需用户批准（approval-gated），但批准文案为固定串、不体现 `installer` 实际来源；
     `installer` 由 agent/用户控制，属**真实注入面**。这也是本轮唯一改动来源（step 5 → 修复路径）。
   - **修复（`fix(install)`）**：
     - 抽取**纯函数** `buildRos2InstallDownloadCommand(installer, bootDir, boot): string`，把所有用户/路径派生值
       （`installer`/`bootDir`/`boot`/`src`）用 `shq()`（单 shell 词）转义，不再裸/双引号插值。
     - 工具仍用 `execFileP('bash', ['-lc', …])` 下发（保持真实执行、不破坏 PTY 交互测试）。
     - **回归测试**：core +1，断言下载命令把带元字符的 `installer` 作为单个 `shq()` shell 词输出（`curl -fsSL '…'`）。
   - 其余命令执行面复测：`profilePath` 两处（`profile/tools.ts:159`、`safety/tools.ts:117`）为**手动单引号**包裹
     （`--profile '${profilePath}'`），较裸插值安全，仅当 `profilePath` 含内嵌单引号时才可能逃逸 → 列为建议（§11.6 #1）。

### 11.3 开发管理（git · step 3）

- 基分支：`origin/main`（`4c35ea8`，干净）。
- 新开分支：`fix/ros2-install-installer-quoting`（`fix/...` 前缀，符合“修复问题”语义）。
- 提交（Conventional Commits）：

| commit | 类型 | 说明 |
| --- | --- | --- |
| `51e9fc6` | `fix(install)` | `ros2_install` 下载命令 `shq()` 转义（抽取 `buildRos2InstallDownloadCommand`）+ 1 例回归测试 + CHANGELOG |
| `d313219` | `docs` | README/README_CN 工作区 vitest 用例 184 → **185**（1 例新回归测试） |

- PR：**#8** `fix(install): shq() quote ros2_install installer source (injection + space-safe)`（base `main`，`MERGEABLE`，CI 绿后合并）。
- **中途修正**：首版把下载从 `execFileP` 改为 `deps.run`（为可注入测试），但 CI 的 **PTY 交互测试失败**——
  该测试的 mock `run` 对 `bash` 一律返回 `ok:true` 而**不真正执行**，导致 `cp`/`chmod` 未发生、bootstrap 文件未生成，
  pty 会话运行 `bash /tmp/dsh-ros2/fishros-install` 报 “No such file or directory”。
  → 回退为 `execFileP`（真实执行，保住 PTY 测试），改为抽取纯函数 `buildRos2InstallDownloadCommand()` 使命令可单测。
  该修正 history-rewrite + force-push 覆盖 PR #8，重跑 CI **全绿**。

### 11.4 本地验收（全绿）

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
CI=true pnpm run typecheck   # 10 项目 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run test        # 185 vitest（core 96=95 过+1 pty-skip）+ sidecar selftest 10 场景；exit 0
CI=true pnpm run build       # pnpm -r build 全部 Done（exit 0）
```

用例分布：common 14 + core 96(95+1 skip) + moveit 16 + profile 11 + safety 8 + vision 30 + state 8 + dsh-ros2 2 = **185**（CI 允许 1 例 pty-skip）。
> `CI=true` 原因同 §3.2/§10.4（本机 node_modules 由旧 pnpm 配置生成，pnpm 会因 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 提示清空 modules）。
> push 后 GitHub CI（Node 22/24）在 PR #8 校验：`pnpm run typecheck`/`test`/`build` 均绿；合并后 main CI 亦 success。

### 11.5 dsh-phoenix 持续更新/测试链路核对（step 4 侧）

- 安装：web profile `package.json` `dsh-phoenix: link:…/dsh-phoenix`（并列入 bundles）；`dsh-ros2` 及各 `dsh-ros2-*` 包同样以 `link:` 装入（`node_modules` 内均为 symlink）。
- 生效：`curl http://127.0.0.1:3080/__dsh_health` → `{"token":"…"}`（client 自动重连在跑）；`systemctl --user list-units` → `dsh-web.service … active running`。
- **本轮有运行时行为变更**（`ros2_install start` 下载命令的 `shq()` 转义）。是否让运行中的 dsh web 立即生效：
  **有意未就地触发** dsh-phoenix 优雅重启——其触发条件为 dsh 编译插件 `cordis_run` 且会中断本会话；且 phoenix 为 idle-aware（本会话为 busy agent，此刻也不会重启）。
  该变更已**合并**并经 CI 校验（PR #8，main CI success），将在运行中 dsh web **下次重载/重启**时自然生效（dsh-ros2 包以 symlink 装入，`lib/` 已重建）。
  给后续维护者：若需立即生效，走 §4 的 dsh-phoenix 优雅重启循环（先确认无 busy agent、再触发 `cordis_run`），而非手动 `systemctl restart`。

### 11.6 结论与下一步建议

- 本轮**落地 1 项安全修复**（`ros2_install` 下载命令的 `installer` `shq()` 转义，注入面 + 空格路径功能双修）+ 1 例回归测试 + 元数据对齐（README 185 例）。
- 本地 typecheck/test/build 全绿（185 例 + 10 sidecar 场景）；`pnpm audit` 干净；静态/历史无密钥、无 `eval`/`vm`；命令执行面复测后仅剩 `profilePath` 手动引号建议项。
- 下次维护可选：
  1. **`profilePath` 手动单引号改为 `shq()`**（`profile/tools.ts:159`、`safety/tools.ts:117` 的 `--profile '${profilePath}'`）：
     加 `shq` import 后改 `--profile ${shq(profilePath)}`，防御 `profilePath` 含内嵌单引号时的逃逸；需补 1 例回归测试。
  2. **清理 monolith 遗留**：根目录 `src/`（`config.ts`/`index.ts`/`skill.ts`/`tools.ts`）与 `lib/`、根 `tsconfig.json`/`tsconfig.build.json`
     为 monorepo 拆分前的单体遗留，**未被任何 workspace 包引用**（`pnpm -r` 不构建根 `src/`），但已被 git 跟踪——建议确认无引用后删除，避免死代码与重复注入面。
  3. `pnpm audit` 需加 `--registry=https://registry.npmjs.org`（默认镜像无审计端点）；维持“提交前 typecheck+test+build 全绿 + 行为变更补测试 + push 后 CI 绿”验收线。
  4. 可在 pty 可用机器（CI）跑一次全量 `pnpm run test` 确认 185 例全绿（本机 1 例 pty-skip）。
  5. 维护文档为本地产物**未推送**（`main` 领先 `origin/main` 2 个 `docs:` 提交＝round-4 §10 + 本轮 §11），符合“本地维护”要求。

---

## 12. 维护记录（2026-09-11 · 第六轮：无 open issue → 安全检查 → 落地 2 类注入修复 + 依赖/CI 加固）

> 本轮结论：**无未处理 issue**（0 open issue / 0 open PR）。按流程 `1 → 无 issue→5`，先跑安全检查。
> 检查发现并落地：`ros2_zero_pose_semantics` Python 助手的 **3 处注入/逃逸面**、`safety_monitor` 启动命令的
> **profile 路径引号缺陷**、2 条 `pnpm audit` moderate 依赖告警（vitest），另做 CI 最小权限加固。
> 因此本轮为 **“安全检查 + 2 类注入修复 + 依赖升级 + CI 加固 + 验证 + 文档”** 型维护。

### 12.0 仓库快照（本轮起始/结束）

| 项 | 值 |
| --- | --- |
| 开始分支 | `main`（HEAD `96c8e8e`＝本地 round-5 docs 提交，领先 `origin/main` 2 个 `docs:`，未推送） |
| 开始 `origin/main` | `fbd09a2`（PR #8 已合并，main CI success） |
| 新开分支 | `fix/security-hardening`（已推送，PR **#9**） |
| 结束 `origin/main` | `c1cb718`（PR #9 合并 commit；post-merge main CI **success**，run `34524374411`） |
| 本地 Node / pnpm | Node `v24.16.0` / pnpm `11.22.0`（root `packageManager` 一致） |
| 包数量 | 9 个（common/core/dsh-ros2/dsh-ros2-state/moveit/profile/safety/sidecar/vision） |
| 工作区测试 | **187** vitest（common 16 + core 96(95 过+1 pty-skip) + moveit 16 + profile 11 + safety 8 + vision 30 + state 8 + dsh-ros2 2）＋ sidecar selftest 10 场景 ＋ **zero-pose selftest 6 项** |

### 12.1 Issue 检查（step 1）

`gh issue list --state open` → **0 open**；`gh pr list --state open` → **0 open**（本轮开始前）。
历史全部 closed/merged：issue #1–#3；PR #1、#5、#6、#7、#8。
→ **不存在未处理 issue**，转入 step 5（安全检查）；本轮改动均来自安全扫描发现。

### 12.2 安全扫描（step 5）——发现并落地 2 类修复 + 依赖告警

**依赖审计（`pnpm audit --registry=https://registry.npmjs.org`）**：由“clean”变为 **2 条 moderate**
（`GHSA-82fw-gwwq-j7x9`：vitest / `@vitest/mocker` `<4.1.11` 路径穿越 / 任意文件读取；无 3.x 补丁）。
处置：8 个包 devDependency `vitest` `^3.0.0 → ^4.1.11`（仅测试运行器、不随产物发布）。
升级后 `pnpm audit` 恢复 **No known vulnerabilities found**。

**本轮发现并落地修复 #1 —— `ros2_zero_pose_semantics` 的 Python 助手（低–中，三处）：**

| 位置 | 问题 | 修复 |
| --- | --- | --- |
| `ensure_rsp()` | **URDF 文件内容**单引号插值进 `bash -lc`，URDF 含 `'` 可逃逸执行 shell | 纯 argv 列表启动 `robot_state_publisher`（新增 `build_rsp_args()`），XML 为单个 argv 元素，不经 shell |
| `publish_zero_joints()` | URDF **关节名**格式化进生成脚本 `'''…'''`，含 `'''` 可逃逸 | 关节名以单个 argv 元素（JSON）传入，子脚本 `sys.argv[1]` 解析，源码不含名字 |
| `write_config()` | 自由文本 description 裸双引号写 YAML，含 `"`/换行可注入额外键 | 改用 `json.dumps()`（JSON 字符串即合法 YAML 双引号标量） |

新增 `--selftest`（6 项检查，无需 ROS / PyYAML），接入 `dsh-ros2-profile` 的 `test` 脚本
（对齐 sidecar selftest 模式），CI 每次运行都会回归验证。

**本轮发现并落地修复 #2 —— `safety_monitor` 启动命令的 profile 路径（低）：**
`robot_register`（自动拉起）与 `robot_safety_start` 用 `--profile '${profilePath}'` 手动单引号；
路径含内嵌单引号可逃逸进 `bash -lc`，含空格路径也不稳。抽取共享纯函数
`buildSafetyMonitorCommand()`（`dsh-ros2-common`，内部 `shq()`），两处调用点统一使用；+2 回归测试（common）。

**静态 / 历史复测（干净）：**
- 硬编码密钥（`AKIA…`/`sk-…`/`ghp_`/`BEGIN … PRIVATE KEY`/`AIza…`/`xox…`）：源码与 git 全历史均无泄漏。
- `eval`/`new Function`/`vm`/`shell:true`：无。
- 命令执行面：`spawn`/`execFile` 均数组参数；`runCommand`（`common/src/runner.ts`）对每个 arg 经 `shq()`；
  `core/gui.ts` 的自定义 `screenshotCommand` 来自插件配置（运维可信）且 `{output}` 经 `shq()`。
- Python 命令面：除本轮修复的两处外，`subprocess.run/Popen` 均为 argv 列表；仅 `zero_pose_semantics.py` 曾用 `bash -lc`。
- `ros2_interface_create` 有 `PATH_ESCAPE` 校验 + 存在性拒绝覆盖 + 审批；`vision/secrets.ts` 0600/0700、文件在仓库外（`~/.dsh-ros2/secrets.json`）。

### 12.3 开发管理（git · step 3）

- 基分支：`origin/main`（`fbd09a2`，干净）。新开分支：`fix/security-hardening`（`fix/...` 前缀，符合“修复问题”语义）。
- 提交（Conventional Commits）：

| commit | 类型 | 说明 |
| --- | --- | --- |
| `e212fe7` | `fix(safety)` | `safety_monitor` profile 路径 `shq()` 转义（`buildSafetyMonitorCommand`）+ 2 回归测试 |
| `711deeb` | `fix(deps)` | vitest `^3.0.0 → ^4.1.11`（清 `GHSA-82fw-gwwq-j7x9`） |
| `644045a` | `ci` | `permissions: contents: read` + `timeout-minutes: 30` |
| `0eae014` | `fix(zero-pose)` | Python 助手 3 处注入修复 + `--selftest`（6 项）接入 profile `test` |
| `133fd07` | `docs` | README/README_CN 用例 185→187 + CHANGELOG [Unreleased] |

- PR：**#9** `fix(security): harden shell/format surfaces, bump vitest, CI least-privilege`（base `main`）；
  PR CI（Node 22/24）**全绿**后按仓库惯例以 **merge commit** 合并（`c1cb718`），已删除分支。
- 合并后 main CI（run `34524374411`）**success**；本地 `main` 以 `git rebase origin/main` 收纳合并结果，
  保留 round-4/round-5 两个本地 `docs:` 提交在上方。

### 12.4 本地验收（全绿）

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
CI=true pnpm run typecheck   # 10 项目 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run test        # 187 vitest（core 95 过+1 pty-skip）+ sidecar 10 场景 + zero-pose 6 项；exit 0
CI=true pnpm run build       # pnpm -r build 全部 Done（exit 0）
pnpm audit --registry=https://registry.npmjs.org   # No known vulnerabilities found（exit 0）
```

> `CI=true` 原因同前几轮（本机 node_modules 由旧 pnpm 配置生成）；本轮因升级 vitest 先执行过
> `pnpm install --no-frozen-lockfile`（`CI=true` 会默认 frozen-lockfile，需显式放开一次）。

### 12.5 dsh-phoenix 持续更新/测试链路核对（step 4 侧）

- **活动 profile**：`/home/stvli/.dsh/profiles/web/package.json` 含
  `dsh-phoenix: link:…/dsh-phoenix`、`dsh-ros2: link:…/dsh-ros2/packages/dsh-ros2`；
  `node_modules` 内 `dsh-ros2` / `dsh-ros2-core` / `dsh-ros2-profile` / `dsh-phoenix` 均为指向本仓库的 symlink。
- **运行态**：`curl http://127.0.0.1:3080/__dsh_health` → `{"token":"…"}`；
  `systemctl --user is-active dsh-web.service` → `active`（自 2026-09-10 21:29，NRestarts=0）；
  `/home/stvli/tmp/dsh-phoenix-state.json` → `generation 14, lifecycleState running`。
- **插件已挂载**：本会话可获得 dsh-ros2 提供的 `arm_*`/`ros2_*`/`robot_*` 工具面，即插件在运行中的 dsh web 内已加载。
- **phoenix 自测**：`cd dsh-phoenix && npm test`（`node --test`）→ **41/41 pass**。
- **本轮行为变更生效方式**：改动位于 symlink 指向的包源码，`lib/` 已重建
  （`packages/common/lib/runner.js` 含 `buildSafetyMonitorCommand`）。dsh 自身 HMR 忽略 `node_modules`，
  故运行中的 dsh web 需**下次重载/重启**才加载新代码；本轮**有意未就地触发** dsh-phoenix 优雅重启
  （其触发条件为 `cordis_run`，且 phoenix 为 idle-aware，本会话为 busy agent，此刻也不会重启）。

### 12.6 结论与下一步建议

- 本轮**落地 2 类注入修复**（zero_pose Python 助手 3 处 + `safety_monitor` 路径引号）+ 1 项依赖升级（vitest 4）+ CI 最小权限；
  新增测试：common +2 vitest、profile +6 Python selftest；本地与 GitHub CI（Node 22/24）全绿，`pnpm audit` 干净。
- 下次维护可选：
  1. **CI Actions 升级**：main CI 有告警 “Node.js 20 is deprecated … actions/checkout@v4 / setup-node@v4 / pnpm/action-setup@v4”，
     建议升到 `@v5`（或按需 pin SHA），属 CI 供应链卫生。
  2. **清理 monolith 遗留**（承 §11.6 #2，仍未做）：根 `src/`、根 `tsconfig.json`/`tsconfig.build.json` 与根 `tests/`
     为拆分前单体遗留；`pnpm -r` 不构建、CI 不运行（仅根 `tests/` 内部 import 根 `src/`）。确认后删除可减死代码与注入面。
  3. **非阻塞产线依赖审计**：可在 CI 增 `pnpm audit --prod --audit-level high`（仅高/严重阻断），或在发布流程加审计步骤。
  4. `pnpm audit` 仍需 `--registry=https://registry.npmjs.org`（默认镜像无审计端点）；维持
     “提交前 typecheck+test+build 全绿 + 行为变更补测试 + push 后 CI 绿”验收线。
  5. 维护文档仍为本地产物（`main` 领先 `origin/main`：round-4 §10 + round-5 §11 + 本轮 §12，未推送），符合“本地维护”要求。

---

## 13. 维护记录（2026-09-13 · 第七轮：open issue #19 → 评估后落地 journey skills + 组合不变量 + 安全复测）

> 本轮结论：**存在 1 个未处理 issue（#19，RFC：need-shaped composition）**，故走 `1 → 2 → 3 → 4 → 5 → 6` 全流程。
> 评估后**接受**切片 1（journey skills）与切片 3（组合不变量测试），**修正**切片 2（L3 缩面）并降级为文档配方；
> 期间发现并修复一个真实内容缺陷（`ros2-diagnostics` 技能被截断、且无条件宣传 moveit 工具）与一处元数据漂移（README 79 tools vs 实际 83）。
> 安全扫描**未发现新漏洞**（依赖审计干净、历史无密钥、无 `eval`/`shell:true`、新增代码无执行面）。

### 13.0 仓库快照（本轮起始/结束）

| 项 | 值 |
| --- | --- |
| 开始 `origin/main` | `2d349af`（PR #18 已合并；工作树干净，本地 `main` 与 `origin/main` 0/0） |
| 新开分支 | `feat/journey-skills`（已推送，PR **#20**，6 个提交） |
| 结束 `origin/main` | `1933acf`（PR #20 合并 commit；CI run `34716276970`，`check (22)` 51s / `check (24)` 46s 均 **pass**；远端分支已删除） |
| 本地 Node / pnpm | Node `v24.16.0` / pnpm `11.22.0`（= root `packageManager`） |
| 包数量 | 9 个（common/core/dsh-ros2/dsh-ros2-state/moveit/profile/safety/sidecar/vision） |
| 工具 / 技能 | **83 工具**（core 61 / vision 7 / safety 5 / moveit 4 / profile 4 / state 2） · **9 技能**（本轮 4 → 9） |
| 工作区测试 | **214** vitest（common 21 · core 110 过 +1 skip · moveit 16 · profile 12 · safety 10 · vision 30 · state 8 · dsh-ros2 6）＋ sidecar selftest 10 场景 ＋ `robot_profile` / `zero_pose` Python 自检 |

### 13.1 Issue 检查（step 1）

`gh issue list --state open` → **1 open：issue #19**（RFC: need-shaped composition，作者 OWNER，2026-09-12 建，无评论、无标签）。
`gh pr list --state open` → **0 open**。历史 issue #1–#3 全 closed；PR #1、#5–#18 全 merged。
→ **存在未处理 issue**，转 step 2（不再跳过 `1 → 5`）。

### 13.2 建议评估（step 2）——逐条判断合理性与必要性

**先核实 RFC 的"measured, not assumed"数据**：83 工具 / 6 bundle / 4 技能 —— **全部准确**（core 61、vision 7、safety 5、moveit 4、profile 4、state 2）。
但 RFC 正文写"9 journeys, 4 carriers"，而其自带表格只有 **8 行** —— **计数口径不一致**（实为 8 条旅程）。

**切片 1（为未覆盖旅程补 skill）—— 合理且必要，接受。**
- 必要性：83 工具 / 4 技能 ≈ 每技能 21 个工具，而 8 条旅程中 **5 条没有任何载体**（bring-up、liveness、TF、motion、safety）；缺口恰好落在本项目已经付过学费的地方
  （`docs/feedback-env-recovery.md` 的环境自愈、`docs/verification-toolchain-efficiency.md` 的 TF 静默失败）。
- 合理性：与本仓库自测结论一致 —— agent 墙钟由**往返次数**而非命令耗时决定；路由由 skill/description 承担（PR #13 的强制 A/B 与 `guidance.spec.ts` 的探测式断言）；
  系统提示本就"按当前已注册工具重建"，skill 目录是同一原则的自然延伸。
- 唯一保留：**"每旅程一 skill"会把载体从 4 增到 9**，若 skill 冗长就会制造它想消除的"选择成本"。故本轮约束：每个 skill **短、L1 入口优先、只写本旅程**，
  且**由提供其所路由工具的 bundle 注册**（只装 core 的安装看不到 moveit/safety 载体）。

**切片 2（scope 证明：diagnostics-only preset + `tools.restrict`）—— 方向合理，表述有误，接受"修正版（文档配方）"。**
- 核实 `@deepseek-ai/dsh-tools` 中 `ctx.tools.restrict(filter)` 的**实际契约**：**要求 scoped（agent）上下文**，上下文级调用直接抛错
  （`tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent`）；`restrict({})` 视为 no-op 被拒；**未知工具名抛错**；
  限制**取交集**、disposer 精确解除；保留的 `run_code` 传输不可点名。
- 因此 RFC 的"挂载 core 再用 restrict 去掉 motion/safety"**混淆了两种机制**：只挂 `dsh-ros2-core` 本身已是 diagnostics-only 面（无需 restrict）；
  而在 core-only 挂载下 `restrict` 会因 `moveit_move` / `robot_safety_state` **不是全局工具**而抛错。
- 必要性：作为能力证明有价值，但 preset 位于 harness 的 preset 目录、不属本 npm 包；且 restrict-only 行为在没有 live agent scope 时**无法由本仓库 CI 验证**。
  → 本轮以 `docs/journey-catalogue.md` §5 记录"安装级 bundle 挂载 vs 作用域级 `tools.restrict`"两种机制与**已核实契约**，**不产出无法验证的产物**。

**切片 3（组合不变量测试）—— 合理且必要，接受。**
- 本仓库已有先例（`guidance.spec.ts` 已断言引导文本中每个反引号工具名都真实存在）；扩展到"旅程目录"成本低、收益高。
- 必要性本轮**当场被验证**：核对计数时发现 README / 聚合包元数据写 **79 tools** 而代码树实际 **83**、core 描述写 59 而实际 61 —— 正是该不变量要防的漂移。

**非目标（不删 primitive、不一 verb 一工具、不再加提示词散文）—— 判断合理，接受。**

**验收主张（每旅程 ≤2 次调用）—— 合理但本轮未复测**：`docs/verification-toolchain-efficiency.md` 的 10 节点系统本轮未运行，记为遗留项（§13.7-3）。

### 13.3 开发管理（git · step 3）

基分支 `origin/main`（`2d349af`，干净）。新开 **`feat/journey-skills`**。提交（Conventional Commits）：

| commit | 类型 | 说明 |
| --- | --- | --- |
| `f0f69f8` | `fix(core)` | 删除 `ros2-diagnostics` 技能被截断的残留片段（`2ebe3a4` 引入） |
| `9adc16d` | `feat(core)` | 新增 `ros2-bringup-recovery` / `ros2-liveness-triage` / `ros2-tf-integrity`（+ 引导目录登记） |
| `6ab30b4` | `feat(moveit)` | 新增 `robot-motion-control` 并注册 |
| `e3b4036` | `feat(safety)` | 新增 `robot-safety-procedure` 并注册 |
| `702be1e` | `docs` | `docs/journey-catalogue.md` + README/README_CN/CHANGELOG + 计数校正 |
| `239c0d0` | `test(dsh-ros2)` | journey 目录 + 组合不变量（4 例） |

> 为让 `fix:` 与 `feat:` 分离，`packages/core/src/skill.ts` 先以"仅修复"的中间态提交（`f0f69f8`，`tsc --noEmit` 通过），再恢复完整态提交（`9adc16d`）。

**发现并修复的真实缺陷（`fix(core)`）**：`2ebe3a4`（环境自愈）在插入章节时删掉了 `## MoveIt2 motions` 小节头与首句，却留下残句
（`s \`srdf\` for a direct path), returns …`）。两个后果：(1) 技能内容以半句话开头；(2) 残句**无条件**介绍 `moveit_discover` / `moveit_move` ——
技能内容是**静态字符串**（不同于按已注册工具重建的系统提示），因此**只装 core 的安装会被引导去移动它根本没有挂载的机器人**，
恰好违反本仓库"仅宣传已挂载能力族"的原则。修复后运动引导改由 `dsh-ros2-moveit` 的载体承担。

**PR 与合并**：PR **#20** `feat: journey skills + composition invariant (RFC #19 slices 1 & 3)`（base `main`）；
PR CI（run `34716276970`，Node 22/24 矩阵）**全绿**后按仓库惯例以 **merge commit** 合并为 `1933acf`，远端分支已删除，本地 `main` 已 `reset --hard origin/main` 同步。

### 13.4 本地验收（全绿）

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
CI=true pnpm run typecheck   # 10 项目 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run test        # 214 vitest 全通过（含 1 pty-skip）+ sidecar 10 场景 + Python 自检；exit 0
CI=true pnpm run build       # 9 包 tsc 全部 Done（exit 0）
pnpm audit --registry=https://registry.npmjs.org   # No known vulnerabilities found（exit 0）
```

**不变量测试的反向验证（确认有牙齿）**：把目录中 `bringup.entry` 改名后跑测试 → 失败并给出可定位信息（随后已复原）：

```text
journey "bringup" entry tool: expected [ 'ros2_graph', …(82) ] to include 'ros2_env_check_RENAMED'
```

**已构建产物（`lib/`）的独立复核**：用 Cordis `Context` + 假服务（tools/skills/approval/jobs）挂载 6 个 bundle 的 `lib/index.js`，实测注册 **83 tools**，
技能 **9 个**（`robot-motion-control, robot-registration, robot-retrieval, robot-safety-procedure, robot-state-vision-analysis, ros2-bringup-recovery, ros2-diagnostics, ros2-liveness-triage, ros2-tf-integrity`）。
即 83 / 9 两个数字来自**运行期注册路径**，而非源码字符串解析 —— 与目录测试互相独立地印证。

### 13.5 dsh-phoenix 持续更新 / 测试链路（step 4）

- **活动 profile**：`~/.dsh/profiles/web/package.json` 含 `dsh-ros2: link:…/dsh-ros2/packages/dsh-ros2` 与 `dsh-phoenix: link:…/dsh-phoenix`；
  `node_modules` 内 `dsh-ros2` / `dsh-ros2-core` / `dsh-ros2-common` / `dsh-ros2-moveit` / `dsh-ros2-profile` / `dsh-ros2-safety` / `dsh-ros2-vision` 均为指向本仓库的 symlink。
- **运行态**：`curl http://127.0.0.1:3080/__dsh_health` → `{"token":"1789235312154-ilrezerjuxj"}`；
  `systemctl --user is-active dsh-web.service` → `active`（自 2026-09-13 01:48:31，`NRestarts=0`）；
  `/home/stvli/tmp/dsh-phoenix-state.json` → `generation 15, lifecycleState running, pendingResume false`。
- **phoenix 自测**：`cd dsh-phoenix && npm test`（`node --test`）→ **41/41 pass**。
- **闭环已被真实执行（journal 证据）**：`journalctl --user -u dsh-web` 可见上一代的完整流程 ——
  `[dsh-phoenix] agent idle; executing deferred restart (gen 15)` → `scheduling restart (plugin-change, gen 15): systemd-run … stop; sleep 8; start`
  → `restart cmd exit=0` → `[dsh-phoenix] loaded (graceful restart + client reconnect + lifecycle)`。
- **本轮行为变更的生效方式**：改动位于 symlink 指向的包源码，`lib/` 已重建（`packages/core/lib/skill.js`、`packages/moveit/lib/skill.js`、`packages/safety/lib/skill.js` 均含新载体）。
  dsh 自身的 HMR 忽略 `node_modules`，故运行中的 dsh web 需**重载/重启**才加载新代码；本轮**有意未就地触发**重启（理由见 §13.7-4）。

### 13.6 安全扫描（step 5）——复测 + 本轮新增面复核，未发现新漏洞

| 检查 | 结果 |
| --- | --- |
| `pnpm audit --registry=https://registry.npmjs.org` | **No known vulnerabilities found**（exit 0） |
| 硬编码密钥（`AKIA…` / `sk-…` / `ghp_…` / `BEGIN … PRIVATE KEY` / `AIza…` / `xox…`） | 源码与 **git 全历史**（`git log -p --all`）均无 |
| `eval` / `new Function` / `vm` / `shell:true` | 无 |
| TS 命令执行面 | `execFile` / `spawn` 均**数组参数**；shell 字符串仅出现在经 `shq()` 的 `buildSafetyMonitorCommand`，或经校验的输入（`KILL_SIGNAL_RE`、`isSafeProfileName`）；`gui.ts` 的 `screenshotCommand` 来自运维配置且 `{output}` 经 `shq()` |
| Python 命令面 | `subprocess.run` / `Popen` **全部 argv 列表**，无 `shell=True`、无 `bash -lc` |
| 历史加固回归 | `KILL_SIGNAL_RE`（process_cleanup signal）、`isSafeProfileName`（档案名越界）、`buildSafetyMonitorCommand`（profile 路径引号）、`gui` 的 `{output}` 引号 —— **均在位** |
| **本轮新增面**（`git diff main...HEAD`） | 仅 5 个新技能的 markdown 内容、`ctx.skills.register(...)` 接线、`guidance.ts` 的 SKILLS 数据数组、测试、文档与元数据 —— **不含任何命令/求值/IO 面**（新文件对 `spawn`/`exec`/`subprocess`/`shell` 的唯一命中，是 `core/src/skill.ts` 中 `install/setup.bash`、`shell prefix` 等**散文**） |

> 结论：本轮**未发现新漏洞、无需修复**；报告为"复测通过 + 新增面无风险"。历史上已被利用/修复的注入面（round-5/6/7）未被本轮改动触碰。

### 13.7 结论与下一步建议

- 本轮首次进入"有 open issue"分支：评估后**接受 RFC 切片 1 + 3**、**修正并文档化切片 2**；落地 5 个 journey skill（4 → 9 载体，**8 条旅程全部有载体**）、
  4 例组合不变量测试、1 个真实内容缺陷修复；本地 typecheck / test / build 全绿，`pnpm audit` 干净，phoenix 41/41 且闭环有 journal 证据。
- 下次维护可选：
  1. **不变量已随 `pnpm -r test` 进入 CI**（`journeys.spec.ts` 属 `packages/dsh-ros2` 测试）。可按需把"计数一致"断言扩展到 `PUBLISH.md` 与 `docs/*.md`。
  2. **切片 2 的"真产物"**：在 `${DSH_HOME}/.agent-presets/<id>/` 下写一个 diagnostics-only preset，并在 live agent scope 中实测 `ctx.tools.restrict` 的缩面效果（本仓库 CI 无法验证，故本轮只给配方）。
  3. **RFC 的 ≤2 次调用验收**：重启 `docs/verification-toolchain-efficiency.md` 的 10 节点系统，按旅程记录调用数与墙钟（本轮遗留，系统未运行）。
  4. **把本轮代码加载进运行中的 dsh**：需要一次 phoenix 优雅重启（`cordis_run` 触发 → 忙时 `deferring (agent busy)` → 空闲时 `executing deferred restart`）。
     本轮为不中断维护流程而**有意未触发**；可在空闲时触发，journal 应按上述顺序出现两行。
  5. 维持验收线："提交前 typecheck + test + build 全绿 + 行为变更补测试 + push 后 CI 绿"；`pnpm audit` 需带 `--registry=https://registry.npmjs.org`（默认镜像无审计端点）。

---

## 14. 维护记录（2026-09-14 · 第八轮：3 个 open issue → 全部落地/收敛 + #19 验收测量 + 安全复测）

> 本轮结论：**存在 3 个未处理 issue（#21 / #22 / #19）**，走 `1 → 2 → 3 → 4 → 5 → 6` 全流程。
> 评估后：#21 **确认为真缺陷并修复**（现场在真机 Jazzy 上复现）；#22 **接受并落地**（保留 open，边界如实声明）；
> #19 的**遗留验收测量：本轮完成**（固化测量台 + 6/6 可测旅程 ≤2 次调用），测量过程本身又**发现并修复一个真缺陷**。
> 安全扫描**未发现新漏洞**（依赖审计干净、历史无密钥、无 `eval`/`shell:true`、新增面为纯字符串处理与只读 `readFileSync`）。

### 14.0 仓库快照（本轮起始/结束）

| 项 | 值 |
| --- | --- |
| 开始 `origin/main` | `34935b1`（第七轮日志；工作树干净，本地 `main` 与 `origin/main` 0/0） |
| 新开分支（3 条，均已合并并删除远端分支） | `fix/profile-tf-root`、`feat/bundle-version-drift`、`fix/tool-stdout-noise` |
| 结束 `origin/main` | `fcde2a6`（PR **#25** 合并 commit）+ 本维护日志提交 |
| PR | **#23** `496255b`、**#24** `fbdc685`、**#25** `fcde2a6`（均 merge commit；CI run `34846921337` / `34846941355` / `34847994417`，Node 22/24 矩阵**全 success**） |
| 本地 Node / pnpm | Node `v24.16.0` / pnpm `11.22.0`（= root `packageManager`） |
| 包数量 | 9 个（common/core/dsh-ros2/dsh-ros2-state/moveit/profile/safety/sidecar/vision） |
| 工具 / 技能 | **83 工具 / 9 技能**（本轮不增删工具；新增的是 `ros2_env_check` 的返回字段与 1 个组合不变量测试） |
| 工作区测试 | **240 vitest 通过 + 1 skip**（214 → 240；核心 110 → 113，common 21 → 35，profile 12 → 14，dsh-ros2 6 → 14）＋ sidecar 10 场景 ＋ `robot_profile` / `zero_pose` Python 自检 |

### 14.1 Issue 检查（step 1）

```
gh issue list --state open  →  3 open
  22  dx: surface loaded vs installed bundle versions …   (2026-09-14, OWNER)
  21  fix(profile): find_tf_root crashes on Jazzy and silently writes an empty tf_root  (2026-09-14, OWNER)
  19  RFC: need-shaped composition …                      (2026-09-12, OWNER, 1 comment)
gh pr list --state open     →  0 open
```
→ **存在未处理 issue**，转 step 2（不再跳过 `1 → 5`）。

### 14.2 建议评估（step 2）——逐条判断合理性与必要性

#### #21 `find_tf_root()` 在 Jazzy 上崩溃 / 静默写空 —— **合理且必要，接受，最高优先**

- **先复现，再判断**（不采信描述）：把 issue 原文的 Jazzy repr 样本喂给旧实现 →
  `IndexError: list index out of range`，**与 issue 描述一致**；空/失败输入 → 静默 `return ""`。
- **真机复核**（ROS2 Jazzy + `tf2_ros static_transform_publisher`）：
  - `ros2 topic echo /tf_static --once --field transforms` → 单行 Python repr（`=` 而非 `:`），与 issue 一致；
  - `ros2 topic echo /tf_static --once`（不带 `--field`）→ 可解析 YAML（`transforms:` / `child_frame_id: chest`）；
  - 旧实现喂**同一份 live 输入** → `IndexError`；`robot_profile.py register` **当场 traceback 退出**。
- **必要性**：这与 **#14 完全同源**——第七轮只修了 TS 侧 `ros2_tf_list` / `ros2_tf_echo`，
  **漏了 profile 脚本**；影响面是 `robot_register` 直接失败，或档案 `tf_root` 为空导致
  离屏渲染 Fixed Frame 失效（`robot-state-vision-analysis` 记载的"所有 link 堆在原点"症状）。
- **顺带修正的语义错误**：旧实现取"第一条边的 child"，那是**叶子**不是根；issue 建议的
  "只作父、不作子"才是正确判据。本轮一并改正（属同一处代码、同一 purpose）。

#### #22 让"进程陈旧"可见 —— **方向合理、必要性中等偏上，接受；但边界必须如实说明**

- **事实核实**：issue 描述的场景真实存在——本轮**现场遇到**：运行中的 dsh 于 `20:46:34` 启动，
  而磁盘代码在 `20:52` 之后更新；该进程的 `ros2_env_check` 返回**没有 `bundles` 段**，
  且第七轮新工具 `ros2_topology` 在旧进程里表现为 `unknown tool`。
- **实现路径的关键约束（本轮实测，决定了设计）**：bundle **无法**通过解析兄弟包得到各自的 loaded 版本 ——
  Node 会把符号链接入口解析到 **realpath**：

  | 解析基准 | core | profile | moveit | safety | vision |
  | --- | --- | --- | --- | --- | --- |
  | 符号链接路径（`~/.dsh/profiles/web/node_modules/dsh-ros2-core/…`） | ✅ | ✅ | ✅ | ✅ | ✅ |
  | realpath（`…/dsh-ros2/packages/core/…`，即 `import.meta.url`） | ✅ | ❌ MODULE_NOT_FOUND | ❌ | ❌ | ❌ |

  → 因此**由每个 bundle 在挂载时登记自己**（登记表放在所有 bundle 都已依赖的 `dsh-ros2-common`），
  而不是让 core 去"发现"兄弟包。这是本轮设计取舍的核心证据。
- **保留意见（故 issue 保持 open）**：
  1. **自检本身也要重启一次才生效**——旧进程里根本不存在这段代码。这是**固有限制**，不是实现缺陷，
     必须在文档与 issue 里讲清楚（否则会变成"为什么我升级了还是没提示"的假承诺）。
  2. issue 里"会话技能目录与实际注册数不一致"那一半，本轮只提供**信号**（loaded 版本），并未做目录对账。
  3. issue 建议的"启动时一行汇总日志"：bundle 是**顺序挂载**的，任何时刻打汇总都必然是**部分列表**，
     故改为**每个 bundle 一行**（`dsh-ros2: loaded bundle dsh-ros2-core@0.1.5`），更准确也更可 grep。

#### #19 RFC 验收（≤2 次调用 / 缩面）—— **接受并完成"可测"部分，缩面部分维持"文档配方"**

- 第七轮已落地切片 1（5 个 journey skill，4 → 9 载体）与切片 3（组合不变量），遗留项是
  **"每旅程 ≤2 次调用"的验收测量**。
- **本轮把它做完**（详见 §14.4）：先补齐**可复现**的测量台（此前那个 10 节点系统"手工搭一次就没了"），
  再逐旅程测量：**6/6 可测旅程 ≤2 次调用**。**三条例程（state / vision / motion）在本装置上不可测**，
  明确记为 `not_measurable`，**不计入通过**——这是本轮对"通过"口径的自我约束。
- **缩面（切片 2）不改口径**：preset 位于 harness 的 preset 目录、不属本 npm 包，仓库 CI 无法验证；
  维持第七轮的"文档配方"结论，不产出无法验证的产物。

**非目标（不删 primitive、不一 verb 一工具、不再加提示词散文）—— 判断合理，继续遵守。**

### 14.3 开发管理（git · step 3）

按 issue 类型新开 3 条分支（`fix/…` 修缺陷、`feat/…` 加功能），全部按 Conventional Commits 提交：

| commit | 分支 | 类型 | 说明 |
| --- | --- | --- | --- |
| `726deef` | `fix/profile-tf-root` | `fix(profile)` | TF 根帧解析与输出格式解耦；不再崩溃、不再静默；语义改为"只作父"；13 项离线自检 |
| `47d54ca` | `feat/bundle-version-drift` | `feat(common)` | loaded-bundle 登记表 + 每个 bundle 自登记 + 组合不变量 |
| `b7593e4` | `feat/bundle-version-drift` | `feat(core)` | `ros2_env_check` 返回 `bundles{loaded,drift,stale,unresolved}` + 陈旧告警 |
| `12a7c6b` | `feat/bundle-version-drift` | `docs` | `docs/versioning.md` 新增"已加载版本 vs 磁盘版本"一节 + CHANGELOG |
| `1852577` | `fix/tool-stdout-noise` | `fix(common)` | `parseJsonOrRaw` 容忍中间件 stdout 噪声（括号配对定位 JSON 文档） |
| `d81a274` | `fix/tool-stdout-noise` | `test(verification)` | `scripts/verification/` 可复现测量台（`system.sh` + `measure.mjs` + 3 个 lab 节点） |
| `61482f7` | `fix/tool-stdout-noise` | `docs` | `docs/journey-catalogue.md` §6 记录 ≤2 次调用测量结果与边界 |
| `cb59fd4` | `fix/tool-stdout-noise` | `fix(verification)` | 测量台 teardown 收敛到自己的进程组；启动等待图收敛 |

**PR 与合并**：PR **#23 / #24 / #25**（base `main`）。#24 与 #25 在 `#23` 合并后**rebase 到最新 `main`**
（`CHANGELOG.md` 出现冲突，按 **union 保留双方条目**解决）；三条 PR 的 CI（Node 22/24 矩阵）**全 success**
后按仓库惯例以 **merge commit** 合并，三个远端分支已删除，本地 `main` 已 `reset --hard origin/main`。

**"测量中发现缺陷"的分支归属**：`parseJsonOrRaw` 的缺陷是**做 #19 验收测量时**现场发现的。
它不属于 #21/#22，故单独开 `fix/tool-stdout-noise`；测量台与测量结果留在同一条分支
（fix 在前、使能/文档在后），避免把无关的 fix 混进 `feat/` 分支。

### 14.4 本地验收 + issue #19 的验收测量

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
CI=true pnpm run typecheck   # 9 项目 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run build       # 9 包 tsc 全部 Done（exit 0）
CI=true pnpm -r test         # 240 vitest 通过 + 1 skip + sidecar 10 场景 + 2 个 Python 自检；exit 0
```

**#21 的真机端到端复核**（ROS2 Jazzy + `tf2_ros static_transform_publisher`）：

| 探针 | 结果 |
| --- | --- |
| 新 `find_tf_root(urdf)`（广播者在线的同一份 live 输入） | `{"root": "base_link", "source": "tf_static"}` |
| 同上，停掉广播者 | `{"root": "base_link", "source": "urdf"}` |
| 无广播者且无 URDF | `{"root": "", "source": "unresolved"}` |
| 旧实现喂同一份 live 输入 | `IndexError: list index out of range` |
| CLI `register`（回退路径） | `tf_root='base_link'`、`tf_root_source='urdf'` + 显式 warning |

**#22 的独立复核**（用 Cordis `Context` + 假服务挂载 **7 个 bundle 的已构建 `lib/`**）：

```text
registry : ["dsh-ros2@0.1.0","dsh-ros2-core@0.1.5","dsh-ros2-moveit@0.1.0","dsh-ros2-profile@0.1.0",
            "dsh-ros2-safety@0.1.0","dsh-ros2-state@0.1.0","dsh-ros2-vision@0.1.3"]
startup  : 每 bundle 一行 "dsh-ros2: loaded bundle <name>@<version>"
surface  : 83 tools / 9 skills（与不变量一致）
drift    : loaded 0.1.5 / disk 0.1.6 →  stale: true + "…请重启 harness 后重试。"
```
**反向验证**：把 `dsh-ros2-vision` 的登记名改错 → 不变量测试失败并给出可定位信息
（`vision must register dsh-ros2-vision: expected '…' to contain …`），随后已复原。

**#19 验收测量**（`scripts/verification/`，2026-09-14 Jazzy；10 节点 / 10 话题 / 86 服务 / 3 动作 / 2 帧）：

| 旅程 | L1 入口 | 工具调用 | 墙钟 | 判定 |
| --- | --- | --- | --- | --- |
| topology | `ros2_topology` | **1** | 2.1 s | 10 节点 / 10 话题 / 86 服务 / 3 动作 |
| liveness | `ros2_topology {rates}` → `ros2_topic_sample` | **2** | 10.4 s | 每话题实时速率 + `/tf_static`（latch、0 Hz）在第 2 次调用定性 |
| TF integrity | `ros2_topology {tf}` | **1** | 6.2 s | 2 帧（1 static / 1 dynamic，含位姿） |
| bring-up | `ros2_env_check` | **1** | 1.1 s | setup + 440 可见包 |
| robot identity | `robot_load` | **1** | 0.3 s | 档案（link / tf_root / 相机 / 组） |
| safety | `robot_safety_state` | **1** | 0.6 s | 锁存状态（本机 `monitor_running: false`） |

**6/6 可测旅程在 ≤2 次调用内作答**；对照：同一份拓扑盘点在效率研究中需要 **17 次裸 `ros2` CLI 调用**。
`measure.mjs` 在任一可测旅程破预算时**退出码非 0**，即验收结论可自动化。

**不可测的三条例程**（如实声明，不计入通过）：`state`（需 sidecar 数据面）、`vision`（需相机 + VLM 流水线）、
`motion`（需 MoveIt2 + 机器人描述）。另：bring-up 一行只覆盖**健康系统**，其真实故障路径
（陈旧 `rosSetup` → 会话内 `ros2_workspace use`）仍只有 `docs/feedback-env-recovery.md` 记载。

**测量台自身的两个修正**（都是"测量工具必须能被信任"的一部分）：
1. 初版 `measure.mjs` 用**最后一次调用**的结果判定整条旅程，导致 liveness 被误判为 FAIL（实际两次调用已作答）→ 改为**整条旅程可见其全部调用结果**。
2. 初版 teardown 用 `pkill -f "demo_nodes_cpp"` 这类**裸节点名**匹配命令行，可能误杀开发者自己的进程 →
   改为 `setsid` + 负 PID 杀**自己的进程组**；启动也从固定 `sleep 8` 改为**等待图收敛到 10 节点**
   （UDP 下发现不是瞬时的，实测曾把 10 节点误报成 3 节点）。

**测量过程中发现并修复的真缺陷（`fix(common)`）**：FastDDS 在 `/dev/shm` 不可用时把
shared-memory 传输错误写到 **stdout**（不是 stderr）。此前 `parseJsonOrRaw()` 把整个缓冲区当作
一个 JSON 文档解析，必然失败并**静默降级为 `{ raw: … }`** —— 在**健康的 10 节点系统**上
`ros2_topology` 报 **`nodes: 0`**。修复用**字符串感知的括号配对**（候选数有上限）定位内嵌文档；
噪声本身含方括号（`[RTPS_TRANSPORT_SHM Error]`）也算不出结果，因此候选必须"找到匹配闭括号**且**能解析"才成立。
新增 4 例回归测试（含"噪声在前"与"噪声在后"两种形状）。

### 14.5 dsh-phoenix 持续更新 / 测试链路（step 4）

- **活动 profile**：`~/.dsh/profiles/web/package.json` 含 `dsh-ros2: link:…/dsh-ros2/packages/dsh-ros2`
  与 `dsh-phoenix: link:…/dsh-phoenix`；`node_modules` 内 **7 个** `dsh-ros2*` 条目
  （core/common/profile/moveit/safety/vision + 聚合包）均为指向本仓库的 symlink。
- **运行态**：`systemctl --user is-active dsh-web.service` → `active`；`NRestarts=0`；
  `curl http://127.0.0.1:3080/__dsh_health` → `{"token":"1789389995735-fdddikwqy7t"}`；
  `/home/stvli/tmp/dsh-phoenix-state.json` → `generation 16, lifecycleState running, pendingResume false`。
- **phoenix 自测**：`cd dsh-phoenix && npm test`（`node --test`）→ **41/41 pass**（exit 0）。
- **本轮行为变更的生效方式**：改动位于 symlink 指向的包源码，`lib/` 已重建（`packages/core/lib/tools.js`
  含 `bundleDriftReport`、`packages/common/lib/parse.js` 含括号配对、`packages/profile/lib/skill.js` 含
  `tf_root_source`）。dsh 自身的 HMR 忽略 `node_modules`，运行中的 dsh web 需**重启**才加载新代码；
  本轮**有意未就地触发重启**（理由见 §14.7-1）。
- **顺带取得的"活体证据"**：运行中的 dsh 于 `20:46:34` 启动，**早于**本轮构建（`20:52+`），
  因此它的 `ros2_env_check` **没有 `bundles` 段** —— 这正是 issue #22 描述的"陈旧进程"的**现场实例**，
  同时也印证了 §14.2 对 #22 的边界声明（自检需重启一次才生效）。

### 14.6 安全扫描（step 5）——复测 + 本轮新增面复核，未发现新漏洞

| 检查 | 结果 |
| --- | --- |
| `pnpm audit --registry=https://registry.npmjs.org` | **No known vulnerabilities found**（exit 0） |
| 硬编码密钥（`AKIA…` / `sk-…` / `ghp_…` / `BEGIN … PRIVATE KEY` / `AIza…` / `xox…`） | 源码（`packages`/`scripts`/`docs`）与 **git 全历史**（`git log -p --all`）均无 |
| `eval` / `new Function` / `node:vm` / `shell:true` | 无 |
| TS 命令执行面 | `execFile` / `spawn` 均**数组参数**；shell 字符串仅出现在 `runCommand` 的 `bash -lc`(runner.ts:196) 且命令由**已校验输入**拼装（`shq()`、`KILL_SIGNAL_RE`、`isSafeProfileName`、`buildRos2InstallDownloadCommand`、`gui` 的 `{output}` 经 `shq()`） |
| Python 命令面 | `subprocess.run` / `Popen` **全部 argv 列表**，无 `shell=True`、无 `os.system` |
| 历史加固回归 | `KILL_SIGNAL_RE`、`isSafeProfileName`、`buildSafetyMonitorCommand`、`_PROFILE_NAME_RE`（`robot_profile.py` 档案名边界）—— **均在位** |
| **本轮新增面** | ① `parseJsonOrRaw`：**纯字符串处理**（索引扫描 + 括号配对，候选数有上限，无正则回溯面）；② `bundles.ts`：`readFileSync` 读取的路径**全部来自 `import.meta.url`**（可信常量），无用户输入进入路径；③ `robot_profile.py`：仍是 **argv 列表**调用 `ros2`，新增的只是对输出的**正则解析**；④ `ros2_env_check`：只读登记表；⑤ `scripts/verification/*`：**不随任何 npm 包发布**（root `scripts/` 不在任何 `files` 中，root 包 `private`） |

**新增面的一项卫生加固（本轮自查发现）**：测量台初版的 teardown 用 `pkill -f "demo_nodes_cpp"` /
`"turtlesim_node"` 等**裸节点名**匹配命令行，可能误杀开发者正在运行的同名进程。已改为
`setsid` + `kill -- -PID`（**只杀自己的进程组**），仅保留一条锚定 `$HERE/lab_` 的兜底。
这不构成漏洞（脚本不发布、需人工执行），但属于"工具不应有超出必要范围的杀伤力"。

> 结论：本轮**未发现新漏洞、无需安全修复**；报告为"复测通过 + 新增面无风险 + 1 项工具卫生加固"。

### 14.7 结论与下一步建议

- 本轮把 3 个 open issue 全部推进：**#21 修复并真机复现/复核**（可 close）、
  **#22 落地但按边界保留 open**、**#19 完成遗留的验收测量**（可 close 或按维护者口径保留）。
  8 个提交 / 3 条 PR / 3 次 CI 全绿；240 vitest + 自检全绿，`pnpm audit` 干净，phoenix 41/41。
- 下次维护可选：
  1. **把本轮代码加载进运行中的 dsh**：需要一次 phoenix 优雅重启。本轮**仍有意未触发**——
     与第七轮同一理由：重启会中断维护流程本身。重启后应能看到 §14.5 所述的两行 journal 顺序，
     并且 `ros2_env_check` 开始返回 `bundles` 段（届时 #22 的自检才真正"上线"）。
  2. **`/tf_static` 的 latch 采样**：本轮实测 `find_tf_root()`（默认 volatile QoS）在广播者
     "只 latch 一次"时采样不到边，因而走了 URDF 回退（档案 `tf_root=base_link`、`source=urdf`，
     结果正确但来源不是 TF）。可加 `--qos-durability transient_local` 让 `tf_static` 成为首选来源，
     使 "TF 根 ≠ URDF 根"（如带虚拟 `world` 帧）的场景也正确。属 #21 的自然延续，本轮未做以控制范围。
  3. **#22 的两项遗留**：① issue 里"会话技能目录 vs 实际注册数"的**对账**（本轮只给信号）；
     ② 若希望"启动即报漂移"，可在挂载时**同时**读磁盘版本并比较（当前只在 `ros2_env_check` 调用时比较）。
  4. **运行中 dsh 的 ROS 环境探针异常**：本会话（旧进程）的 `ros2_env_check` 报
     "未检测到可见 ROS2 包"，而**同一条探针**在登录 shell 里 **0.8 s** 返回
     `__PKGS=440 / __NODES=10`。怀疑与 systemd 服务的执行环境或 20 s 超时有关，
     应在重启后复测；若复现，则是 `ros2-bringup-recovery` 旅程的真实反例。
  5. **#19 剩余口径**：切片 2（L3 缩面）仍为文档配方；若要变成"可验证产物"，
     需在 `${DSH_HOME}/.agent-presets/<id>/` 下写 diagnostics-only preset 并在 live agent scope 实测。
  6. 维持验收线："提交前 typecheck + test + build 全绿 + 行为变更补测试 + push 后 CI 绿"；
     `pnpm audit` 需带 `--registry=https://registry.npmjs.org`；**测量类结论须附可复现命令**
     （本轮已把 #19 的测量台固化进 `scripts/verification/`，后续验收不应再"手工搭一次就没了"）。

---

## 15. 维护记录（2026-09-21 · 第九轮：open issue #22 → 补齐其遗留项 + 发现并修复"探针报告 ≠ 探针执行" + 安全复测）

> 本轮结论：**1 个 open issue（#22）**。其第八轮列出的"仍未完成"三项中，**唯一真正未实现的第 2 项
> （会话技能目录对账）本轮补齐**，第 1 项确认为固有限制、第 3 项已在在途分支按边界落地。
> 验收过程中**发现并修复一个真缺陷**：`ros2_env_check` **报告的 setup 与实际执行命令所用的 setup 不一致**
> ——这正是第八轮 §14.7 第 4 条存疑项的**真因**（当时怀疑 systemd 环境或超时，均不是）。
> 本轮 3 个提交（`fix` / `feat` / `docs`）**全部推送**；**因 `gh` token 失效未能自动开 PR**（见 15.3）。

### 15.0 仓库快照（本轮起始/结束）

| 项 | 起始 | 结束 |
| --- | --- | --- |
| 当前分支 | `feat/bundle-surface-reconciliation`（工作树干净，与 `origin` 一致；**不在 main**） | 同分支 **+3 提交**，已推送 |
| `main` | `f161096`（第八轮 merge），= `origin/main` | **未变**（本轮未触碰 main） |
| 该分支未合并提交 | 6 个（2026-09-16） | 9 个 |
| open issue / open PR | **1 / 0** | **1 / 0**（#22 保持 open，见 15.2 结论） |
| 包数量 / 本地环境 | 9 包 · Node v24.16.0 · pnpm 11.22.0 · vitest 4.1.11 | 同 |
| 读取 issue 的方式 | 公开 REST API（`gh` token 失效，见 15.3） | 同 |

> **为什么起点不在 `main`**：仓库停在一条**在途 `feat/` 分支**上——它带有 6 个 2026-09-16 的提交
> （逐 bundle 能力面登记、安装清单挂载对账、启动自检、探针自述），质量完好、语义单一、已推送，
> 但**既未开 PR、也未记入本维护文档**，明显是"上一轮被中断的同一议题工作"。
> 按流程"新开 branch"的字面要求本可另起 `feat/...`，但那会把同一议题劈成两条互不相干的提交链，
> 也会让那 6 个提交永远没有维护记录；故**续用该分支**，改由**提交类型**（`fix:` / `feat:` / `docs:`）
> 承载语义。该判断记录在此以便复核。

### 15.1 Issue 检查（step 1）

公开 REST API `GET /repos/StvLi/dsh-ros2/issues?state=open` → **1 个 open issue**：

| # | 标题 | 状态 | 评论数 |
| --- | --- | --- | --- |
| 22 | `dx: surface loaded vs installed bundle versions so a stale running process is visible` | **OPEN** | 1 |

- **0 个 open PR**；issue/PR **#1–#26 除 #22 外全部 closed**。
- #22 的那条评论是第八轮的逐条结论，并**自己明确列出了"仍未完成"的 3 项**——本轮即针对这 3 项。
- 读取方式：`gh auth status` 显示**两个账号 token 均 invalid**，故改用公开 REST API（只读、无副作用、
  速率受限 60 次/时，本轮用量很小）。这不影响 issue 判断，但**影响开 PR**（见 15.3）。

### 15.2 建议评估（step 2）——逐条判断合理性与必要性

**①「自检本身也要重启一次才生效」——合理，但属固有限制，不修。**

旧进程里**根本不存在**这段代码，任何"自检"都无法在自身启动之前生效。第八轮已把它写成边界声明；
本轮维持该口径，并在 15.4 用运行中的进程**实测复现**了这条边界的正面价值：它恰好就是让
"进程代码陈旧"可见的那条信号（新字段缺席 = 该进程早于功能上线）。

**②「会话技能目录 vs 实际注册数的对账」——合理且必要，本轮补齐（唯一真正未实现的一项）。**

- 第八轮的实现只提供**信号**（每个 bundle 注册了哪些技能名），把比对留给读者，理由措辞是
  "leaves the comparison to the reader"。但**公共契约里本来就有对账入口**：
  `ctx.skills.snapshot({ scope: agent })` 返回"该 agent 视角下能看到的目录"。
- 本轮**在两个版本上确认了该 API 存在**：运行中的 harness（Inspect Provider 的 `skills` 契约，
  含 `list` / `snapshot` / `get`，`scope` 取 agent）与 `dsh-ros2-core` 的 peer 固定版
  `@deepseek-ai/dsh-skill@0.1.0-rc.6`（`lib/types/index.d.ts` 第 268 / 276 行同时有 `list()` 与 `snapshot()`）。
  **故"读不到目录"的前提不成立**，应当做真对账。
- **必要性**：这正是 issue 原文描述的症状（"会话技能目录只列出 9 个载体中的 6 个"），而且是
  **从任何单侧都看不出来**的——只看 bundle 侧（注册了 9 个）或只看会话侧（列了 6 个）都无法断言谁不对，
  只有逐名比对才能把"注册了但会话看不到"变成一句可读的结论。

**③「启动即报漂移」——部分合理，在途分支已按边界落地为"启动即报挂载/能力面"，而非"启动即报漂移"。**

漂移（磁盘版本 ≠ 加载版本）只可能在**磁盘变动之后**才可观测，t=0 的探针永远看不到它；
启动时**能**看到的只是"哪些 bundle 挂上了、各自登记了什么"。在途分支的
`scheduleBundleStartupReport()` 正是这么做的：轮询到挂载集合**稳定**后打一行汇总，并对
`missing` / `drift` / `unresolved` / `unreported` 分别告警；且**没有**在挂载中途去读磁盘版本做比对
（bundle 是顺序挂载的，任何瞬时快照必然是半张表——第七轮已因这个理由否决过"一行汇总"的写法）。
**接受该实现与其边界**。

结论：**#22 的三条建议全部合理**；② 本轮补齐，① 为固有限制，③ 已按边界落地。
因①这条固有限制不会因代码消失，**#22 本轮保持 open**（与第八轮一致），但**"未实现项"已归零**——
维护者若认可"固有限制已如实声明"，可自行 close。

### 15.3 开发管理（git · step 3）

- 分支：**续用** `feat/bundle-surface-reconciliation`（理由见 15.0）。
- 本轮新增 3 个提交（Conventional Commits）：

| commit | 类型 | 说明 |
| --- | --- | --- |
| `de100b5` | `fix(core)` | 探针改为在**它自己报告的那个** setup 下执行；源码不再自带 prefix（避免二次 source）；`ros2_workspace show` 同源修正；补回归测试；并修掉两个测试泄漏的全局 session override |
| `a042e83` | `feat(core)` | `ros2_env_check` 对账会话技能目录（`data.skillCatalogue`），"不可用"一律如实报不可用；+9 例测试（5 例工具级 + 4 例适配器级） |
| `d64d1de` | `docs` | CHANGELOG（Added/Fixed/Changed）＋ README / README_CN 的用例数校正（195 → 277 例；`robot_profile` 自检 17 → 实测 29 项） |

- **提交类型的诚实性**：`fix` 与 `feat` 改动落在同 3 个文件里（`core/src/index.ts`、`core/src/tools.ts`、
  `core/tests/tools.spec.ts`），直接 `git add -p` 无法干净切分。故 `de100b5` 的状态是**从最终树精确重建**的：
  先备份最终版 → 把那 3 个文件回退到 `bad1d52` → **只重放该修复的 7 处改动** → 提交 → 再还原最终版。
  因此 `de100b5` **单独检出也能 typecheck/test 全绿**（119 过 + 1 skip；`feat` 未混入），
  不会出现"看着是 fix、其实依赖 feat"的历史。
- 推送：`bad1d52..d64d1de  feat/bundle-surface-reconciliation` → `origin` 成功。
- **未开 PR（需人工或补 token）**：`gh auth status` 两个账号 token 均 invalid，无鉴权无法建 PR。
  分支已推送，可直接开：
  `https://github.com/StvLi/dsh-ros2/compare/main...feat/bundle-surface-reconciliation`

### 15.4 本地验收（全绿）＋ 本轮缺陷的可复现证明

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
CI=true pnpm run typecheck   # 9 项目 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run test        # 277 vitest（276 过 + 1 pty-skip）+ sidecar 10 场景 + zero_pose 6 项 + robot_profile 29 项
CI=true pnpm run build       # 9 包 tsc 全部 Done（exit 0）
```

**用例分布（实测）**：common 45 + core 129（128 过 + 1 skip）+ moveit 16 + profile 14 + safety 10 +
vision 30 + state 8 + dsh-ros2 25 = **277**。第八轮收尾 241 → **+36**；其中**本轮新增 10 例**
（5 例技能目录对账 + 4 例探针适配 + 1 例 setup 报告回归），其余 +26 为在途分支的测试。

**本轮缺陷（报告 ≠ 执行）的离线复现**——用**已构建的 `lib/`**，不需要 GUI，也不需要 ROS：

```js
// 关键两行：工具"报告"的解析 vs 命令实际"执行"的解析
const reported = resolveSetup({ workspaceRoot: WS })                       // 旧代码：裸 opts → 自动探测
const res = await runCommand('bash', ['-lc', probe], { rosSetup: CONFIG })  // 旧 probe 自带 prefix → 二次 source
```

| 观测项 | 修复前 | 修复后 |
| --- | --- | --- |
| 报告的 `setup` | `explicit:false`、`sourcePath:/opt/ros/jazzy/setup.bash`、prefix 只有一行 source | `explicit:true`、prefix 为**配置的完整链**（含 `/tmp/vlm_ws/...`） |
| 实际执行的命令 | `source /opt/ros/jazzy/... && bash -lc 'source /opt/ros/jazzy/... && echo …'`（**两条** source 链，外层来自配置） | 只有**一条**链：`source <配置链> && bash -lc 'echo …'` |
| 结果 | **exit 1、stdout 空**、stderr 指向 `/tmp/vlm_ws/...`，而报告的却是一个"健康"的 `/opt/ros/jazzy` | 报告与失败**指向同一件事**；把 rosSetup 换成健康链后 **exit 0、`__PKGS=440`** |

**运行中 dsh 的实测证据（本会话，未重启）**：`ros2_env_check` 返回

```text
probe   : { exitCode: 1, timedOut: false, durationMs: 620, stdoutBytes: 0,
            stderrTail: "bash: line 1: /tmp/vlm_ws/install/setup.bash: No such file or directory" }
bundles : loaded 6 / expected 6 / missing [] / undeclared [] / unreported []
          surface 合计 81 tools + 9 skills（core 61 / profile 4 / moveit 4 / safety 5 / vision 7）
```

即：**在途分支的挂载对账已在运行中的进程里生效**，而**本轮的技能目录对账尚未生效**
（该进程的代码早于本轮提交，返回里没有 `skillCatalogue` 段）——**这正是 #22 所描述的"进程陈旧"本身**，
也再次印证 15.2 ①"自检需重启才生效"是不可消除的固有限制。

### 15.5 dsh-phoenix 持续更新 / 测试链路（step 4）

- **活动 profile**：`~/.dsh/profiles/web/package.json` 含
  `dsh-ros2: link:…/dsh-ros2/packages/dsh-ros2` 与 `dsh-phoenix: link:…/dsh-phoenix`。
- **挂载行**：`~/.dsh/profiles/web/cordis.patch.yml` 显式装载 5 个域 bundle
  （core / profile / moveit / safety / vision），聚合包与 dsh-phoenix 经各自 `package.json` 的 bundles 列表装载
  （该文件第 71–72 行已注明 phoenix **不要重复 insert**，否则 duplicate）。
- **在线判定**：`curl -s http://127.0.0.1:3080/__dsh_health` → `{"token":"1789983586590-…"}`
  ⇒ 心跳端点在线 = **客户端自动重连在跑**。
- **优雅重启能力**：`systemctl --user is-active dsh-web.service` → `active`；unit 为 `Type=simple`、
  `Restart=on-failure`、`TimeoutStopSec=30`，并带 `DSH_PHOENIX_STATE_FILE=…/dsh-phoenix-state.json`
  ⇒ idle-aware 优雅重启与 checkpoint 续跑能力**在位**。
- **客户端 HMR**：`ps` 中**没有** `vite` / `pnpm run dev:web` 进程 ⇒ **客户端插件 HMR 未武装**。
  本轮改动**全在 Host 侧**（`packages/common` + `packages/core` 的 TS）且未改 client bundle，
  故不影响本轮验证；但若日后要改 Client 插件并期望免刷新重载，需先跑 `pnpm run dev:web`。
- **本轮如何使用它**：改 → `typecheck/test/build` 全绿 → 提交 → 推送。
  **仍有意未触发优雅重启**（与第七/八轮同一理由：重启会中断本维护会话本身）。
  因此本轮代码只落到磁盘（`lib/`），运行进程仍是上一版——这**恰好**构成 15.4 那条"进程陈旧"的现场证据。
  重启后可观测的变化：`ros2_env_check` 开始返回 `skillCatalogue` 段；且（在修正部署配置后，见 15.7）
  环境探针不再失败。

### 15.6 安全扫描（step 5）——复测 + 本轮新增面复核，未发现新漏洞

**依赖漏洞**：

- `pnpm audit`（默认 registry = `registry.npmmirror.com`）→ `ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`
  （该镜像未实现 audit 端点）。**这不是"干净"，是"没查成"**，不可当作结论。
- 显式换官方源复测：`pnpm audit --registry=https://registry.npmjs.org/` → **No known vulnerabilities found**。
  （第八轮已记录该注意点，本轮再次确认；CI 的 `pnpm audit --prod --audit-level high` 闸门同理依赖默认源配置。）

**静态扫描**：`shell: true` 零命中；`child_process.exec(` 零命中；`eval(` / `new Function(` 零命中；
硬编码密钥（`AIza…` / `sk-…` 模式）零命中。

**既有防线回归复测**（均随测试全绿）：

| 面 | 防线 | 证据 |
| --- | --- | --- |
| 命令注入 | `ros2_process_cleanup` 的 `signal` 白名单，非法值在**审批之前**以 `INVALID_PARAM` 拒绝 | `packages/core/src/tools.ts` 校验仍在 |
| 路径穿越 | `isSafeProfileName` + `resolveProfilePath` 对穿越名**永不 spawn** | `packages/common/tests/names.spec.ts`（4 组） |
| shell 注入 | `shq()` 单引号包裹；safety_monitor 命令只含一个 shell word | `packages/common/tests/runner.spec.ts`（含含空格路径） |
| 不经 shell | `safety_monitor` 走 argv 数组、watchdog 话题不插值 | `packages/safety/tests/safety-monitor-shell.spec.ts` |

**本轮新增面的评审**：

- 改动**减少**了 shell 字符串拼接：探针不再自带 prefix（原先会拼出两条 `source` 链）。
- `ToolDeps.rosSetup` 只承载**配置值**，不来自模型输入；`resolveSetup` 的输入面与改动前一致。
- 技能目录读取是**只读** `snapshot()`；只复制 `name` / `complete` **叶子字段**，
  不把 live 目录对象带进工具结果（符合"不序列化 live 数据"）。
- `missing` 的取值**只可能来自本仓库自己注册的技能名**（注册集合减去可见集合），
  既不来自模型输入也不来自外部数据，不构成新的注入面。

结论：**未发现新漏洞**；依赖面干净（官方源复核）；本轮改动缩小而非扩大了攻击面。

### 15.7 本轮发现（含仓库外的问题）

1. **【部署配置陈旧·高优先·仓库外】** `~/.dsh/profiles/web/cordis.patch.yml` 的 5 行 `rosSetup`
   至今以 `source /tmp/vlm_ws/install/setup.bash &&` 结尾，而**同一个文件第 29 行的注释写着
   "/tmp/vlm_ws was removed so use the delivery workspace that is actually built"**——
   注释改了、值没改。`/tmp/vlm_ws` 目录**已不存在**（实测 `ls` 报 No such file），
   于是 5 个 bundle 的**每一次** ros2 工具调用都会在该链上失败。
   修法（一行 ×5，或只保留已构建的交付工作区）：
   ```yaml
   rosSetup: source /home/stvli/lite_delivery_aio/install/setup.bash &&
   ```
   > 该文件在本仓库之外，且属于**运行中的部署配置**，本轮**未擅自修改**（沙箱为 workspace-write，
   > 且改它会影响用户正在跑的实例）。请维护者确认后修改，然后重启 dsh 生效。
2. **【第八轮 §14.7 第 4 条的真因已定位】** 当时怀疑"systemd 执行环境或 20 s 超时"，**都不是**。
   真因是 15.4 的**报告≠执行 + 二次 prefix**：外层（配置）链失败、内层（自动探测）链根本没跑到，
   于是 stdout 为空，工具报出"未检测到可见 ROS2 包"（旧措辞），而"同一条探针在登录 shell 里正常"
   正是因为手工执行时只走了内层那一条链。**该存疑项可以关闭。**
3. **【残留限制·建议后续】** `resolveSetup` 只校验显式前缀里的**第一个** `source` 路径；
   `A && B` 中 B 缺失时它仍判定为"explicit 且看起来正常"，缺失只体现在 stderr 里。
   建议后续**校验整条 `&&` 链**（任一段缺失即按既有策略回退，并在 note 中点名缺失项）。
   本轮**未做**：它会改变"响亮失败"与"自愈"的语义，影响每一次工具调用，值得单独一轮与其测试。
4. **【测试卫生·本轮已修】** `ros2_workspace use` 的两个测试会写入**模块级全局** session override
   却从不复位，把状态泄漏给同进程后续测试（`de100b5` 已补 `setSessionRosSetup(null)`）。
5. **【文档漂移·本轮已修】** README / README_CN 的用例数停在 "195 例"（落后两轮），
   `robot_profile` 自检数停在 17 项（实际 **29** 项，第八轮给 #21 补的 13 项 TF 解析自检未计入）。
   两处均已按**实测值**校正为 277 例 / 29 项。

### 15.8 结论与下一步建议

- **#22**：三条建议全部合理；**唯一未实现项（会话技能目录对账）本轮补齐**，另两项（固有限制 / 已按边界落地）
  均如实声明。**可 close，或按维护者口径继续保留 open** 以跟踪 15.2 ① 的重启边界。
- **本轮修掉一个真缺陷**：诊断工具"报告的 setup ≠ 实际执行的 setup"。这类"诊断自己说错话"的缺陷
  与 #22 同源，且**只在真机（陈旧配置 + 运行中进程）上才暴露**——离线单测与 `main` 上的 CI 都发现不了它。
- **验收线**：typecheck / test / build 全绿；行为变更均补测试；分支已推送（**PR 待人工开**，token 失效）。
- 下次维护建议：
  1. **修正 15.7 第 1 条的部署配置**（仓库外，需人工确认），随后**重启 dsh**；
     重启后应看到 `ros2_env_check` 返回 `skillCatalogue` 段且探针不再失败——这同时闭合 15.2 ① 的边界。
  2. **给 `gh` 重新登录**（`gh auth login -h github.com`），以便后续轮次能自动开 PR；
     否则每轮都只能推分支、留 PR 给人工。
  3. 考虑把 15.7 第 3 条（整链校验）作为独立一轮：先补 `resolveSetup` 的多段校验测试，再改行为。
  4. 若要让**运行中**的 harness 用上本轮代码：走 §15.5 的 phoenix 优雅重启，
     而不是手工 `systemctl restart`（本轮仍有意未触发，以免中断维护会话本身）。
  5. 维持"提交前 typecheck + test + build 全绿 + 行为变更补测试 + push 后 CI 绿"的验收线；
     `pnpm audit` 必须带 `--registry=https://registry.npmjs.org`，否则会误报"失败"而非"干净"。

---

## 16. 维护记录（2026-09-22 04:14 CST / UTC 2026-09-21 20:14 · 第十轮：补齐"在途无 PR"缺口 → CI 抓出"本地绿、CI 红" → 定位并修复线上故障真因 → 验收并关闭 #22）

> 本轮结论：**1 个 open issue（#22）→ 在运行中进程里逐条验收后关闭（completed）**。
> 两件"上一轮留下的"事在本轮闭合：
> ① 第九轮的 9 个提交**已推送却从未开 PR**，因此**从未跑过 CI**——本轮开 PR #27 后**首跑即失败**（6 条 `TS2307`），
> 暴露了一个只在**干净 clone** 上出现的真缺陷（本地全绿只是因为工作区留着上一轮的 `lib/`）。
> ② 第九轮 §15.7 第 3 条（"只校验 `rosSetup` 第一段"）当时是"建议后续"，本轮确认它**就是线上部署
> "每一次 ros2 调用都失败"的直接成因**，因此升格为必修并落地：**插件现在能自愈这个坏配置**。
> 本轮 3 个 PR（#27 / #28 / #29）**全部 CI 绿并合入 `main`**（`11edc1d`），5 个提交，用例 277 → **285**。

### 16.0 仓库快照（本轮起始/结束）

| 项 | 起始 | 结束 |
| --- | --- | --- |
| 当前分支 | `feat/bundle-surface-reconciliation`（工作树干净，与 `origin` 一致；**9 个提交未合并、且没有 PR**） | **`main` = `11edc1d`**（本地与 `origin/main` 一致） |
| `main` | `f161096`（第八轮 merge） | `11edc1d`（#27 → `e1e8e38`、#28 → `8e5c443`、#29 → `11edc1d`，三个 merge） |
| 该 `feat` 分支 | 9 个提交，已推送，**无 PR ⇒ CI 从未运行** | **已合并**（PR #27） |
| open issue / open PR | **1 / 0** | **0 / 0**（#22 close；#27/#28/#29 均已合并） |
| `gh` 鉴权 | 第九轮：两个账号 token 均 invalid（只能推分支、开不了 PR） | **已恢复**：`StvLi`（active）+ `littleZ05`，keyring 存储；本轮全程用 `gh` 操作 |
| issue/PR 总数 | #1–#26 除 #22 外全部 closed | #1–#29 全部 closed |
| 包数量 / 本地环境 | 9 包 · Node `v24.16.0` · pnpm `11.22.0` · vitest 4.1.11 | 同 |
| vitest 用例 | 277（276 过 + 1 skip） | **285**（284 过 + 1 skip） |
| 运行中的 dsh | 启动于 **2026-09-21 17:58:15 CST**（晚于第九轮最后提交 `17:51:03 CST` ⇒ **已加载第九轮代码**） | 同进程（本轮代码落盘待重启，见 §16.5） |

### 16.1 Issue 检查（step 1）

`gh issue list --state open` → **1 个 open issue**：`#22`（`dx: surface loaded vs installed bundle versions…`，1 条评论）；`gh pr list --state open` → **0**。

**本轮的第一手发现（比 issue 本身更重要）**：第九轮的在途分支有 9 个提交、已推送，**却从未开 PR**。而 CI 只
在 `push: main` 与 `pull_request` 上触发（`.github/workflows/ci.yml`），所以那 9 个提交**一次都没被 CI 看过**。
本轮第一步就是补开 **PR #27**，CI 首跑**失败**（见 §16.4 证明 1）——这说明"没开 PR"不是流程小事，而是
**把 9 个未验证的提交当成了已验收成果**。

`gh` 鉴权恢复（第九轮"下次维护建议"第 2 条）是本轮能做这件事的前提：`gh auth status` 显示 `StvLi` 为 active；
因此本轮的**开 PR、看 CI、合并、评论并关闭 issue** 全部自动完成，不再留人工尾巴。

### 16.2 建议评估（step 2）——逐条判断合理性与必要性

**① `#22` 的三条建议：全部合理，全部已实现；"未实现项"为零 ⇒ 本轮关闭。**

| # | 建议 | 状态 | 本轮验收证据（**运行中进程**，非离线） |
| --- | --- | --- | --- |
| 1 | 暴露已加载 bundle 集合/版本 | ✅ 第九轮落地（**每 bundle 一行**，非一行汇总） | `data.bundles.loaded` 6/6、`stale: false`、逐包 `loaded == installed` |
| 2 | 只读诊断入口（loaded vs installed 漂移） | ✅ 第九轮落地（扩展 `ros2_env_check`，不新增工具） | `bundles.drift` / `stale` / `unresolved` 均有值 |
| 3 | "会话技能目录 vs 实际注册数"对账 | ✅ 第九轮落地 | `skillCatalogue: available true / complete true / missing []`，`visibleCount 13`（9 个注册技能全可见 + 4 个项目/用户技能） |

其中第 1 条里"**自检本身也要重启一次才生效**"是**固有限制**（旧进程里根本不存在这段代码），不是待办：
本轮反而把它当**正向信号**使用——**字段缺席本身就等于"该进程早于功能上线"**。已写入 `docs/versioning.md`
（"已加载版本 vs 磁盘版本"一节），并在 §16.4 用运行中进程实测到它的正面价值。
⇒ 故 #22 以 **completed 关闭**，并留下逐条验收评论（含上表数据）。
**唯一仍建议人工处理的**是 §16.7 第 2 条（仓库外的部署配置死段）——新代码已能自愈，但配置本身该修。

**② 第九轮 §15.7 第 3 条（只校验第一段）：从"建议"升格为"必修"。**

第九轮把它列为"残留限制·建议后续：只校验显式前缀里的第一个 `source` 路径"。本轮在真机上确认它不是
"不够严谨"，而是**线上故障的直接成因**：

```text
rosSetup: source /home/stvli/lite_delivery_aio/install/setup.bash && source /tmp/vlm_ws/install/setup.bash &&
```

`/tmp/vlm_ws` 已不存在 ⇒ 第一段存在使旧实现判定"配置正常"（`explicit: true`、无 note），
而**每一次**调用都失败在第二段。必要性的判断依据因此从"设计上更完备"变为"**当前部署正在坏**"。

**③ 同现场的第二个真缺陷：诊断自己说反话。**

探针失败的告警写死"这通常说明探针命令在该进程环境里失败，**而非 rosSetup 路径无效**"——同一行的 stderr
恰恰就是 `/tmp/vlm_ws/install/setup.bash: No such file or directory`。**合理且必要**：这类"诊断说错话"的
缺陷会直接把排查引向错误方向（第九轮就曾被它误导）。已改为**引用环境解析的结论**。

**④ 本轮新增（现场发现）：`&&ros2` 回显。**

前缀以 `&&` 结尾且无尾空格时，`runCommand` 拼出 `… setup.bash &&ros2 'node' 'list'`。shell 解析与
`&& ros2` **完全等价**，所以**不是功能缺陷**；但它是**每条失败信息**里回显的形式，本轮排查时确实先让人
怀疑"命令拼错了"。判为**诊断缺陷，值得修**（修在构建 shell 字符串处，配置的忠实回显不变）。

**⑤ 本轮明确"不做"的**：`#22` 第 1 条的固有限制（不可能修）；`/tmp/vlm_ws` 的文档/代码残留
（§16.7 第 3/4 条：一个在仓库外的配置里，一个应单开一轮改为可配置）。

### 16.3 开发管理（git · step 3）

| PR | 分支名 | 提交 | 类型 | 说明 |
| --- | --- | --- | --- | --- |
| **#27** | `feat/bundle-surface-reconciliation`（**续用**第九轮在途分支） | `47626d4` | `fix(ci)` | 根 `typecheck` / `test` 改为先按**拓扑序**构建整个家族——`tests/mount.spec.ts` 按真实包名导入 6 个 bundle，干净 clone 上 `lib/` 不存在时必失败 |
| **#28** | `fix/ros-setup-chain`（新开，off `47626d4`） | `f893988` | `fix(common)` | `resolveSetup` 逐段校验 `&&` 链；部分缺失只剔除该段并点名；全缺失才回退 |
| | | `3fcfd3f` | `fix(core)` | 探针失败时不再否认 rosSetup；`setup.missingSources` + `ros2_workspace show` 暴露结论 |
| | | `98fa86f` | `docs` | CHANGELOG + `docs/feedback-env-recovery.md`（新增"整链校验"一节）+ README 计数 |
| **#29** | `fix/setup-prefix-join`（新开，off `8e5c443`） | `ca4652d` | `fix(common)` | 前缀与命令之间插入分隔符（消除 `&&ros2` 回显） |
| | | `8de9d21` | `docs` | CHANGELOG（含"为什么是诊断缺陷而非功能缺陷"）+ README 计数 285 |

- **为什么 #27 是在途分支上补一个 `fix(ci)`，而不是另开分支**：那 9 个提交是第九轮同一议题的成果且已推送，
  CI 失败**源于它们**（`mount.spec.ts` 正是其中新增的文件）；补丁是"让该分支可合并"的一部分。另开分支会把
  "红的分支"永久留在历史里，也会让第九轮的成果继续无法进入 `main`。
- **提交类型的诚实性**：`fix(common)` / `fix(core)` / `docs` 按**文件**切分（`packages/common/**`、
  `packages/core/**`、`CHANGELOG+README+docs/**`），依次检出都能 `typecheck` 全绿；`fix(core)` 依赖
  `fix(common)` 新增的 `missingSources` 字段，**顺序在前**，不存在"看着是 fix、其实依赖后面才有的东西"。
- 分支/提交均已推送；三个 PR 经 CI（Node 22 + 24）全绿后合入 `main`。
- 收尾状态：`main` = `11edc1d`，工作树干净，本地 `main` 与 `origin/main` 一致。

### 16.4 本地验收（全绿）＋ 三个可复现证明

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
rm -rf packages/*/lib          # 复刻 CI 的"干净 clone"起点
CI=true pnpm run typecheck     # 9 包 tsc --noEmit 全部 Done（exit 0，8.3s）
CI=true pnpm run test          # 285 例（284 过 + 1 pty-skip）+ sidecar 10 场景 + zero_pose 6 项 + robot_profile 29 项（8.0s）
CI=true pnpm run build         # 9 包 tsc 全部 Done（exit 0）
```

**用例分布（实测）**：common **51** + core **131**（130 过 + 1 skip）+ moveit 16 + profile 14 + safety 10 +
vision 30 + state 8 + dsh-ros2 25 = **285**。第九轮收尾 277 → **+8**（common +6：整链校验 5 + 前缀拼接 1；
core +2：诊断措辞与数据出口）。

**证明 1 ｜ CI 的失败可以在本地逐字复现（`47626d4` 的动机）**

```text
# 删除全部 lib/ 后执行 CI 的同一步（旧脚本只先构建 dsh-ros2-common）：
packages/dsh-ros2 typecheck: tests/mount.spec.ts(4,28): error TS2307: Cannot find module 'dsh-ros2' …
… 共 6 条（dsh-ros2 / -core / -moveit / -profile / -safety / -vision）
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL]  → exit 2      # 与 CI 日志逐字一致
# 修复后同一命令：exit 0
```

**证明 2 ｜ 线上故障可复现、且已被新代码自愈（`f893988` 的价值）**

用**字面量**的部署配置走**已构建的 `lib/`**（`node` 直接调用，可离线复现）：

| 观测项 | 修复前 | 修复后 |
| --- | --- | --- |
| `runCommand` 结果 | `ok: false`、exit `1`、stdout 空 | `ok: true`、exit `0`、`__PKGS=450` |
| stderr | `bash: line 1: /tmp/vlm_ws/install/setup.bash: No such file or directory` | （空） |
| `envNote` | 无 | 点名 `/tmp/vlm_ws/install/setup.bash` 不存在、已剔除该段、保留 1 段（首个 source = `lite_delivery_aio`） |

运行中会话的**对照证据**同样干净：同一份坏配置下 `ros2_node_list` 返回
`COMMAND_FAILED`（`bash: line 1: /tmp/vlm_ws/…`）；把会话覆盖指向 `lite_delivery_aio`（`ros2_workspace use`）后
立即返回 `["/robot_state_publisher"]`、`ros2_env_check` 报 `visiblePackages: 450`、`probe.exitCode: 0`
——即**环境本身健康，唯一的问题就是那段死链**。

**证明 3 ｜ 新测试是 load-bearing 的（`ca4652d` 的价值）**

按"撤掉实现，测试必须失败"验证：`git stash push -- packages/common/src/runner.ts` 后重跑，新测试立即失败：

```text
× inserts the separator when the prefix ends at && and still runs the command
AssertionError: expected 'Command failed: bash -lc source /tmp/…' to contain 'source /tmp/dsh-runner-join-…'
Tests  1 failed | 50 skipped (51)
```

恢复实现后同一测试通过。**CI 结果**：PR #27 首跑 `failure`（33s）→ 修复后 `pass`（1m14s）；
#28 `pass`（Node 22 1m12s / Node 24 47s）；#29 `pass`（22 1m5s / 24 1m2s）；`main` 的两次 push 亦 `success`。

### 16.5 dsh-phoenix 持续更新 / 测试链路（step 4）

| 面 | 观测 | 判定 |
| --- | --- | --- |
| 挂载与版本 | journal：`[dsh-phoenix] loaded (graceful restart + client reconnect + lifecycle)`（17:58:18）；`dsh-phoenix@0.2.6` | ✅ 在位 |
| 持久检查点 | `DSH_PHOENIX_STATE_FILE=/home/stvli/tmp/dsh-phoenix-state.json` → `generation 18`、`lifecycleState "running"`、`pendingResume false`、`resumeAttempt 0` | ✅ 状态机已跑过 18 代 |
| 进程托管 | `systemctl --user is-active dsh-web.service` → `active`；`Type=simple`、`Restart=on-failure`、`ExecMainStartTimestamp=2026-09-21 17:58:15 CST` | ✅ |
| 客户端重连 | `curl http://127.0.0.1:3080/__dsh_health` → `{"token":"1789984696301-…"}`（per-boot token） | ✅ 心跳端点在线 |
| 延后策略（源码实测） | `deferPollMs 3000` / `deferSoftMs 300000`（5 分钟软告警）/ `deferHardMs 900000`（15 分钟硬期限）/ `deferPolicy auto` | ✅ 空闲优先，有安全阀 |
| 触发面 | 只对 **`cordis_run`（动态插件激活）** 触发；`dsh_phoenix_restart` / `dsh_phoenix_state` 两个工具在 `创造模式 (phoenix)` preset（`~/.dsh/.agent-presets/cordis-phoenix/`）里，**本维护会话的 preset 不含它们** | ⇒ 本会话走**文档化的 `cordis_run` 触发面** |
| 客户端 HMR | `ps` 中无 `vite` / `pnpm run dev:web` | ⚠️ 未武装；本轮改动**全在 Host 侧**，不受影响 |

**更新回路已被证明闭环（第九轮留下的观测）**：运行中进程启动于 `17:58:15 CST`，**晚于**第九轮最后一个
提交 `17:51:03 CST`，而它的 `ros2_env_check` **已经返回**第九轮才有的 `surface` / `skillCatalogue` 段。
即"改 → 构建 → 重启 → 新代码生效 → 诊断自证"这条回路**确实跑通过**（这也正是 §16.2 ① 那条固有限制的
正面用法：**字段在不在，就是进程新旧**）。

**本轮如何使用它**：改 → `typecheck/test/build` 全绿 → 提交/推送 → **CI 绿** → 合入 `main` → 重建 `lib/`
（部署经 `~/.dsh/profiles/web/node_modules/…` 符号链接 realpath 直连仓库 `packages/*/lib`）→
按触发面请求**非强制**优雅重启（`force=false` 语义：忙碌则延后到空闲安全点），随后不再继续操作，
把重启留给"本会话空闲"这一安全点。

**触发已确认（journal + 检查点实测，非推断）**：

```text
04:18:06  [cordis:rosmnt-1] cordis_run activation: the round-10 dsh-ros2 fix is built and merged
                           (main a0a1370); requesting that dsh-phoenix defer a graceful restart …
04:18:06  [dsh-phoenix] cordis tool: cordis_run
04:18:09  [dsh-phoenix] restart requested (gen 19): plugin-change
检查点    → generation 19 / lifecycleState "deferred" / deferDeadline 1790022789189（= 04:18:09 + 15min = 04:33:09 CST）
```

即 phoenix **看到了**这次激活、**登记了第 19 代重启请求**，并因维护会话仍在运行而进入 `deferred`；
维护会话结束时，下一个 3s 轮询点即执行优雅重启（软告警 5 分钟、硬期限 15 分钟、policy `auto`）。
这就是"**用 dsh-phoenix 做插件持续更新**"的**末端动作**：改动已合入 `main` 并构建进 `lib/`，
重启只是把它从磁盘搬进进程——同时由 `/__dsh_health` 的 boot token 让浏览器自己刷新。

- **重启后可观测的变化（预期）**：`ros2_env_check` 返回 `setup.missingSources = ["/tmp/vlm_ws/install/setup.bash"]`
  与对应 `note`；每次 ros2 调用的失败消失（死段被剔除）；`runCommand` 的失败信息不再出现 `&&ros2`。
- **诚实边界**：本会话仍在运行，因此**无法在同一进程内观测重启后的结果**。§16.8 第 1 条把它列为下次维护的
  第一复核项；若 phoenix 因本会话持续忙碌而未执行，按上面的触发面再请求一次即可。

### 16.6 安全扫描（step 5）——依赖 + 静态 + 本轮新增面复核，未发现新漏洞

**依赖漏洞**：

- `pnpm audit --prod --audit-level high`（本机默认 registry = `registry.npmmirror.com`）→
  `ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`。**这不是"干净"，是"没查成"**，不可当作结论。
- 显式换官方源复测：`pnpm audit --prod --audit-level high --registry=https://registry.npmjs.org/` →
  **No known vulnerabilities found**。
  （注：CI 里的同一闸门在 GitHub runner 上**默认源就是官方源**，因此 CI 的闸门是有效的；只有本机需要显式指定。）

**静态扫描**（`packages/*/src`，零命中）：`shell: true` 0；`child_process.exec(` 0（命中的全是 `RegExp.exec`）；
`eval(` / `new Function(` 0；硬编码密钥（`AIza…` / `sk-…`）0。

**本轮新增面评审**：

| 面 | 结论 |
| --- | --- |
| 整链校验如何重建前缀 | **只做删除**：重建用的都是**原有段落的原文**（`trim()` 后拼接），不插入任何新值 ⇒ 不引入新的拼接内容 |
| `missingSources` 的来源 | 只来自**配置文本**（与 `rosSetup` 同信任级），**不来自模型输入、不来自外部数据** |
| `note` / `missingSources` 的信息暴露 | 只是把配置里的路径**回显**给本来就能读该配置的模型 ⇒ 无新增信息面 |
| 探针告警改写 | 纯措辞，不执行任何东西 |
| `runCommand` 的分隔符 | **常量空格**，不引入变量 ⇒ 无注入面 |
| 既有防线回归 | 随测试全绿：`signal` 白名单（非法值在**审批之前**以 `INVALID_PARAM` 拒绝）、`isSafeProfileName` 路径穿越（4 组）、`shq()` 单引号包裹（含空格路径）、safety_monitor 走 argv 数组 |

结论：**未发现新漏洞**；本轮改动缩小而非扩大了攻击面（去掉了一条必然失败的外层 `source` 链）。

### 16.7 本轮发现（含仓库外的问题）

1. **【流程·已修·重要】"推送了但没开 PR" = CI 从未运行。** 第九轮的 9 个提交在 CI 上**首跑即失败**。
   已把教训写进 §16.1/§16.4：**分支推送后立刻开 PR，让 CI 说话**；否则 `main` 之外的一切都是"未验证"。
2. **【部署配置·仍未修·高优先·仓库外】** `~/.dsh/profiles/web/cordis.patch.yml` 的 5 行 `rosSetup` 至今以
   `source /tmp/vlm_ws/install/setup.bash &&` 结尾，而 `/tmp/vlm_ws` **已不存在**；同文件第 29 行的注释写着
   "改用实际构建的交付工作区"——**注释改了、值没改**。本轮**未擅自修改**（仓库外 + 运行中的部署），
   但新代码已能**自愈**它（剔除死段并点名）。建议人工删掉这 5 处死段，然后优雅重启。
3. **【代码·未修·建议单开一轮】** `packages/vision/src/tools.ts:316` 把 `/tmp/vlm_ws/install` **硬编码**为
   `ros2_vision_doctor` 的候选 install 目录。它是历史本机路径、现已不存在（只是让 built 判定少一个候选）。
   建议改为可配置（vision 包 config）或从 ROS2 环境派生，而不是写死一个已删除的路径。
4. **【文档·未修】** `docs/compatibility.md:9` 仍把 `/tmp/vlm_ws` 写成"本机"L4 包位置（README/README_CN 里的
   `/tmp/vlm_ws` 是**构建示例**，可保留）。本机现状类描述应更新。
5. **【固有限制·如实声明】** `ros2_env_check` 的 `skillCatalogue` / `surface` 等自述字段需要**重启后**才存在；
   本轮把它当**正向信号**使用（字段缺席 = 该进程早于功能上线）。这不是缺陷，故不再追踪。
6. **【时间口径】** 本轮跨了本地日界：CST `2026-09-22 04:xx` = UTC `2026-09-21 20:xx`。本节标题用**本地时间**，
   而 git / CI / journal 的时间戳为 UTC（第九轮的 `17:5x CST` 也随之解释）。

### 16.8 结论与下一步建议

- **交付**：PR **#27**（合并第九轮成果 + 修 CI）、**#28**（整链校验 + 诊断措辞）、**#29**（前缀分隔符）
  全部 CI 绿并合入 `main`（`11edc1d`）；issue **#22 验收后关闭**；**open issue / open PR 归零**；
  用例 **277 → 285**；README / README_CN / CHANGELOG 计数同步。
- **线上价值**：部署配置里的死段不再让**每一次** ros2 调用失败——新代码剔除死段、在 `note` 里点名（自愈），
  并且**不再把故障归因于"探针的问题"**；失败信息也不再回显成 `&&ros2`。
- **下次维护建议**：
  1. **复核重启后的现场**（本轮唯一未闭环的观测）：`ros2_env_check` 应出现
     `setup.missingSources = ["/tmp/vlm_ws/install/setup.bash"]`，`ros2_node_list` 应直接可用，
     失败信息不应再出现 `&&ros2`。若 phoenix 因会话忙碌未执行重启，用 `创造模式 (phoenix)` preset 的
     `dsh_phoenix_restart` 再请求一次（非强制）。
  2. **改配置**：删掉 `cordis.patch.yml` 里 5 处 `/tmp/vlm_ws` 死段（仓库外，需人工确认）。
  3. 把 §16.7 第 3 条（vision doctor 硬编码 install 目录）单开一轮：先补测试再改行为。
  4. `docs/compatibility.md` 的本机路径描述同步现状。
  5. 维持验收线：**推送前** `typecheck + test + build` 全绿、**推送后立刻开 PR 并等 CI 绿**、
     `pnpm audit` 必须带 `--registry=https://registry.npmjs.org`（本机）。

---

## 17. 维护记录（2026-09-24 15:11 CST / UTC 2026-09-24 07:11 · 第十二轮：收尾超时遗留的在途 PR #32 → 实测第十轮的重启请求已按硬期限落地 → 修复"配置没送到 doctor"的接线缺口 + API Key 来源语义）

> 本轮结论：起始 **0 open issue / 1 open PR**（#32 是**上一轮定时运行超时被杀的遗留**），
> 收尾为 **PR #32 验收合并** + **PR #33 / #34 两个修复**（全部 CI 绿并合入 `main` = `de7bdba`），
> 结束 **open issue / open PR = 0 / 0**；用例 **292 → 304**。
>
> 三件"上一轮留下的事"在本轮闭合：
> ① **上一轮的定时运行 `failed: run timed out after 30 minutes`** —— 这正是 PR #32"已开未合、文档未写"的原因
> （不是疏忽，是会话被 30 分钟上限杀掉；见 §17.7 第 1 条）。本轮先收尾它，再谈新工作。
> ② **第十轮请求的 phoenix 重启已按硬期限执行**（`2026-09-22 04:33:09`），第十轮 §16.5 唯一未闭环的观测
> （"重启后才可见的自愈字段"）本轮**实测确认**。
> ③ 由 ② 的现场证据**反查出两个运行期真缺陷**：doctor 的安装根派生**在运行期根本拿不到配置**
> （`installDirs` 恒为 `[]`），以及它的 API Key **来源报告说反话**。两者都不在 issue 里，是本轮自己撞见的。

### 17.0 仓库快照（本轮起始/结束）

| 项 | 起始 | 结束 |
| --- | --- | --- |
| 当前分支 | `fix/vision-doctor-install-dirs`（4 个提交，**PR #32 open、CI 双绿**，距 `main` 4 提交） | **`main` = `de7bdba`**（本地与 `origin/main` 一致，工作树干净） |
| `main` | `9abc6c6`（第十轮 docs） | `de7bdba`（#32 → `37a588b`、#33 → `d6e0392`、#34 → `de7bdba`） |
| open issue / open PR | **0 / 1** | **0 / 0** |
| vitest 用例 | 292（291 过 + 1 pty-skip） | **304**（303 过 + 1 pty-skip） |
| 包数量 / 本地环境 | 9 包 · Node `v24.16.0` · pnpm `11.22.0` · vitest 4.1.11 | 同 |
| 运行中的 dsh | 启动于 **2026-09-24 15:11:04 CST**（本会话 15:11:11 以 `overdue: true` 起跑） | 同进程（本轮代码已构建进 `lib/`，待重启，见 §17.5） |
| 定时任务近况 | 近两周多数运行失败（超时 30min / `events is not iterable`） | 同（**本轮最重要的发现**，见 §17.7 第 1 条） |

### 17.1 Issue 检查（step 1）——0 open issue，但有 1 个"在途 PR"

`gh issue list --state open` → **0**；`gh pr list --state open` → **1**：**#32**
（`fix(vision): derive ros2_vision_doctor install roots from the resolved setup chain`，`MERGEABLE`/`CLEAN`，CI Node 22/24 双 `pass`）。

**本轮的第一手发现：这不是"没有 issue 就跳 step 5"，而是有一份未闭环的交付。** 三条证据指向同一件事：

1. 工作树停在 `fix/vision-doctor-install-dirs`，4 个提交已推送、PR 已开、**CI 已绿——却从未合并**；
2. `dsh-ros2-maintain.md` 最后一节仍是第十轮（§16），**第十一轮的维护记录根本不存在**；
3. 定时任务历史给出成因：`run-6a1c0ed8`（`2026-09-22T20:00:00Z` = `09-23 04:00 CST`）状态 **`failed`**
   —— `"run drive failed: run timed out after 30 minutes"`，其 sessionId 正是留下 PR #32 的那次运行。

⇒ 所以本轮**不按"无 issue → 直接安全扫描"走**，而是先把在途成果验完、合并、并补记第十一轮（§17.2），
再进入本轮新工作（§17.3 起）。这一条与第十轮 §16.1 的教训是同一枚硬币的两面：
第十轮是"推了但没开 PR ⇒ CI 从未运行"，本轮是"开了 PR 但没合并 ⇒ 成果停在 `main` 之外"。

### 17.2 建议评估（step 2）——PR #32 的设计主张逐条核验

PR #32 没有对应的 issue，它实现的是第十轮 §16.7 第 3 条 / §16.8 第 3 条（vision doctor 硬编码安装根）。
对一个"自定议题"的 PR，本轮不只看它绿不绿，而是**逐条验证它自己声称的性质**：

| # | PR #32 的主张 | 本轮核验 | 判定 |
| --- | --- | --- | --- |
| 1 | 安装根应由**环境派生**，而非"再加一个配置列表" | 配置列表能做到"对 `rosSetup` 并不 source 的工作区报 `built: true`"，即**可以撒谎**；派生则让"已删除的工作区不可能被广告为构建位置" | ✅ 成立，且第 3 条测试（多工作区链）正是钉这个 |
| 2 | `/opt/ros/<distro>` **不是** colcon 安装根 | `path.dirname('/opt/ros/jazzy/setup.bash')` = `/opt/ros/jazzy`，`basename` = `jazzy` ≠ `install` ⇒ 被排除；独立测试钉住 | ✅ 成立 |
| 3 | "撤掉实现后 **3/4** 新测试失败（第 4 个是边界守卫，两种实现都过）" | **精确复现**：保留导出、只把安装根计算回退成旧的 `[workspaceRoot/install, '/tmp/vlm_ws/install']` ⇒ **3 失败**；整体回退到 `origin/main`（导出本身消失）⇒ **4 失败**。PR 的措辞（3/4）**准确**，未夸大 | ✅ 主张诚实 |
| 4 | 该修复"让 doctor 与命令缝回答同一个已解析前缀" | ❌ **运行期不成立**——见 §17.3，这正是本轮新发现的缺陷 | ❌ 已由 PR #33 补齐 |

**④是本轮最有价值的一条**：PR #32 把"从 `deps.rosSetup` 派生"写成了它的核心卖点（代码注释里也这么写），
但**运行期从来没人把 `rosSetup` 放进 `deps`**。这不是 PR 的谎，而是它的**单元测试与插件接线之间有一道缝**——
测试直接调 `createRos2Tools({ rosSetup })`，而 `index.ts` 组装 `deps` 时漏了这一项。
"测试绿"与"运行期成立"之间的差距，正是本轮要补的东西。

### 17.3 开发管理（git · step 3）

| PR | 分支名 | 提交 | 类型 | 说明 |
| --- | --- | --- | --- | --- |
| **#32** | `fix/vision-doctor-install-dirs`（**上一轮在途**） | `c2037a9` `d0a3684` `daae842` `cd34308` | `fix(common)` / `fix(vision)` / `docs` ×2 | 新增 `setupSourcePaths()`；doctor 安装根改为从已解析链派生；CHANGELOG/README/`docs/compatibility.md` 同步。**本轮验收后合并** |
| **#33** | `fix/vision-doctor-rossetup-wiring`（新开，off `37a588b`） | `b3d6b5f` | `fix(vision)` | 一行转交 `rosSetup: config.rosSetup`；新增 `packages/dsh-ros2/tests/run-seam-wiring.spec.ts`（静态类不变量 + 行为级挂载测试） |
| | | `9017004` | `docs` | CHANGELOG + README/README_CN 计数 295 |
| **#34** | `fix/vision-apikey-origin`（新开，off `d6e0392`） | `2add724` | `fix(vision)` | 新增 `resolveApiKeyOrigin()`，来源在 `apply` 阶段定下；`plaintext` 改为"字面量写在插件配置里"；9 例新测试 |
| | | `a2b4c81` | `docs` | CHANGELOG + README/README_CN 计数 304 |

- **为什么 #32 先合并、再另开 #33 修它暴露的问题**（而不是把修复压进 #32）：
  #32 的四条主张里三条已被本轮独立验证成立，它**自身不引入运行期回归**——
  修复前后 `installDirs` 在运行期都是 `[]`（旧代码是 `['/tmp/vlm_ws/install']`，该目录已删除，同样全 `false`）。
  也就是说 #32 做的是"**删掉一个谎言**"，#33 才让派生**真正看见环境**。把两件事拆开，历史才读得出
  "哪一步是删谎、哪一步是接线"，而不是含混成一次改动。
- **提交类型的诚实性**：每个 PR 内按**文件域**切 `fix(...)` 与 `docs`（`packages/vision/**` vs
  `CHANGELOG+README+docs/**`），每个提交单独检出都能 `typecheck` 全绿；顺序上 `fix` 在前、`docs` 在后，
  不存在"看着是 docs、其实依赖后面才有的代码"。
- 全部分支/提交已推送；三个 PR 均经 CI（Node 22 + 24）**全绿**后合入 `main`，分支已删除。
- 收尾状态：`main` = `de7bdba`，工作树干净，0 open issue / 0 open PR。

### 17.4 本地验收（全绿）＋ 四个可复现证明

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
rm -rf packages/*/lib          # 复刻 CI 的"干净 clone"起点
CI=true pnpm run typecheck     # 9 包 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run test          # 304 例（303 过 + 1 pty-skip）（exit 0）
CI=true pnpm run build         # 全部 Done（exit 0）
```

**用例分布（实测）**：common **54** + core **131**（130 过 + 1 skip）+ moveit 16 + profile 14 + safety 10 +
vision **43** + state 8 + dsh-ros2 **28** = **304**。第十一轮收尾 292 → 本轮 +12
（vision +9：`resolveApiKeyOrigin` 5 + doctor 来源 4；dsh-ros2 +3：运行缝不变量）。

**证明 1 ｜ 接线缺口在"活的进程"里直接可见（PR #33 的动机，非推断）**

同一个时刻、同一个进程，两个自述工具给出两个不同的世界：

```text
ros2_vision_doctor → workspace: { root: "(未配置)", installDirs: [], built: {…全部 false} }
ros2_env_check     → setup: { prefix: "source /home/stvli/lite_delivery_aio/install/setup.bash && ", explicit: true }
```

doctor 报 `installDirs: []` 不是"环境里没有安装根"，而是**它解析时用的是裸参数**（回退到自动探测的
`/opt/ros/jazzy/setup.bash`，而 `/opt/ros/<distro>` 按设计不是安装根 ⇒ 被排除 ⇒ 空表）。

**证明 2 ｜ 撤掉那一行，3 个新测试立即失败（且报错与线上同形）**

```text
× every bundle whose tools read deps.rosSetup forwards the configured value
  AssertionError: … expected [ 'vision' ] to deeply equal []
× reports the install root of the workspace the seam sources
  AssertionError: expected [] to include '/tmp/dsh-runseam-doctor-81251/install'
× reports every workspace of a multi-workspace chain, not just the head
  AssertionError: expected [] to include '/tmp/dsh-runseam-chain-a-81251/install'
Tests  3 failed (3)
```

`expected [] to include …` 与证明 1 里活进程的 `installDirs: []` **逐字同形**——即新测试复现的正是线上症状。

**证明 3 ｜ API Key 来源语义撤掉后，3 个新测试立即失败（PR #34 的动机）**

```text
× reports an env-injected key as env and does NOT warn about plaintext
  AssertionError: expected true to be false        # ← 就是线上那条 plaintext: true 的误报
× reports a key read from the secrets file as secrets, not config
  AssertionError: expected 'config' to be 'secrets'
× prefers the secrets file when a ${VAR} reference is configured but the variable is empty
  AssertionError: expected 'config' to be 'secrets'
Tests  3 failed | 1 passed (4)
```

并且"用哪个 key"**未被改动**：`secrets.spec.ts` 把**旧表达式与新解析器并排求值**，在 6 组输入上逐一相等。

**证明 4 ｜ PR #32 的"3/4"主张被精确复现**

保留 `visionInstallDirs` 导出、仅回退其安装根计算 ⇒ `Tests 3 failed | 13 passed (16)`；
整体回退到 `origin/main`（导出消失）⇒ `Tests 4 failed | 12 passed (16)`。PR 声称的 3/4 **与实现方式一一对应**，不是含糊表述。

### 17.5 dsh-phoenix 持续更新 / 测试链路（step 4）——第十轮的请求已闭环，且本轮由它反查出缺陷

**① 第十轮那次重启：已按硬期限执行（journal 原文，非推断）**

```text
09-22 04:18:09  [dsh-phoenix] restart requested (gen 19): plugin-change
09-22 04:23:09  [dsh-phoenix] soft defer deadline reached; agent still busy — restart will be forced at the hard deadline (policy=auto)
09-22 04:33:09  [dsh-phoenix] HARD defer deadline reached; forcing restart (policy=auto): plugin-change
09-22 04:33:09  [dsh-phoenix] scheduling restart … systemctl --user stop dsh-web; sleep 8; systemctl --user start dsh-web
09-22 04:33:09  [dsh-phoenix] restart cmd exit=0
09-22 04:33:10  systemd: Stopped dsh-web.service
09-22 04:33:18  systemd: Started dsh-web.service
09-22 04:33:21  [dsh-phoenix] loaded (graceful restart + client reconnect + lifecycle)
```

⇒ 第十轮 §16.5 的"软告警 5 分钟 / 硬期限 15 分钟 / policy auto"**不是文档描述，而是可核对的执行记录**：
请求、两次期限、强制、重启、重新加载，五个环节齐全。

**② 第十轮 §16.8 第 1 条（唯一未闭环观测）：本轮实测确认**

运行中的进程（启动于 `09-24 15:11:04`，晚于第十轮代码）返回：

```text
ros2_env_check → setup.missingSources: ["/tmp/vlm_ws/install/setup.bash"]
                 note: "配置的 rosSetup 链中有 source 路径不存在：…；已剔除该段，改用其余 1 段（首个 source：lite_delivery_aio）。建议修正配置。"
                 probe: { exitCode: 0, stderrTail: "" }
```

⇒ **自愈生效**：死段被剔除、被点名、`exitCode` 归零。第十轮预言的三个可观测变化中，"`missingSources` 出现 + 每次调用不再失败"两条**已闭环**；
第三条（失败信息不再出现 `&&ros2`）属同一批构建，随下次重启复核（无害，仅影响措辞）。

**③ 本轮起点的那次重启：不如实归因于 phoenix**

`09-24 15:11:04` 还有一次 `dsh-web` 重启，但 journal 里**没有对应的 phoenix 行**，且形态不同——
phoenix 的调度是 `stop; sleep 8; start`（04:33:10 → 04:33:18，8 秒间隔），而这次是
`15:11:03 Stopping … → 15:11:04 Stopped → 15:11:04 Started`（**零间隔**）。⇒ 判定为**外部/人工的干净重启**，
不是 phoenix 所为。其后果是：定时任务随即以 `overdue: true` 在 `15:11:11` 起跑（本会话）。
**成因在 journal 里没有记录**，如实记为未解释项（§17.7 第 3 条）。

**④ 本轮的末端动作**：改动已合入 `main` 并重建 `lib/`（`packages/vision/lib/secrets.js` 含
`resolveApiKeyOrigin`、`lib/index.js` 含 `rosSetup: config.rosSetup`），随后按本 preset 的**文档化触发面**
（`cordis_run`：动态插件激活）请求一次**非强制**优雅重启（`deferPolicy auto`；不传 `force`）。
**已确认（journal + 检查点实测，非推断）**：

```text
15:28:44  [dsh-phoenix] cordis tool: cordis_run
15:28:47  [dsh-phoenix] restart requested (gen 20): plugin-change
15:28:51  [dsh-phoenix] restart already in-flight; coalesced plugin-change
检查点    → generation 20 / lifecycleState "deferred" / deferDeadline 1790235827937（= 15:28:47 + 15min = 15:43:47 CST）
```

即 phoenix **看到了**这次激活、登记为**第 20 代**重启请求，并因维护会话仍在运行而进入 `deferred`；
会话结束时，下一个 3s 轮询点即执行优雅重启——与 ① 中第 19 代走完的五个环节完全同构。
本轮**未**为该信号新增任何行为：激活用的包是**惰性的**（`apply()` 空实现，不注册工具/事件/服务/UI；
sandbox 也不暴露 `ctx.logger`，故连日志都没有），它唯一的作用就是"让 `cordis_run` 发生"。

- **重启后可观测的变化（预期）**：`ros2_vision_doctor` 的 `workspace.installDirs` 不再是 `[]`，
  而应含 `lite_delivery_aio/install`；`apiKey.plaintext` 对当前"`${VLM_API_KEY}` 注入"的 key 应为 **`false`**
  且不再出现"建议改用环境变量注入"的自相矛盾告警。
- **诚实边界**：本会话仍在运行，**无法在同一进程内观测重启后的结果**；§17.8 第 1 条把它列为下次维护的第一复核项。

### 17.6 安全扫描（step 5）——依赖 + 静态 + 本轮新增面，未发现新漏洞；并改正一处"自相矛盾的安全建议"

**依赖漏洞**：

- `pnpm audit --prod --audit-level high --registry=https://registry.npmjs.org/` → **No known vulnerabilities found**（exit 0）。
- 本机默认源（`registry.npmmirror.com`）→ `ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`。**这不是"干净"，是"没查成"**，不可当作结论。
  （CI 里的同一闸门在 GitHub runner 上默认即官方源 ⇒ CI 的闸门有效；只有本机需要显式指定。）

**GitHub 侧扫描面（本轮新查）**：

| 面 | 结果 | 含义 |
| --- | --- | --- |
| Dependabot alerts | `403 — Dependabot alerts are disabled for this repository` | **仓库未开启**，无 GH 侧依赖告警可依赖 |
| Code scanning (CodeQL) | `404 — no analysis found` | **未配置**，无静态分析基线 |

⇒ 结论：**本仓库唯一的依赖安全闸门是 CI 里那一条 `pnpm audit --prod --audit-level high`**。
它本身有效，但覆盖面是"生产依赖 + 高/严重"；dev-only 工具链与中低危不在内。这一条已写入 §17.8 建议。

**静态扫描**（`packages/*/src`，全部零命中）：`shell: true` **0**；`eval(` / `new Function(` **0**；
硬编码密钥（`AIza…` / `sk-…`）**0**；`child_process` 的两处 `spawn` 全部走**argv 数组**（无 shell 解析）。

**本轮新增面评审**：

| 面 | 结论 |
| --- | --- |
| `rosSetup: config.rosSetup`（PR #33） | 只是把**配置里已有的字符串**转交给一个本就该读它的工具；不引入新的输入源、不进入任何 shell 拼接 |
| `resolveApiKeyOrigin()`（PR #34） | **纯函数**，输入是配置文本 / 环境变量 / 密钥文件内容，**均非模型可控输入**；只判定来源，不改变"用哪个 key"（已用并排求值钉住） |
| 医生报告新增 `apiKeySource` | 只在 `config` / `env` / `secrets` / `missing` 四个枚举间取值，**不含密钥值**（密钥从不回显，沿用既有约束） |
| 新增测试文件是否随包发布 | 否：`packages/vision/package.json` 的 `files` 只含 `lib`/`cordis.patch.yml`/`vlm`/`offscreen`/`scripts`/`README.md`/`LICENSE` ⇒ 测试不进 tarball |
| 既有防线回归 | 随测试全绿：`signal` 白名单、`isSafeProfileName` 路径穿越（4 组）、`shq()` 单引号包裹（含空格路径）、safety_monitor 走 argv 数组、`ros2_install` 的 installer 转义（第五轮修复） |

**本轮的安全相关发现（已修，PR #34）**：doctor 的 API Key 报告**把已按推荐方式注入的 key 报成"明文"**，
并在同一条告警里建议"改用环境变量注入（`${VLM_API_KEY}`）"——**建议的正是它已经在用的做法**；
同时把**来自 0600 密钥文件的 key 报成 `config`**，把用户引去检查 profile 配置。
修复后 `plaintext` 只表示"**字面量写在插件配置里**"（那份会被复制/分享/入库的文件），
环境变量与密钥文件两种推荐方式不再误报。**判定为必要**：一条自相矛盾的安全建议会诱导用户
把**已经正确**的注入方式改掉，属于"诊断把人带偏"，与第十轮 §16.2 ③ 同类。

**结论：未发现新漏洞**；本轮改动收缩而非扩大攻击面（去掉一个写死的本机路径 + 改正一处误报的来源判定）。

### 17.7 本轮发现（含仓库外的问题）

1. **【流程·基础设施·重要·未修】** **上一轮的定时维护运行是被 30 分钟上限杀掉的**：
   `run-6a1c0ed8`（`09-23 04:00`）`status=failed` / `"run drive failed: run timed out after 30 minutes"`，
   其 session 正是留下 PR #32 的那次。任务历史显示这**不是个例**：近两周
   `timed out after 30 minutes` 出现 4 次（09-14、09-16、09-22），`events is not iterable` 出现 5 次
   （09-10、09-11、09-12、09-14、09-21）；能完整跑完的只有 09-03～09-06 那几次。
   **对维护流程的直接含义**：长任务必须**先落地、再记录**——本轮据此把两个修复**各自独立合并**，
   维护文档**最后写并立即推送**，这样即使会话在文档之后被超时杀掉，成果也已全部进入 `main`。
   建议（需人工/宿主侧决策）：提高该类运行的时限，或在超时前提供落盘钩子。
2. **【部署配置·仍未修·仓库外·高优先】** `~/.dsh/profiles/web/cordis.patch.yml` 的 5 处 `rosSetup`
   仍以 `source /tmp/vlm_ws/install/setup.bash &&` 结尾，而 `/tmp/vlm_ws` **已不存在**；
   同文件第 29 行注释写着"改用实际构建的交付工作区"——**注释改了、值没改**。
   新代码已能自愈（本轮实测：剔除死段 + `note` 点名 + `probe.exitCode = 0`），故**不是当前故障**，
   但每次调用都要多一次 `existsSync` 与一段告警噪声。本轮**未擅自修改**（仓库外 + 运行中的部署）。
   建议人工执行（改完优雅重启）：把 5 处 `&& source /tmp/vlm_ws/install/setup.bash` 从各行删掉。
3. **【本机·未解释】** `2026-09-24 15:11:04` 的 `dsh-web` 重启在 journal 中**没有成因记录**：
   形态与 phoenix 的 `stop; sleep 8; start` 不同（零间隔），也不是 systemd 的 `Restart=on-failure`
   （无 `Main process exited` / `Scheduled restart`）。其直接后果是**当天 04:00 的定时维护被跳过**，
   随后以 `overdue: true` 在 15:11:11 补跑（即本会话）。**如实记为未解释**，建议下次维护顺带核对。
4. **【文档·已修】** 第十轮的 §16.7 第 4 条（`docs/compatibility.md` 把 `/tmp/vlm_ws` 当"本机"位置）
   已随 PR #32 更正，并补了"**colcon workspace 不要建在 `/tmp`**"的环境注意——这正是本次工作区消失的根因。
5. **【固有限制·如实声明·不追踪】** `ros2_env_check` 的 `skillCatalogue` / `surface` / `missingSources`
   等自述字段需要**重启后**才存在；本轮继续把它当**正向信号**使用（字段在不在 ⇒ 进程新旧）。
6. **【时间口径】** 本节标题用**本地时间（CST）**，而 git / CI / journal / 任务历史的时间戳为 **UTC**：
   本轮 `09-24 15:11 CST` = `09-24 07:11 UTC`；上一轮的 `09-23 04:00 CST` = `09-22 20:00 UTC`。

### 17.8 结论与下一步建议

- **交付**：PR **#32**（上一轮在途，验收后合并）、**#33**（运行缝接线 + 类不变量测试）、
  **#34**（API Key 来源语义）全部 CI 绿并合入 `main`（`de7bdba`）；**open issue / open PR 归零**；
  用例 **292 → 304**；README / README_CN / CHANGELOG 计数同步。
- **线上价值**：① doctor 的安装根**终于**来自"命令缝真正 source 的那条链"，`built` 不再恒为 `false`；
  ② API Key 报告不再把"已用环境变量注入"说成"明文"，也不再把它指向错误的来源——
  这两条都是**"诊断说反话"**类缺陷，会直接把排查引向错误方向。
- **末端动作**：改动已构建进 `lib/`，并按文档化触发面（`cordis_run`）请求**非强制**优雅重启；
  由 phoenix 在会话空闲的安全点执行，客户端由 `/__dsh_health` 的 per-boot token 自行刷新。
- **下次维护建议**：
  1. **复核重启后的现场**（本轮唯一未闭环的观测）：`ros2_vision_doctor` 的 `workspace.installDirs`
     应不再是 `[]`（应含 `lite_delivery_aio/install`）；`apiKey.plaintext` 对当前 `${VLM_API_KEY}` 注入应为 `false`，
     且不应再出现"建议改用环境变量注入"的告警。
  2. **改配置**（§17.7 第 2 条）：删掉 `cordis.patch.yml` 里 5 处 `/tmp/vlm_ws` 死段，然后优雅重启。
     **这是连续第三轮被记为"仍未修"的仓库外项**，建议优先处理。
  3. **盯住定时任务的可靠性**（§17.7 第 1 条）：近两周多数运行失败；在时限被提高之前，
     维护流程一律遵循"**先落地、再记录**"（本轮范式：小 PR 各自合并 → 文档最后写并立即推送）。
  4. 考虑开启 GitHub 侧扫描（Dependabot alerts 当前**关闭**、CodeQL **未配置**），
     把 §17.6 的"唯一依赖闸门是 CI 那一条 audit"补成纵深防御。
  5. 维持验收线：**推送前** `typecheck + test + build` 全绿、**推送后立刻开 PR 并等 CI 绿再合并**、
     `pnpm audit` 必须带 `--registry=https://registry.npmjs.org`（本机）。

## 18. 维护记录（2026-09-25 04:13 CST / UTC 2026-09-24 20:13 · 第十三轮：0 open issue / 0 open PR → 安全扫描发现并落地 3 处修复 = PTY 会话 id 路径穿越 · 发布物携带 `__pycache__` 字节码 · 安装器选项注入；并闭环第十二轮唯一的未闭环观测 + 开启 Dependabot）

> 本轮结论：起始 **0 open issue / 0 open PR**（本轮**没有**第十/十二轮那种"在途交付"），
> 因此**干净地走"无 issue → step 5 安全扫描"**这条路径，不跳过任何东西。安全扫描**发现 3 处真实缺陷**，
> 全部按 `fix/...` 分支 + 规范提交落地为 3 个 PR（#35/#36/#37，CI Node 22/24 双绿后合入），
> 结束 `main = 247a667`、**0 open issue / 0 open PR**；用例 **304 → 310**。
>
> 三件事值得单独点名：
> ① **一个真漏洞**：`ros2_install` 的 `session` 未校验就进入 `os.path.join`，相对与绝对路径都能逃出
> 会话目录，`stop` 还能**截断任意 `.meta`**——本轮给出 before/after 可复现证明。
> ② **一个"CI 看不见"的发布面缺陷**：`common`/`core`/`sidecar` 把 `__pycache__/*.pyc` 打进 npm 包，
> 而 CI 的 tarball 闸门**根本没打包 sidecar**（6 个文件、最严重的一个），因为它只遍历一份手写子集。
> ③ **第十二轮唯一未闭环的观测本轮实测确认**：doctor 的 `installDirs` 不再是 `[]`、`apiKey.plaintext = false`。

### 18.0 仓库快照（本轮起始/结束）

| 项 | 起始 | 结束 |
| --- | --- | --- |
| 当前分支 | `main`（工作树干净） | `main` = **`247a667`**（本地与 `origin/main` 一致） |
| `main` | `975b182`（第十二轮 docs） | `247a667`（#35 → `0b1287d`、#36 → `d22efc0`、#37 → `247a667`） |
| open issue / open PR | **0 / 0** | **0 / 0** |
| vitest 用例 | 304（303 过 + 1 pty-skip） | **310**（309 过 + 1 pty-skip） |
| 包数量 / 环境 | 9 包 · Node `v24.16.0` · pnpm `11.22.0` · vitest 4.1.11 | 同 |
| 运行中的 dsh | 启动于 **2026-09-24 15:43:57 CST**（= 第十二轮 gen-20 重启的产物） | 同进程；本轮代码已构建进 `lib/`，gen-21 重启待执行（§18.5） |
| GitHub 侧扫描 | Dependabot alerts **关闭**、CodeQL **未配置** | Dependabot alerts + security updates **已开启**（§18.6） |

### 18.1 Issue 检查（step 1）——0 / 0，且**没有在途交付**

```text
gh issue list --state open                                     → 0
gh api "repos/StvLi/dsh-ros2/issues?state=open" --jq 'length'   → 0
gh pr    list --state open                                     → 0
git rev-list --left-right --count main...origin/main           → 0  0
```

与前两轮的关键差别：第十轮是"推了但没开 PR"、第十二轮是"开了 PR 但没合并"，
**本轮两者都没有**——`main` 与 `origin/main` 完全一致、工作树干净、无任何未闭环交付。
因此按 step 1 的分支条件**直接转 step 5**；step 2/3/4 不因 issue 触发
（step 3 的 git 纪律仍适用于本轮**自己发现**的修复，见 §18.3）。

**顺带核对第十二轮遗留的两条"仓库外"事项**（§18.7 第 2、3 条），确认它们**不在** issue 列表里，
属于维护文档记录的现场事项，因此不改变"0 open issue"的判定。

### 18.2 建议评估（step 2）——本轮无 issue，无外部建议可评

本轮无 open issue，故无外部建议需要判断合理性与必要性。作为替代，本节的"评估"对象是
**本轮安全扫描自己提出的 3 条发现**——即"自定议题"。按第十二轮 §17.2 的做法，
对**自己提出的议题同样逐条核验其真实性**，而不是只写结论：

| # | 本轮主张 | 核验方式 | 判定 |
| --- | --- | --- | --- |
| F1 | `ros2_install` 的 session id 可逃出 `$TMPDIR/dsh-ros2/pty` | 对 `origin/main` 的 helper **实跑** `send ../../victim/pwned`、`stop ../../victim/target`，看文件是否真的落在目录之外 | ✅ 真实（且 `stop` 是**截断写**） |
| F2 | `common`/`core`/`sidecar` 的 npm 包含 `__pycache__` 字节码 | `pnpm pack` 后 `tar -tzf` 逐包清点；再解析 `.pyc` 头与 `co_filename` | ✅ 真实（8 文件；含 1 个 STALE；含构建路径泄漏） |
| F3 | installer 的 leading-dash 会被 curl/wget 当选项解析 | 对**真实二进制**验证：`wget -q -O f "-wget-option-like-value"` → `--wait` 报错；再用 `-K<file>` 构造可用的 fetch+write | ✅ 真实（见 §18.4 证明 3） |

其中 F3 的核验过程**推翻了我自己的第一个假设**：`curl --config=FILE` 在 curl 8.5.0 上被判为
"unknown option"（`=` 形式不被接受），因此**看似不可利用**；改用 curl 的**贴值短选项** `-KFILE`
后构造成功。⇒ 记为"真实可利用"，既不当作误报丢掉，也不含糊地写成理论问题。

### 18.3 开发管理（git · step 3）

| PR | 分支名 | 提交 | 类型 | 说明 |
| --- | --- | --- | --- | --- |
| **#35** | `fix/pty-session-traversal` | `6dde230` | `fix(core)` | session id 路径穿越：共享 `isSafePathComponent` + Tool 层拒绝 + helper 权威校验 |
| **#36** | `fix/pyc-publish-surface` | `4b78731` | `fix(packaging)` | 三个包加 `"!**/__pycache__"`；CI 发布面闸门改为**遍历全部非 private 包**并新增"不得携带字节码"断言 |
| **#37** | `fix/installer-option-injection` | `29cf49e`（+ `68fae5c` 合并 `main`） | `fix(core)` | 安装器抓取改用 `--` 终止选项解析 |

- 三个分支均以 `fix/...` 前缀新开（语义 = 修复问题），均 `off main`；每个 PR 单独提交、单独 CI。
- **提交类型的诚实性**：#35 同时动了 `common`（共享规则）与 `core`（调用点）。按目录硬拆成两个提交
  没有意义——共享规则的**唯一消费者**就是这次的 session id 校验；故合为一个 `fix(core)` 提交，
  并在正文写明它是"把既有规则提升为共享谓词"。这是**有意识的合并**，不是切分失误。
- **#37 与 #35 触碰同一批文件**（`packages/core/src/tools.ts`、`packages/core/tests/tools.spec.ts`）。
  实测：`git merge main` **零冲突自动合并**（两者改的是同一文件的不同区域），合并后**重跑完整验收线全绿**
  （§18.4）——因此不是"靠运气"，而是有验证的。
- 三个 PR 均经 CI（Node 22 + 24）**全绿**后合入 `main`；合并后删除远端与本地分支。
- 收尾：`main = 247a667`，工作树干净，0 open issue / 0 open PR。

### 18.4 本地验收（全绿）＋ 三个可复现证明

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
rm -rf packages/*/lib          # 复刻 CI 的"干净 clone"起点
CI=true pnpm run typecheck     # 9 包 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run test          # 310 例（309 过 + 1 pty-skip）（exit 0）
CI=true pnpm run build         # 全部 Done（exit 0）
```

**用例分布（实测）**：common **57** + core **134**（133 过 + 1 skip）+ moveit 16 + profile 14 +
safety 10 + vision 43 + state 8 + dsh-ros2 28 = **310**；另 sidecar selftest **10 场景**（SELFTEST PASSED）。
第十二轮 304 → 本轮 **+6**（common +3：路径组件边界；core +2：会话 id 双层守卫；core +1：`--` 终止选项解析）。

**证明 1 ｜ F1：会话目录能被逃出，且 `stop` 是**截断写**（before/after，实跑 helper）**

```text
BEFORE（origin/main 的 helper）
  $ TMPDIR=/tmp/ptydemo python3 orig_pty.py send "../../victim/pwned" -- "INJECTED-BY-CALLER"
  exit=0
  $ ls  /tmp/ptydemo/victim/            → pwned.in          # 落在会话目录之外
  $ cat /tmp/ptydemo/victim/pwned.in    → INJECTED-BY-CALLER
  $ TMPDIR=/tmp/ptydemo python3 orig_pty.py send "/tmp/ptydemo/victim/abs" -- "ABS-WRITE"
  exit=0                                                     # 绝对路径同样逃出
  $ TMPDIR=/tmp/ptydemo python3 orig_pty.py stop "../../victim/target"
  stopped
  $ cat /tmp/ptydemo/victim/target.meta → state=stopping     # 原本是 SECRET-CONFIG（被截断）

AFTER（修好的 helper）
  sid='../../victim/pwned'        exit=2  unsafe session id …: only [A-Za-z0-9._-], no separator or '..'
  sid='/tmp/ptydemo/victim/abs'   exit=2  …
  sid='..' / 'a/b' / '.hidden' / '' → exit=2
  victim dir → 只有 target.meta，未被触碰
```

**证明 2 ｜ F2：字节码确实在发布物里，且 CI 旧闸门看不见 sidecar**

```text
$ for p in common core sidecar …; do pnpm pack … ; tar -tzf "$tgz" | grep -c 'pycache\|\.pyc'; done
  common pyc=1     core pyc=1     sidecar pyc=6     （其余包 0）

$ python3 - <common 的 .pyc>        # 解析头 + 嵌入式路径
  STALE: True                        # 头里的 mtime/size 与同包的 robot_profile.py 不一致
  co_filename: /home/stvli/Desktop/embody_agent_ws/dsh-ros2/packages/common/scripts/robot_profile.py

旧 CI 闸门的遍历面：for p in core profile moveit safety vision dsh-ros2    # + common
  ⇒ sidecar / dsh-ros2-state 从未被 pack，最严重的 6 个文件从未被检查

新闸门的反向断言（把 sidecar 的排除项撤掉后实跑）：
  ::error::sidecar tarball ships compiled Python:
  package/sidecar/__pycache__/{__init__,core,node,reducers_placeholder,selftest,server}.cpython-312.pyc
  GATE exit=1
```

**证明 3 ｜ F3：`-K<file>` 是可利用的 fetch+write 原语（before/after）**

```text
BEFORE（旧命令串），installer = "-K/tmp/f3demo/evil_curl.conf"
  $ curl -fsSL '-K/tmp/f3demo/evil_curl.conf' -o '<boot>' || wget …
  $ ls -l /tmp/f3demo/PWNED_BY_OPTION
    -rw-rw-r-- … 33 /tmp/f3demo/PWNED_BY_OPTION    # curl 读了调用者指定的 config，
                                                   # 按 config 里的 url+output 取回并写出
AFTER（新命令串，同一 installer）
  $ curl -fsSL -o '<boot>' -- '-K/tmp/f3demo/evil_curl.conf'
  curl: (6) Could not resolve host: -K
  NOT created — closed

对照：`--` 在真实二进制上均被遵守
  $ wget -q -O /tmp/x "-wget-option-like-value"     → wget: --wait: Invalid time period '…'   # 被当选项
  $ wget -q -O /tmp/x -- "-wget-option-like-value"                                            # 被当操作数
  $ cp -- /tmp/f3src.txt /tmp/f3cp                  → OK
回归：合法的本地安装器仍可用（copy + chmod，exit 0），PTY 交互测试照常通过。
```

### 18.5 dsh-phoenix 持续更新 / 测试链路（step 4）——第十二轮的未闭环观测**实测确认**，并请求 gen-21 重启

**① 第十二轮 §17.8 第 1 条（本轮唯一要复核的观测）：已闭环 ✅**

第十二轮把改动构建进 `lib/` 后请求了 gen-20 优雅重启，但**无法在同一进程内观测结果**，
故列为"下次维护第一复核项"。本轮起点进程启动于 `2026-09-24 15:43:57`，**正是 gen-20 重启的产物**
（journal 五环节齐全：`15:43:48 HARD defer deadline → scheduling restart (gen 20) → restart cmd exit=0
→ 15:43:49 Stopped → 15:43:57 Started → 15:44:00 loaded`），因此该观测**本轮可测**：

```text
ros2_vision_doctor → workspace.installDirs: ["/home/stvli/lite_delivery_aio/install"]   # 第十二轮是 []
                     apiKey.source "secrets" · plaintext false                           # 不再误报
                     （且不再出现"建议改用环境变量注入"的自相矛盾告警）
ros2_env_check     → setup.missingSources: ["/tmp/vlm_ws/install/setup.bash"]
                     note: "…已剔除该段，改用其余 1 段…建议修正配置。"
                     probe: { exitCode: 0, stderrTail: "" }                  # 自愈生效
                     bundles.stale false · drift 全 false · totalTools 81 · totalSkills 9
```

⇒ 第十二轮预言的两个可观测变化（`installDirs` 不再是 `[]`；`apiKey.plaintext` 对 `${VLM_API_KEY}`
注入应为 `false`）**逐字命中**。同时 `skillCatalogue` / `surface` / `missingSources` 等自述字段都在，
再次作为"进程新旧"的正向信号使用。

**② 本轮末端动作：请求 gen-21 优雅重启（journal 原文，非推断）**

改动已合入 `main` 并重建 `lib/`（实测 `lib/names.js` 含 `isSafePathComponent`、
`lib/tools.js` 含 `INVALID_SESSION` 与 `-- ${shq(installer)}`、`scripts/pty_session.py` 含 `safe_sid`），
随后按本 preset 的**文档化触发面**激活一个**惰性**动态包（`apply()` 空实现，不注册工具/事件/服务/UI；
它唯一的作用就是"让 `cordis_run` 发生"）：

```text
Sep 25 04:13:24  [dsh-phoenix] cordis tool: cordis_run
Sep 25 04:13:27  [dsh-phoenix] restart requested (gen 21): plugin-change
```

即 phoenix **看到了**这次激活并登记为**第 21 代**重启请求；与 gen-19/gen-20 走同一套
"软告警 5 分钟 / 硬期限 15 分钟 / policy auto" 生命周期（硬期限 ≈ `04:28:27`）。
本会话仍在运行，**重启后的现场无法在同一进程内观测**——如实列为 §18.8 第 1 条。

- **重启后可观测的变化（预期）**：本轮三处修复对**运行时**的影响分别是
  `ros2_install` 对非法 session id 直接返回 `INVALID_SESSION`（不再触碰文件系统）、
  新发布的 tarball 不含 `__pycache__`、安装器抓取带 `--`。
  其中**只有第一条**在当前会话的进程里可观测（另两条分别属于发布物与 `action=start` 路径）。
- **诚实边界**：`action=start` 在本机走不到（ROS2 已安装 ⇒ 直接 `already-installed`），
  所以 F3 的运行时表现**无法在活进程里演示**；F3 的证据是**真实二进制的 before/after**（§18.4 证明 3），
  这一点不夸大。

### 18.6 安全扫描（step 5）

**依赖漏洞**：

- `pnpm audit --prod --audit-level high --registry=https://registry.npmjs.org/` → **No known vulnerabilities found**（exit 0）。
- 本机默认源（`registry.npmmirror.com`）→ `ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`。**这不是"干净"，是"没查成"**，
  不可当作结论（CI 在 GitHub runner 上默认即官方源 ⇒ CI 闸门有效；只有本机需显式指定）。
  沿用第八/十/十二轮的同一结论。

**GitHub 侧扫描面（本轮重查并**改动）**：

| 面 | 本轮起点 | 本轮动作 | 含义 |
| --- | --- | --- | --- |
| Dependabot alerts | `404`（未开启） | **`PUT /vulnerability-alerts` → 已开启**（端点返回 `204`） | 从"无 GH 侧依赖告警"变为**有** |
| Dependabot security updates | `disabled` | **`PUT /automated-security-fixes` → `enabled`** | 可自动开安全更新 PR |
| 当前 Dependabot 告警数 | — | **0** | 无待处理告警 |
| Secret scanning | **`enabled`**（第十二轮未查，本轮新查） | 保持 | 与 push protection 一起构成密钥防线 |
| Secret scanning push protection | **`enabled`**（本轮新查） | 保持 | 推送期即拦截 |
| Secret scanning alerts | — | **`[]`** | 无告警 |
| Code scanning (CodeQL) | `404 — no analysis found` | **未改动** | 仍未配置；见 §18.8 第 3 条 |
| `secret_scanning_non_provider_patterns` / `validity_checks` | `disabled` | 未改动 | 非阻塞项 |

⇒ 第十二轮 §17.6 的结论"本仓库唯一的依赖安全闸门是 CI 那一条 `pnpm audit`"**本轮已不再成立**：
Dependabot alerts + security updates 已开启，纵深防御补上了一层。
同时**新增一条正向事实**：`secret_scanning` 与 `push_protection` **本来就是开启的**——
第十二轮只查了 Dependabot 与 CodeQL 就下了"GH 侧扫描为空"的结论，本轮把口径补全。

**静态扫描**（`packages/*/src` + `packages/*/scripts`）：

| 面 | 结果 |
| --- | --- |
| `eval(` / `new Function` / `vm.` | **0** |
| `shell: true` / `execSync` | **0** |
| `child_process.exec(` 的 16 处命中 | **全部是 `RegExp.prototype.exec`**（逐处核对），无命令执行 |
| `execFile` / `spawn` | 全部走 **argv 数组**；唯一的 `bash -lc` 在 `runner.ts:275`，其 `cmd` 由 `shq()` 逐参拼装 |
| Python `shell=True` / `os.system` / `pickle.load` / `yaml.load` | **0**；`subprocess` 全部 argv 数组 |
| `gui.ts` 的 `python3 -c` | 代码是**常量模板**，变量数据经 `env`（`SCREENSHOT_PATH`/`SCREENSHOT_CROP`）传入，**不拼接** |
| 硬编码密钥（工作树） | **0** |
| 硬编码密钥（**全 git 历史所有 blob**） | **0** |
| 包 `lifecycle` 脚本（pre/postinstall 等） | **9 个包全部 none**（无供应链安装期执行面） |
| `.gitignore` | 覆盖 `secrets.json` / `*.secrets.json` / `.env` / `lib/` / `node_modules/` / `__pycache__/`；`__pycache__` **未被 git 跟踪** |
| 既有防线回归 | 随测试全绿：`isSafeProfileName` / `safe_name()` 的 4 组穿越用例、`ros2_interface_create` 的 `PATH_ESCAPE`、`shq()` 单引号包裹、safety_monitor argv 数组、`ros2_install` 安装器转义 |
| 密钥文件处置 | `~/.dsh-ros2/secrets.json` 存在、mode **`600`**、仓库外、`files` 白名单不进 tarball；报告只回显 mode/exists/keyPresent，**从不回显密钥** |

**本轮新增面的评审（自己新引入的代码）**：

| 面 | 结论 |
| --- | --- |
| `isSafePathComponent`（#35） | **收紧**：把一个已存在的规则（profile 名）提升为共享谓词并**新增**一个消费者；`isSafeProfileName` 行为逐字符不变（同正则、同 `..` 检查），既有测试未改仍全绿 |
| `pty_session.py` 的 `safe_sid()`（#35） | **收紧**：在**文件系统调用点**再加一道，与 `robot_profile.py` 的 `safe_name()` 同构（fail-closed，exit 2） |
| `"!**/__pycache__"`（#36） | 只影响打包面；实测必需 `.py` 全部仍在（`robot_profile.py` / `pty_session.py` / `ros2_topology.py` / `sidecar/*.py`） |
| CI 发布面闸门（#36） | 只加断言、不改产物；`permissions: contents: read` 不变，仍无 `pull_request_target`、无 `${{ github.event.* }}` 注入面 |
| `--` 终止选项解析（#37） | **收紧**：参数顺序变化不影响合法输入（已用真实二进制 + 本地安装器回归验证） |

**结论：本轮发现并修复 3 处真实缺陷**；三处改动均为**收缩**攻击面，未引入新的输入源或执行面。
另：GitHub 侧由"无 GH 依赖告警"变为"已开启 Dependabot alerts + security updates"。

### 18.7 本轮发现（含仓库外的问题）

1. **【安全·已修·真实可利用】** **PTY 会话 id 路径穿越**（F1，PR #35）：`send`/`status`/`stop`
   **不需要审批**（只有 `start` 需要），因此一个普通工具调用即可让这三者落到**任意** `.in`/`.out`/`.meta`
   路径上，其中 `stop` 是**截断写**。已按"共享规则 + Tool 层 + helper 权威层"两层修复并加测试。
   **这条是本轮最重要的发现**：它不在任何 issue 里，是安全扫描自己撞见的。
2. **【部署配置·第四轮仍未修·仓库外】** `~/.dsh/profiles/web/cordis.patch.yml` 第 33/37/41/45/49 行
   仍以 `&& source /tmp/vlm_ws/install/setup.bash` 结尾，而 `/tmp/vlm_ws` **已不存在**
   （第 29 行注释写着"改用实际构建的交付工作区"——**注释改了、值没改**）。
   新代码的自愈本轮**再次实测有效**（剔除死段 + `note` 点名 + `probe.exitCode = 0`），故**不是当前故障**，
   代价只是每次调用多一次 `existsSync` 与一段告警噪声；此外 `workspace.root` 仍报 `(未配置)`。
   **本轮仍不擅自修改**，理由比第十二轮更明确：它在**仓库外**、属于**运行中的部署**、
   改动需**重启**才生效，而本轮被要求维护的是**仓库**。两条既有证据支持"先不动"：
   自愈已使其**非故障**；且此前两轮已**有意**记录过"不擅自修改"的决定，单方面改变该决定不合适。
   → **给出可直接执行的一行修法**（§18.8 第 2 条）。
3. **【本机·未解释·延续】** `2026-09-24 15:11:04` 那次 `dsh-web` 重启在 journal 中**仍无成因记录**
   （零间隔，非 phoenix 的 `stop; sleep 8; start`）。本轮**新增一条观测**：该次重启直接导致
   12 日 04:00 的定时维护被跳过、以 `overdue: true` 在 15:11:11 补跑；
   而**本轮**（13 日 04:00）是**准点**起跑的，说明这一轮没有再被同类事件顶掉。成因仍如实记为**未解释**。
4. **【发布面·已修·CI 盲区】** CI 的 tarball 闸门**只遍历一份手写子集**，
   导致 `sidecar`（6 个 `.pyc`，最严重）与 `dsh-ros2-state` **从未被 pack、从未被检查**。
   本轮把闸门改为**遍历全部非 private 包**并新增"不得携带字节码"的**反向断言**——
   原闸门只断言"必须存在什么"，从不检查"不得存在什么"，这正是 8 个文件得以长期发布的原因。
5. **【安全·已修·低危但真实】** **安装器选项注入**（F3，PR #37）。**诚实定级**：
   调用者是 agent 自身、`action=start` 需审批、且**本机 ROS2 已安装时该路径根本走不到**
   （直接 `already-installed`），因此**不是活漏洞**，而是与第五/六轮同类别的加固。
   记录为"真实可利用但 reach 很窄"，不抬高也不淡化。
6. **【正面事实·第十二轮口径修正】** `secret_scanning` 与 `secret_scanning_push_protection`
   **本来就是开启的**（告警 `[]`）。第十二轮 §17.6 只查了 Dependabot 与 CodeQL 就写下
   "GitHub 侧扫描面为空"，本轮把口径补全——**这是对上一轮结论的修正，不是上一轮的错误**。
7. **【时间口径】** 本节标题用**本地时间（CST）**，git / CI / journal / 任务历史为 **UTC**：
   本轮 `09-25 04:13 CST` = `09-24 20:13 UTC`。

### 18.8 结论与下一步建议

- **交付**：PR **#35**（会话 id 路径穿越）、**#36**（发布面字节码 + CI 闸门）、**#37**（安装器选项注入）
  全部 CI 绿（Node 22/24）并合入 `main`（`247a667`）；**open issue / open PR 归零**；
  用例 **304 → 310**；远端与本地分支已清理。
- **线上价值**：① 一个**未审批即可触达**的任意 `.in`/`.out`/`.meta` 读写（含截断）被关掉；
  ② 发布物不再携带**评审看不见**、**携带构建路径**、且其中一个**与源码不一致**的字节码，
  且 CI 现在会**拦住**这一整类；③ 安装器抓取不再可能把调用者值当选项解析。
- **末端动作**：改动已构建进 `lib/`，并按文档化触发面激活惰性动态包，**已确认** phoenix 登记
  `gen 21` 重启请求（`04:13:27`，硬期限 ≈ `04:28:27`）；由 phoenix 在会话空闲的安全点执行优雅重启。
- **GitHub 侧**：Dependabot alerts 与 security updates **本轮已开启**（此前关闭）。
- **下次维护建议**：
  1. **复核 gen-21 重启后的现场**（本轮唯一未闭环观测）：确认 `ros2_install` 对非法 session id
     返回 `INVALID_SESSION`；以及"重启后才有"的自述字段仍在（正向信号）。
  2. **改配置**（§18.7 第 2 条，**已连续第四轮记为"仍未修"**）：删掉
     `~/.dsh/profiles/web/cordis.patch.yml` 里 5 处 `/tmp/vlm_ws` 死段（第 33/37/41/45/49 行），
     然后优雅重启。**这是唯一一个跨四轮未被处理的事项**，建议优先；若下次维护仍不处理，
     应考虑把它**升级为一个 issue**，以免继续只躺在维护文档里。
  3. **考虑配置 CodeQL**：Dependabot 已开，但静态分析仍无基线；本仓库 TS + Python 混合，
     值得给 `packages/*/src` 与 `packages/*/scripts` 建一条 code scanning 工作流。
  4. **盯住定时任务的可靠性**（第十二轮 §17.7 第 1 条）：近两周多数运行因 30 分钟上限失败；
     本轮**准点起跑且未超时**，但沿用第十二轮的规程——**先落地、再记录**
     （本轮范式：3 个小 PR 各自合并 → 文档最后写并立即推送）。
  5. 维持验收线：**推送前** `typecheck + test + build` 全绿、**推送后立刻开 PR 并等 CI 绿再合并**、
     `pnpm audit` 必须带 `--registry=https://registry.npmjs.org`（本机）。

---

## 19. 维护记录（2026-09-26 04:00 CST / UTC 2026-09-25 20:00 · 第十四轮：0 open issue / 0 open PR → 走"无 issue → step 5 安全扫描"；先闭环第十三轮唯一的未闭环观测（gen-21），再落地 3 个 PR = 明文传输的 VLM API Key 可见化 · 插件自建 IPC 对象权限收紧（PTY 会话文件 / sidecar UDS / 抓取到的安装器脚本）· Dependabot 版本更新；并把跨五轮未处理的部署配置项升级为 issue #40）

> 本轮结论：起始 **0 open issue / 0 open PR**、`main` 与 `origin/main` 一致、工作树干净
> ⇒ 按 step 1 的分支条件**干净地走 step 5**，与第十/十二轮那种"在途交付"不同。
> 与第十三轮的关键差别在**看问题的角度**：第十三轮在同一批文件里发现了"会话 id 可以**逃出**会话目录"
> （路径穿越），本轮在**同样的对象**上换了一个维度——"插件**自己创建**的 IPC/状态对象**权限有多宽**"——
> 结果 4 处权限都由 umask 派生，其中 1 处**世界可写**、而它正是**一个 sudo 进程的 stdin**。
> 另外本轮**如实记录一次自己的流程事故**（两个提交一度落到了 `main` 上，见 §19.3）与
> **一次 CI 抓出、本地看不见的真实回归**（§19.4）——两者都不是"顺利"，但都是本轮的真实内容。
> 结束：`main = bc6abd8`、**1 open issue（本轮有意新开的 #40）** / **0 open PR**；用例 **310 → 323**。

### 19.0 仓库快照（本轮起始/结束）

| 项 | 起始 | 结束 |
| --- | --- | --- |
| 当前分支 | `main`（工作树干净） | `main` = **`bc6abd8`**（本地与 `origin/main` 一致） |
| `main` | `f5cbebf`（第十三轮 docs） | `81c34ab`（#38）→ `1024df1`（#39）→ `bc6abd8`（#41） |
| open issue / open PR | **0 / 0** | **1 / 1**（#40 是本轮**有意新开**的跟踪项；PR **#42** 是本轮新增的 `dependabot.yml` **生效后由 Dependabot 自动开出**的第一个 PR —— 见 §19.7 第 6 条） |
| vitest 用例 | 310（309 过 + 1 pty-skip） | **323**（322 过 + 1 pty-skip） |
| sidecar selftest | 10 场景 | **11** 场景（新增 UDS 权限断言） |
| 包数量 / 环境 | 9 包 · Node `v24.16.0` · pnpm `11.22.0` · vitest 4.1.11 | 同 |
| 运行中的 dsh | 启动于 **2026-09-25 04:25:40 CST**（= 第十三轮 gen-21 重启的产物，MainPID 1698096） | 同进程；本轮改动已构建进 `lib/`，gen-22 重启待执行（§19.5） |
| GitHub 侧扫描 | Dependabot alerts 已开（0 告警）、secret scanning + push protection 已开、CodeQL 未配置、**无 `dependabot.yml`** | 前三项不变；**新增 `.github/dependabot.yml`**（#41） |

### 19.1 Issue 检查（step 1）——0 / 0，且**先闭环上一轮的预言**

```text
gh issue list --state open                                     → 0
gh api "repos/StvLi/dsh-ros2/issues?state=open" --jq 'length'   → 0
gh pr    list --state open                                     → 0
git rev-list --left-right --count main...origin/main           → 0  0
git status --porcelain                                         → （空）
```

第十三轮的 §18.8 把两条"仓库外"事项列入"下次维护建议"。本轮逐条处理，**结论是：一条闭环、一条升级**：

| 第十三轮遗留项 | 本轮处置 | 结果 |
| --- | --- | --- |
| 复核 **gen-21 重启后**的现场（唯一未闭环观测） | 读 journal + 实测运行时 | ✅ **闭环**（§19.5）：journal 五环节齐全，且预言的两个可观测变化**逐字命中** |
| `~/.dsh/profiles/web/cordis.patch.yml` 的 5 处 `/tmp/vlm_ws` 死段（已连续四轮"仍未修"） | 按第十三轮自己的建议**升级为 issue** | ✅ **已开 issue #40**（§19.7 第 1 条）；配置本身**仍未改动**，理由见该 issue |

⇒ 本轮**结束时有 1 个 open issue**，但这是**有意的状态**，不是漏判：`#40` 记录的是一个
**仓库外**、需要**运维决定**才能改的运行中部署配置，把它留在 issue 列表里正是为了让它进入
"下次维护 step 1 → 有 issue → 转 step 2"的正规回路，而不是继续只躺在本文档里。

### 19.2 建议评估（step 2）——本轮无外部 issue，故评估**自己提出的** 5 条

本轮无 open issue，step 2 没有外部建议可评。沿用第十二轮 §17.2 的做法：对**自己提出的**
每一条主张**逐条核验其真实性**，而不是只写结论——核查方式与判定如下。

| # | 本轮主张 | 核验方式（实证，非推断） | 判定 |
| --- | --- | --- | --- |
| F1 | VLM API Key 会以**明文**经过网络，且 doctor 完全没提这件事 | ① 读 `vision.ts` 确认 openai provider 用 `Authorization: Bearer`、gemini 用 `?key=`；② **实跑** `ros2_vision_doctor` 取到线上 `apiKey.baseUrl`；③ 确认该 URL 是非回环 `http://`；④ 全仓库 grep `https\|cleartext\|tls` 确认**没有任何** scheme 检查 | ✅ 真实且**当前正在发生** |
| F2 | PTY 会话目录/文件权限由 umask 派生，`<sid>.in` 可被同组写 | 用 **`origin/main` 的原版 helper** 在 `umask 000` 下**实跑** `start`，`stat` 结果 | ✅ 真实（`-rw-rw-rw-`，**世界可写**） |
| F3 | sidecar 控制面 UDS 权限同样由 umask 派生，而协议**无鉴权** | 读 `server.py`（`bind()` 无 chmod、协议无 auth）+ 实测 AF_UNIX 建socket 的模式（本机 umask 0002 → `775`）+ 确认其用**写权限**判定 `connect()` | ✅ 真实（本地可利用面窄，见下） |
| F4 | `ros2_install` 抓到的安装器脚本组可写，而它**会被执行** | 读 `buildRos2InstallDownloadCommand`：`chmod +x` 不限制 group/other 读 | ✅ 真实（同类，低危） |
| H1 | Dependabot alerts 已开，但**没有版本更新**（缺 `dependabot.yml`） | `find .github -type f` → 只有 `workflows/ci.yml`；workflow 里 Actions 用的是**可变大版本 tag** | ✅ 真实（加固项） |

**诚实定级（不抬高也不淡化）**：F2/F3/F4 都**依赖 umask**、且都是**本机/同组**范围，
在当前这台单用户桌面上的实际影响**很小**——所以本轮**没有**把它们写成"高危漏洞"。
之所以仍然修，是因为受影响的对象是**一个 sudo 进程的 stdin** 和 **世界可写 `/tmp` 里的可预测路径**，
而且"权限取决于 umask"恰恰是那种**会悄悄失效**的保证。F1 是**唯一一条当前正在发生**的
凭证暴露面，因此单独立 PR（#38）。

### 19.3 开发管理（git · step 3）

| PR | 分支名 | 提交 | 类型 | 说明 |
| --- | --- | --- | --- | --- |
| **#38** | `fix/vision-cleartext-key` | `81c34ab`（squash） | `fix(vision)` | 新增 `classifyVisionTransport()`；doctor 报 `apiKey.transport` 并对 http+非回环**告警** |
| **#39** | `fix/ipc-object-permissions` | `1024df1`（squash，含 2 个提交） | `fix(core)` + `fix(sidecar)` | PTY 目录/文件 0700/0600 + 安装器脚本 `umask 077`/`chmod 700`；sidecar UDS 0600 |
| **#41** | `ci/dependabot-version-updates` | `bc6abd8`（squash） | `ci(deps)` | 新增 `.github/dependabot.yml`（github-actions + npm，weekly） |

- 三个分支均以语义前缀新开（`fix/...` = 修复、`ci/...` = 构建/CI），均 `off main`；每个 PR 单独 CI。
- **#39 为什么是两个提交**：#39 同时动 `core`（PTY + 安装器）与 `sidecar`（UDS）。两者是**两个包、
  两个不同的 IPC 对象**，拆成两个 `fix(<pkg>)` 提交能让 `git log`/`bisect` 按包定位；这**不是**
  切分失误，而是有意的（对比第十三轮 §18.3 把 `common`+`core` **合并**成一个提交，理由同样写在正文里）。
- **F1 为什么只告警、不阻断**：gateway 地址属于**运维的部署**，静默拒发会**破坏一个可用配置**
  而不是描述它。这与仓库既有 `apiKeyPlaintext` 告警同一形状；修法写在告警正文里（换 https 或改回环）。

**本轮如实记录一次流程事故：两个提交一度落到了 `main` 上。**

- 经过：`gh pr merge 38` 会**自动把本地切回 `main`**。执行它时，#39 的改动**还是未提交的工作树修改**；
  `git checkout main` 把它们带了过去，`git pull --ff-only` 成功，随后 `git commit` 就把
  `fix(core)` / `fix(sidecar)` **提交到了本地 `main`**。
- 影响面：**远端 `main` 未被推送**（本地 `main` 仅 "ahead 2"），因此**没有绕过 PR/CI**；
  但当时 `git push origin fix/ipc-object-permissions` 推的是**仍指向 `f5cbebf` 的旧分支**，
  于是 `gh pr create` 报 `No commits between main and fix/ipc-object-permissions`——**这个错误暴露了事故**。
- 修正：`git branch -f fix/ipc-object-permissions 44d4e94`（把提交归位到分支）→
  `git branch -f main origin/main`（`main` 退回远端）→ 重新 push（快进）→ 开 PR #39。
- 教训：`gh pr merge` 会切分支，**合并前必须先提交或 stash**；并且"`gh pr create` 报 no commits"
  应当**先怀疑分支/提交位置**，而不是怀疑分支名。

### 19.4 本地验收 + 一次"本地绿、CI 红"的真实回归（含一个本地**结构性盲区**）

**#39 的首跑 CI 红了**，而本地三件套全绿：

```text
FAIL tests/tools.spec.ts > ros2_install interactive flow (mock installer, no network)
     > start -> send -> status -> stop drives the installer menus via PTY
AssertionError: expected '' to contain '安装完成'
```

- **真因（我自己引入的）**：`open_private()` 的第一版对 append 模式也加了 `O_TRUNC`。
  而 `open(path, "ab")` **不截断**。于是每次 `send` 都把 `.in` 清空——而 daemon **持有自己的读偏移**，
  截断后写入的数据可能落在该偏移**之后**、**永远读不到**；安装器因此走不到 `安装完成`。
- **为什么本地是绿的（这是本轮最有价值的一条结构事实）**：

  ```text
  $ python3 -c 'import pty; pty.openpty()'
  OSError: out of pty devices
  $ mount | grep devpts
  devpts on /dev/pts type devpts (rw,nosuid,noexec,relatime,gid=5,mode=620,ptmxmode=000)
  ```

  本机 `devpts` 以 **`ptmxmode=000`** 挂载 ⇒ `ptyUsable = false` ⇒ 用例里的
  `it.skipIf(!ptyUsable)` 让**整条 PTY 交互链被 skip**（本地 `135 passed | 1 skipped`），
  而 CI（ubuntu runner）能分配 pty，所以**CI 是这条链唯一的大门**。
- **修正**：恢复 per-mode 语义（`"a"` → `O_APPEND`，不截断；`"w"` → `O_TRUNC`），
  **并且补一个不需要 pty 的回归测试**：直接驱动 `open_private()`，断言 append **保留**内容、
  `"w"` **仍然**截断、文件仍是 `0600`。这样**同一类回归在这台无法分配 pty 的机器上也会红**。
  该缺陷由此从"只有 CI 能看见"变成"本地也能看见"。

最终验收（`main`，包含 #38+#39，自 `rm -rf packages/*/lib` 起）：

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
rm -rf packages/*/lib            # 复刻 CI 的"干净 clone"起点
CI=true pnpm run typecheck       # 9 包 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run test            # 323 例（322 过 + 1 pty-skip）（exit 0）
CI=true pnpm run build           # 全部 Done（exit 0）
```

**用例分布（实测）**：common **57** + core **137**（136 过 + 1 skip）+ moveit 16 + profile 14 +
safety 10 + vision **53** + state 8 + dsh-ros2 28 = **323**；另 sidecar selftest **11 场景**（SELFTEST PASSED）。
第十三轮 310 → 本轮 **+13**（vision +10：7 条 transport 纯函数 + 3 条 doctor 传输面；
core +3：PTY 权限模式、append 语义回归、安装器脚本模式）。

### 19.5 dsh-phoenix 持续更新 / 测试链路（step 4）——第十三轮的未闭环观测**逐字命中**，并请求 gen-22

**① 第十三轮 §18.8 第 1 条（其唯一未闭环观测）：已闭环 ✅**

第十三轮在 `04:13:27` 登记了 `gen 21` 重启请求（硬期限 ≈ `04:25:27`），但**无法在同一进程内观测结果**。
本轮起点进程启动于 **2026-09-25 04:25:40 CST**（MainPID 1698096）——**正是 gen-21 的产物**：

```text
Sep 25 04:13:24  [dsh-phoenix] cordis tool: cordis_run
Sep 25 04:13:27  [dsh-phoenix] restart requested (gen 21): plugin-change
Sep 25 04:18:27  [dsh-phoenix] soft defer deadline reached; agent still busy —
                  restart will be forced at the hard deadline (policy=auto)
Sep 25 04:25:27  [dsh-phoenix] agent idle; executing deferred restart (gen 21)
Sep 25 04:25:27  [dsh-phoenix] scheduling restart (plugin-change, gen 21): systemd-run … stop; sleep 8; start
Sep 25 04:25:27  [dsh-phoenix] restart cmd exit=0
Sep 25 04:25:32  systemd: Stopped dsh-web.service
Sep 25 04:25:40  systemd: Started dsh-web.service
Sep 25 04:25:42  [dsh-phoenix] loaded (graceful restart + client reconnect + lifecycle)
```

⇒ 与 gen-19/gen-20 **同一套生命周期**（软告警 5 分钟 → 硬期限前执行 → 停 8 秒 → 起 → loaded），
**五环节齐全**。第十三轮预言的两个可观测变化本轮**实测命中**：

```text
ros2_install action=send session="../../victim"
  → { ok:false, code:"INVALID_SESSION", message:"非法会话 id ../../victim：只允许字母/数字/._-…" }
     # 第十三轮 PR #35 的修复在活进程里生效；且它不再触碰文件系统（第十三轮证明过 before/after）

ros2_vision_doctor → workspace.installDirs: ["/home/stvli/lite_delivery_aio/install"]  # 第十二轮是 []
                     apiKey: { source:"secrets", keyConfigured:true, plaintext:false }  # 不再误报
ros2_env_check     → bundles.stale:false · drift 全 false · totalTools 81 · totalSkills 9
                     skillCatalogue.complete:true · missing:[]        # 正向信号齐全
                     setup.missingSources:["/tmp/vlm_ws/install/setup.bash"] · probe.exitCode:0  # 自愈仍有效
```

**② 本轮末端动作：请求 gen-22 优雅重启**

本轮 3 个 PR 已合入 `main` 并重建 `lib/`（`pnpm run build` exit 0；实测 `core/lib/tools.js` 含
`umask 077`/`chmod 700`、`core/scripts/pty_session.py` 含 `ensure_private_dir`/`open_private`、
`vision/lib/transport.js` 存在且 `vision/lib/tools.js` 含 `classifyVisionTransport`、
`sidecar/server.py` 含 `chmod 0o600`），随后按本 preset 的**文档化触发面**激活一个**惰性**动态包
（`apply()` 空实现：不注册工具/事件/服务/UI；唯一作用就是"让 `cordis_run` 发生"）：

```text
Sep 26 04:19:37  [dsh-phoenix] cordis tool: cordis_run
Sep 26 04:19:40  [dsh-phoenix] restart requested (gen 22): plugin-change
```

即 phoenix **看到了**这次激活并登记为**第 22 代**重启请求（journal 原文，非推断），
与 gen-19/20/21 走同一套"软告警 5 分钟 / 硬期限前执行 / policy auto"生命周期。
本会话仍在运行，**重启后的现场无法在同一进程内观测**——如实列为 §19.8 第 1 条。

- **重启后可观测的变化（预期）**：`ros2_vision_doctor` 的 `apiKey.transport` 字段**新出现**，
  且对本机当前配置（`http://121.9.219.138:8888/v1`）应**报 `cleartext: true` 并带告警**——
  这是本轮唯一能**在同一会话重启后直接验证**的运行时变化，已列为 §19.8 第 1 条。
- **诚实边界**：F2/F3/F4（权限类）**在活进程里不可观测**——它们影响的是**新创建**的文件/套接字，
  而本轮没有新建 PTY 会话（`action=start` 需审批，且本机 ROS2 已安装 ⇒ 直接 `already-installed`）。
  其证据是**真实 helper 的 before/after 实测**（§19.6）与**测试断言**，这一点不夸大。

### 19.6 安全扫描（step 5）

**依赖漏洞**：

- `pnpm audit --prod --audit-level high --registry=https://registry.npmjs.org/` → **No known vulnerabilities found**（exit 0）。
- 本机默认源（`registry.npmmirror.com`）→ `ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`。**这不是"干净"，是"没查成"**，
  不可当作结论；CI 在 GitHub runner 上默认即官方源 ⇒ CI 闸门有效。沿用第八/十/十二/十三轮同一结论。

**GitHub 侧扫描面（本轮重查）**：

| 面 | 本轮结果 | 与第十三轮对比 |
| --- | --- | --- |
| Dependabot alerts | **已开启**（`GET /vulnerability-alerts` → `204`），开放告警 **0** | 保持（第十三轮开启） |
| Dependabot security updates | `enabled: true`, `paused: false` | 保持 |
| **Dependabot 版本更新** | 第十三轮为**无**（`.github/` 只有 `workflows/ci.yml`） | **本轮补上**（#41 新增 `dependabot.yml`，两生态 weekly） |
| Secret scanning | **enabled**，开放告警 **0** | 保持 |
| Secret scanning push protection | **enabled** | 保持 |
| `secret_scanning_non_provider_patterns` / `validity_checks` | `disabled` / `disabled` | 未改动（非阻塞项） |
| Code scanning (CodeQL) | **`404 — no analysis found`** | 未改动；见 §19.8 第 3 条 |

**静态扫描**（本轮覆盖面**扩大**到第十三轮未列的目录）：

| 面 | 结果 |
| --- | --- |
| `eval(` / `new Function` / `vm.` | **0** |
| `shell: true` / `execSync` | **0** |
| `child_process.exec(` 命中 | 全部是 `RegExp.prototype.exec`（逐处核对） |
| `execFile` / `spawn` | 全部走 **argv 数组**（`runner.ts:37/395`、`core/tools.ts:177`、`gui.ts:364`） |
| `bash -lc` 的 4 个调用点 | ① `runner.ts:275`：`cmd` 由 `args.map(shq)` 逐参拼装；② `gui.ts`：**常量模板** + 变量经 `env`（`SCREENSHOT_PATH`/`SCREENSHOT_CROP`）传入；③ `core/tools.ts` probe：**纯常量字符串**；④ `process_cleanup`：`bracket` 自带 `'` → `'\''` 转义且整体单引号包裹，`signal` 先过 `KILL_SIGNAL_RE` 再 `shq()` |
| Python `shell=True` / `os.system` / `pickle` / `yaml.load` | **0**——本轮覆盖面**新增** `packages/sidecar/sidecar/**`、`packages/safety/safety/**`、`packages/vision/vlm/**`（第十三轮只扫了 `packages/*/scripts`） |
| Python `subprocess.*` | 全部 **argv 数组**（含 `safety_monitor` 的 `["timeout", …, "ros2","topic","echo", topic, "--once"]`、`image_snapshot.py` 的 `["ffmpeg","-f","v4l2",…]`） |
| 硬编码密钥（工作树） | **0**（`sk-…` / `AIza…` / `ghp_…` / `xox…` / `BEGIN PRIVATE KEY`） |
| 硬编码密钥（**全 git 历史、全分支所有 blob**） | **0**（逐 blob 扫描，实测 `total blobs with secret-like content: 0`） |
| 包 `lifecycle` 脚本 | **9 个包 + root 全部 none**（无安装期执行面） |
| `.gitignore` | 覆盖 `secrets.json` / `*.secrets.json` / `.dsh-ros2/` / `.env` / `lib/` / `node_modules/` / `__pycache__/` |
| 密钥文件处置 | `~/.dsh-ros2/secrets.json`：mode **`600`**、**仓库外**（实测 `readlink -f` 不在仓库内）、不在 `files` 白名单；`ros2_vision_set_key` 返回体为 `{stored, source, path, mode, hint}`——**只回 mode，从不回显密钥** |

**本轮新增面的评审（自己新引入的代码）**：

| 面 | 结论 |
| --- | --- |
| `classifyVisionTransport()`（#38） | **纯函数、全定义域**（空/畸形 URL 返回"无 scheme、无风险"而非抛错——doctor 不能因坏配置而失败）；回环判定含整个 `127.0.0.0/8` 与 `[::1]`；**只读**，不改变任何请求行为 |
| doctor 的 transport 告警（#38） | 只**新增**一个数据字段与一条 `warnings` 条目；**不改**调用路径、不改失败语义 |
| `ensure_private_dir()` / `open_private()`（#39） | **收紧**：只改新创建对象的 mode；**不改**读写内容（append 语义已按 `open()` 逐 mode 对齐并补测试） |
| 安装器 `umask 077` + `chmod 700`（#39） | **收紧**：脚本仍可执行（同 uid），`--` 终止选项解析的既有保证不变；既有 quoting 测试**无需改动仍全绿** |
| sidecar UDS `chmod 0600`（#39） | **收紧**：best-effort（OSError 忽略），平台不支持 chmod 时服务器照常工作 |
| `.github/dependabot.yml`（#41） | **只增不改**：Dependabot **只开 PR**，每个 PR 仍须过同一条 CI（typecheck+test+build+发布面闸门）才能进 `main`，**不新增**任何绕过人工审查的路径；`permissions: contents: read` 不变 |
| 既有防线回归 | 随测试全绿：`isSafePathComponent`/`safe_name()` 穿越用例、`ros2_interface_create` 的 `PATH_ESCAPE`、`shq()` 单引号包裹、safety_monitor argv 数组、PTY 会话 id 双层守卫 |

### 19.7 本轮发现（含仓库外的问题）

1. **【仓库外·已升级为 issue #40·仍未改】** `~/.dsh/profiles/web/cordis.patch.yml` 第 33/37/41/45/49 行
   仍以 `&& source /tmp/vlm_ws/install/setup.bash` 结尾，而 `/tmp/vlm_ws` **已不存在**
   （第 29 行注释写着"`/tmp/vlm_ws` 已删除，改用实际构建的交付工作区"——**注释改了、5 个值没改**）。
   **本轮不再只写进文档**（这已是连续第五轮）：按第十三轮 §18.8 第 2 条自己的建议，
   **升级为 issue #40**，附上实测证据与一行修法，让它在 issue 列表里被 step 1 捡起。
   代价仍只是每次调用多一次 `existsSync` 与一段告警噪声（自愈本轮**再次实测有效**：
   `missingSources` 有值、`probe.exitCode = 0`、`note` 点名），**不是当前故障**。
   **本轮仍不擅自修改**，理由与该 issue 正文一致：文件在**仓库外**、属于**运行中的部署**、
   改动需**重启**才生效，而本轮被要求维护的是**仓库**。
2. **【安全·已修·真实且正在发生（#38）】** **VLM API Key 明文过网**。openai provider 用
   `Authorization: Bearer <key>`、gemini 用 `?key=`，而线上 `vision.baseUrl` 是
   **`http://121.9.219.138:8888/v1`（非回环、公开地址）**⇒ 每次 `ros2_vision_describe` /
   `ros2_vision_analyze` 都把密钥交给路径上的任何中间设备；而 doctor 把该网关报成
   "reachable / HTTP 200"的**健康**状态，**没有任何一处**看过 scheme。
   **这条是本轮最重要的发现**：它不在任何 issue 里，是安全扫描自己撞见的，且**不是理论问题**。
3. **【安全·已修·umask 派生（#39）】** **插件自建的 IPC/状态对象权限过宽**，一处**世界可写**：
   - **PTY 会话文件**：`<sid>.in` 是**被驱动进程的 stdin**（此流程 = 带 sudo 的鱼香ROS安装器）。
     用 `origin/main` 原版 helper 在 `umask 000` 下实跑：`drwxrwxrwx`（目录）与
     `-rw-rw-rw-`（`.in`/`.meta`）⇒ 修后 **0700 / 0600**。
   - **sidecar 控制面 UDS**：`bind()` 的 mode 由 umask 派生，默认路径 `/tmp/dsh-ros2-sidecar.sock`
     在**世界可写目录**；AF_UNIX 以**写权限**判定 `connect()`，而协议**无鉴权** ⇒ 同组用户可读语义缓存。修后 **0600**。
   - **抓取到的安装器脚本**：`chmod +x` 不限制 group/other ⇒ 改为 `umask 077` + `chmod 700`；
     该脚本**会被执行**，组可写即"取回与执行之间可被换掉"的窗口。
   **诚实定级**：三者都**依赖 umask、且是本机/同组范围**，单用户桌面上影响很小 ⇒ 记为**加固**，
   不记为"活漏洞"。
4. **【流程·自曝·已修正】** **一次分支/提交位置事故**（§19.3）：`gh pr merge` 自动切回 `main` 时，
   #39 的改动尚未提交而**随之落到 `main`**。**远端未被推送、未绕过 PR/CI**；
   由 `gh pr create` 报 `No commits between …` 暴露，已用 `git branch -f` 归位并重开 PR。
5. **【本地盲区·已补测试】** **本机无法验证 PTY 交互链**：`devpts` 以 `ptmxmode=000` 挂载
   ⇒ `ptyUsable=false` ⇒ 整条用例在本机 skip，**CI 是唯一大门**。这正是 #39 首跑"本地绿、CI 红"的成因。
   已补一条**不需要 pty** 的回归测试（直接驱动 `open_private()`），使同类回归本机也能红。
   **这是本轮新增的结构性认知**：今后的验收线不能默认"本地全绿 = 全部被覆盖"。
6. **【供应链·已修（#41）】** Dependabot **告警**已开但**版本更新**未开（缺 `dependabot.yml`）；
   且 workflow 里 Actions 用的是**可变大版本 tag**（`actions/checkout@v7` 等），
   上一次升级（`618bdbe`）是手工提交的。已补 `dependabot.yml`（两生态 weekly）。
   **未采纳**"pin 到完整 commit SHA"：那是更强的姿态但维护成本不同量级，宜与自动化配套后再单独决定。
   **有效性已当场验证**：`dependabot.yml` 合入（`bc6abd8`，20:18 前后）后 **数分钟内**
   Dependabot 就自动开出了第一个 PR —— **#42 `chore(deps): bump @deepseek-ai/cordis from 4.0.1 to 4.0.4`**
   （`dependabot/npm_and_yarn/…`，20:19:51）。即配置**不只是"加了个文件"，而是真的产生了 PR 流**。
   本轮**不代为合并** #42：依赖升级应由 CI 绿 + 人工过一眼后合入，这正是 §19.8 第 4 条要观察的内容。
7. **【时间口径】** 本节标题用**本地时间（CST）**，git / CI / journal / 任务历史为 **UTC**：
   本轮 `09-26 04:00 CST` = `09-25 20:00 UTC`。

### 19.8 结论与下一步建议

- **交付**：PR **#38**（明文密钥可见化）、**#39**（IPC 对象权限）、**#41**（Dependabot 版本更新）
  全部 CI 绿（Node 22/24）并合入 `main`；3 个分支（本地+远端）已清理；
  **0 open PR（截至本轮 3 个 PR 合并完毕时）**；**1 open issue（#40，本轮有意新开）**；
  用例 **310 → 323**；sidecar selftest 10 → 11。
  **补充（本轮末尾新增）**：`dependabot.yml` 一经合入，Dependabot 在数分钟内自动开出 **PR #42**，
  因此**结束时 open PR = 1**——这是**本轮配置生效的正常产物**，不是未完成的交付（见 §19.7 第 6 条）。
- **线上价值**：① 一处**当前正在发生**的凭证暴露面（VLM Key 明文过网）从"静默健康"变为
  **上报并可告警**；② 插件自建的 IPC/状态对象不再继承 umask——其中包括**一个 sudo 进程的 stdin**
  与 **`/tmp` 里的可预测套接字**；③ 供应链从"只有告警"补到"**有版本更新**"。
- **末端动作**：改动已构建进 `lib/`，并按文档化触发面激活惰性动态包，**已确认** phoenix 登记
  `gen 22` 重启请求（`04:19:40`，journal 原文）；由 phoenix 在会话空闲的安全点执行优雅重启。
- **下次维护建议**：
  1. **复核 gen-22 重启后的现场**（本轮唯一可闭环的运行时观测）：确认 `ros2_vision_doctor`
     新出现 `apiKey.transport`，且对本机配置报 **`cleartext: true` + 告警**（§19.5）。
  2. **处理 issue #40**（部署配置的 5 处 `/tmp/vlm_ws` 死段）：这是唯一一条**已经跨五轮**的事项，
     本轮已把它从"文档备注"升级为 **issue**，因此它会自动进入下次 step 1 的判定——
     **要么修（一行 ×5 + 优雅重启），要么明确以"不改"关闭**，不要再悬着。
  3. **考虑配置 CodeQL**（第二轮提出）：Dependabot 两半（告警 + 版本更新）现已齐全，
     但**静态分析仍无基线**；本仓库 TS + Python 混合，值得给 `packages/*/src` 与
     `packages/*/scripts` 建一条 code scanning 工作流。
  4. **`dependabot.yml` 生效后观察首批 PR**：确认两个生态都能开 PR、且 `commit-message.prefix`
     符合本仓库的 `ci:` / `chore(deps):` 约定；若 pnpm workspace 解析有问题，改为按包目录列出。
  5. **维持验收线（并按本轮第 5 条**扩展认知**）**：`pnpm audit` 必须带
     `--registry=https://registry.npmjs.org`（本机）；**"本地全绿"≠"全部被覆盖"**——
     凡涉及 PTY/交互路径的改动，**本地 skip 是常态，必须以 CI 为准**；
     推送前 `typecheck + test + build`、推送后**立刻开 PR 并等 CI 绿再合并**；
     合并前**先提交或 stash**（§19.3 的教训）。
