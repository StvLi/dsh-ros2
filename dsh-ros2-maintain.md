# dsh-ros2 日常维护文档（Maintenance Log）

> 仓库：`StvLi/dsh-ros2` · 本地代码：`/home/stvli/Desktop/embody_agent_ws/dsh-ros2`（git remote `git@github.com:StvLi/dsh-ros2.git`）
> 维护日期：2026-09-11（最近一轮） · 维护者：DSH scheduled-run agent（StvLi 仓）
> 维护轮次：第一轮 2026-09-03（§0–§7）；第二轮 2026-09-04（§8）；第三轮 2026-09-05（§9，安全修复）；第四轮 2026-09-05（§10，无 open issue → 安全检查 → 两项维护卫生修复）；第五轮 2026-09-06（§11，无 open issue → 安全检查 → 落地 `ros2_install` 注入修复）；第六轮 2026-09-11（§12，本轮，无 open issue → 安全检查 → 落地 `safety_monitor` / `zero_pose_semantics` 注入修复 + vitest 4 升级 + CI 最小权限）。

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
